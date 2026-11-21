// report.js: the voice/text report box (NOT a chatbot).
//
// What this file does:
//   1. Voice input: turns speech into text with the browser's Web Speech API.
//   2. parseReport(): sends the text to our tiny LLM proxy (proxy/worker.js),
//      which returns a ReportDraft (see INTERFACES.md section 5).
//   3. validateDraft(): checks and cleans a draft so bad data never gets through.
//   4. draftToEvent(): turns a draft into a normal Event, but ONLY after the
//      person has looked at the draft and tapped Confirm.
//
// This file has no UI text. Errors are short codes ('offline', 'proxy_error',
// 'bad_response', 'no_voice', ...) that app.js turns into words via i18n.js.

// Address of the deployed proxy, e.g. 'https://findthem-proxy.<you>.workers.dev'.
// app.js sets it from config.js (PROXY_URL there). Empty means "not set up yet":
// parseReport throws 'proxy_error'.
let proxyUrl = '';
export function setProxyUrl(url) { proxyUrl = (url || '').replace(/\/$/, ''); }
export function isProxyConfigured() { return proxyUrl !== ''; }

// Longest report we send (the proxy also cuts at this length).
export const MAX_TEXT = 1000;

// How long to wait for the proxy before giving up (milliseconds).
const TIMEOUT_MS = 15000;

// App language code -> speech recognition language code.
const VOICE_LANGS = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', zh: 'zh-CN', ja: 'ja-JP' };

const KINDS = ['sighting', 'searched', 'message'];
const RELIABILITIES = [0.3, 0.6, 0.9];
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// ---------- Voice ----------

// The speech recognizer class, or null if this browser has none.
function getRecognizerClass() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// true if this browser can do voice input (Chrome, Safari, Edge; not Firefox).
export function isVoiceSupported() {
  return getRecognizerClass() !== null;
}

// Start listening. onText(text, isFinal) is called as words arrive.
// onError(code) is called on problems; onEnd() when listening stops for any reason.
// Returns a stop() function.
export function startVoice(lang, onText, onError, onEnd = () => {}) {
  const Recognizer = getRecognizerClass();
  if (!Recognizer) {
    onError('no_voice');
    onEnd();
    return () => {};
  }
  const rec = new Recognizer();
  rec.lang = VOICE_LANGS[lang] || 'en-US';
  rec.interimResults = true; // show words while the person is still talking
  rec.continuous = false;    // stop after one pause

  rec.onresult = (e) => {
    // Join every piece heard so far into one string.
    let text = '';
    let isFinal = true;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (!e.results[i].isFinal) isFinal = false;
    }
    onText(text.trim(), isFinal);
  };
  rec.onerror = (e) => {
    // 'not-allowed' = the person said no to the microphone.
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onError('mic_denied');
    else if (e.error === 'no-speech') onError('no_speech');
    else if (e.error !== 'aborted') onError('voice_error');
  };
  rec.onend = () => onEnd();
  try {
    rec.start();
  } catch (err) {
    onError('voice_error');
    onEnd();
  }
  return () => {
    try { rec.stop(); } catch (err) { /* already stopped */ }
  };
}

// ---------- Validation ----------

// A number, or null if it isn't a usable number.
function numOrNull(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// Short trimmed string (or '' if not a string).
function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Snap any number to the nearest allowed reliability (0.3, 0.6 or 0.9).
function snapReliability(v) {
  const n = numOrNull(v);
  if (n === null) return 0.6; // unknown wording -> "probably"
  let best = RELIABILITIES[0];
  for (const r of RELIABILITIES) if (Math.abs(r - n) < Math.abs(best - n)) best = r;
  return best;
}

// Check and clean a draft. Returns a new, safe ReportDraft, or null if the
// input is not usable at all. Used by both the browser and the proxy.
export function validateDraft(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'message';

  // Latitude/longitude must both be valid, or both null.
  let lat = numOrNull(raw.lat);
  let lng = numOrNull(raw.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    lat = null;
    lng = null;
  }

  const dir = typeof raw.direction === 'string' ? raw.direction.trim().toUpperCase() : '';
  let minutes = numOrNull(raw.minutesSince);
  if (minutes !== null) minutes = Math.round(Math.min(Math.max(minutes, 0), 24 * 60));

  return {
    kind,
    placeText: cleanText(raw.placeText, 200),
    lat,
    lng,
    direction: DIRECTIONS.includes(dir) ? dir : null,
    minutesSince: minutes,
    reliability: snapReliability(raw.reliability),
    note: cleanText(raw.note, 300),
  };
}

// ---------- Talking to the proxy ----------

// Send the report text to the proxy and get back a checked ReportDraft.
// context = { lastSeen: {lat, lng}, streetNames: ['Paseo Padre Pkwy', ...] }
// Throws an Error whose message is 'offline', 'proxy_error' or 'bad_response'.
export async function parseReport(text, context = {}, lang = 'en') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
  if (!proxyUrl) throw new Error('proxy_error');

  const body = {
    text: String(text || '').slice(0, MAX_TEXT),
    lang,
    context: {
      lastSeen: context.lastSeen || null,
      streetNames: (context.streetNames || []).slice(0, 50),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Network failure or timeout: treat as offline so the person types it in by hand.
    throw new Error('offline');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('proxy_error');

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('bad_response');
  }
  const draft = validateDraft(data);
  if (!draft) throw new Error('bad_response');
  return draft;
}

// ---------- Draft -> Event (only after Confirm) ----------

// Turn a CONFIRMED draft into an Event (INTERFACES.md section 1).
// by = searcher name, at = time in ms. id is added later by Firebase.
// For a sighting, lat/lng must be set (the person taps the map if the LLM
// couldn't pin it); otherwise this returns null.
// 'searched' drafts return null too: a searched Event needs a sectorId, which
// the screen fills in from the map, not from the text.
export function draftToEvent(draft, { by = '', at = Date.now() } = {}) {
  const d = validateDraft(draft);
  if (!d) return null;
  if (d.kind === 'sighting') {
    if (d.lat === null || d.lng === null) return null;
    return {
      type: 'sighting',
      lat: d.lat,
      lng: d.lng,
      direction: d.direction,
      minutesSince: d.minutesSince === null ? 0 : d.minutesSince,
      reliability: d.reliability,
      note: d.note,
      by,
      at,
    };
  }
  if (d.kind === 'message') {
    const text = d.note || d.placeText;
    if (!text) return null;
    return { type: 'message', text, by, at };
  }
  return null; // 'searched': see comment above
}
