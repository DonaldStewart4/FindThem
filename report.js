// report.js: the voice/text report box (NOT a chatbot).
//
// What this file does:
//   1. Voice input: turns speech into text. Two ways:
//      - the "voice bot" (if the proxy has the keys): record → Deepgram → text, and the
//        app reads back what it filled in with ElevenLabs (getVoiceCaps, startRecording,
//        transcribe, speak)
//      - otherwise the browser's own Web Speech API (startVoice), as before
//   2. parseReport(): sends the text to our tiny LLM proxy (proxy/worker.js),
//      which returns a ReportDraft (see INTERFACES.md section 5).
//   3. validateDraft(): checks and cleans a draft so bad data never gets through.
//      confineDraft(): holds a proxy draft to the person's own words and the places we sent,
//      so the reader can't add text of its own (docs/AGENT-CONTRACT.md).
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

// ---------- Draft schema (docs/AGENT-CONTRACT.md) ----------
// Version 2 of ReportDraft adds two optional lists. Both are codes, never text, and both are
// left out of the draft when empty (so a version-1 draft is still a valid version-2 draft).
//   unsure: fields the reader could not answer with confidence. place / direction /
//           minutesSince in this list are always empty; kind / reliability are a default
//           value the person must check.
//   flags:  safety warnings for the screen to show. They only ever add caution.
export const DRAFT_SCHEMA = 2;
export const UNSURE_FIELDS = ['kind', 'place', 'direction', 'minutesSince', 'reliability'];
export const DRAFT_FLAGS = [
  'emergency',    // hurt, fallen, in the water: call emergency services now
  'water',        // the report mentions water (creek, lake, lagoon...): for professionals only
  'vehicle',      // the person may be in a car, bus or train: tell the police, they could be far away
  'conflict',     // the report says two different things (two places, "definitely" + "not sure"...),
                  // or the two readers (Jev and the word rules) disagreed: those fields are left empty
  'guess',        // a guess or worry about where they might be, not a sighting
  'other_person', // it turned out to be someone else
  'joke',         // reads like a joke or sarcasm: nothing filled in
];

// ---------- Voice bot (Deepgram + ElevenLabs, through the proxy) ----------
// Used only when the proxy says it has the keys (GET /voice). Any failure here falls back
// to the browser's speech recognition or to typing; the report box never depends on it.

const NO_VOICE_BOT = { listen: false, speak: false };
const MAX_RECORDING_MS = 30000; // a report is a sentence or two; stop recording by itself after 30 s

// Asks the proxy which voice services are set up: { listen, speak }. Both false if the
// proxy isn't set up, can't be reached, or answers oddly.
export async function getVoiceCaps() {
  if (!proxyUrl || typeof fetch === 'undefined') return NO_VOICE_BOT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${proxyUrl}/voice`, { signal: controller.signal });
    if (!res.ok) return NO_VOICE_BOT;
    const caps = await res.json();
    return { listen: caps.listen === true, speak: caps.speak === true };
  } catch (err) {
    return NO_VOICE_BOT;
  } finally {
    clearTimeout(timer);
  }
}

// true if this browser can record audio (needed for the Deepgram path).
export function canRecord() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined'
    && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// The recording format this browser supports: WebM/Opus (Chrome, Android, Firefox) or MP4 (Safari).
function recordingType() {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Starts recording from the microphone. Calls onDone(blob) when recording stops (tap again,
// or after 30 s), or onError(code) ('mic_denied' or 'voice_error'). Returns stop().
export function startRecording(onDone, onError) {
  let recorder = null;
  let stream = null;
  let stopped = false;
  let timer = null;
  const chunks = [];

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
    stream = s;
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; } // cancelled while asking
    const type = recordingType();
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); // turn the microphone off
      onDone(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
    };
    recorder.start();
    timer = setTimeout(stop, MAX_RECORDING_MS);
  }).catch((err) => {
    onError(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'mic_denied' : 'voice_error');
  });

  return stop;
}

// Sends a recording to the proxy (Deepgram) and returns the text. Throws 'offline',
// 'proxy_error' or 'no_speech'.
export async function transcribe(blob, lang = 'en') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
  if (!proxyUrl) throw new Error('proxy_error');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${proxyUrl}/listen?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error('offline');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('proxy_error');
  const data = await res.json().catch(() => ({}));
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) throw new Error('no_speech');
  return text;
}

// One audio player, reused for every read-back. iPhones only allow sound that starts during
// a tap; the read-back starts seconds later (after Deepgram and Jev), so unlockAudio() plays
// a silent sound on this player during the Speak tap, and later plays on the same player work.
let player = null;
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
export function unlockAudio() {
  if (typeof Audio === 'undefined') return;
  if (!player) player = new Audio();
  player.src = SILENCE;
  player.play().catch(() => { /* blocked or unsupported: the read-back may be silent */ });
}

// Says `text` out loud with the proxy's ElevenLabs voice. Resolves when it has finished
// (or right away if it can't play); never throws, because speaking is a nice extra.
// English only: in any other language this does nothing (ElevenLabs is never called).
export const SPEAK_LANGS = ['en'];
export function canSpeak(lang) { return SPEAK_LANGS.includes(lang); }

export async function speak(text, lang = 'en') {
  stopSpeaking();
  if (!proxyUrl || !text || !canSpeak(lang) || typeof Audio === 'undefined') return;
  try {
    const res = await fetch(`${proxyUrl}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    if (!player) player = new Audio();
    player.src = url;
    await new Promise((resolve) => {
      player.onended = player.onerror = player.onpause = resolve;
      player.play().catch(resolve); // still blocked: no sound, the form shows the same thing
    });
    URL.revokeObjectURL(url);
  } catch (err) {
    /* no sound is fine: the form shows the same thing */
  }
}
export function stopSpeaking() {
  if (player && !player.paused) player.pause();
}

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
    // 'network' = the phone's speech service needs internet and there isn't any.
    else if (e.error === 'network') onError('voice_offline');
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

  const draft = {
    kind,
    placeText: cleanText(raw.placeText, 200),
    lat,
    lng,
    direction: DIRECTIONS.includes(dir) ? dir : null,
    minutesSince: minutes,
    reliability: snapReliability(raw.reliability),
    note: cleanText(raw.note, 300),
  };

  // Version 2 lists: only known codes, in a fixed order, left out when empty.
  const unsure = knownCodes(raw.unsure, UNSURE_FIELDS);
  const flags = knownCodes(raw.flags, DRAFT_FLAGS);
  // A field the reader wasn't sure about is always empty, so a guess can never sit in the form.
  if (unsure.includes('place')) { draft.placeText = ''; draft.lat = null; draft.lng = null; }
  if (unsure.includes('direction')) draft.direction = null;
  if (unsure.includes('minutesSince')) draft.minutesSince = null;
  if (unsure.length) draft.unsure = unsure;
  if (flags.length) draft.flags = flags;
  return draft;
}

// The codes from `list` that are in `allowed`, in allowed's order, each once.
function knownCodes(list, allowed) {
  return Array.isArray(list) ? allowed.filter((code) => list.includes(code)) : [];
}

// The reader may only point at things the report and the map already contain. This makes
// sure a draft from the proxy can't carry any text of its own:
//   - note is always the person's own words, whatever the proxy sent;
//   - placeText must be one of the nearby place names the phone sent, and the pin is that
//     place's own point (a name we didn't offer, or a pin with no name, is dropped).
// So even a broken or tampered proxy can't put advice ("go into the creek") into the form.
export function confineDraft(draft, text, places = []) {
  const d = validateDraft(draft);
  if (!d) return null;
  d.note = cleanText(String(text || ''), 300);
  const place = d.placeText ? places.find((p) => p && p.name === d.placeText) : null;
  if (place && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    d.lat = place.lat;
    d.lng = place.lng;
  } else {
    d.placeText = '';
    d.lat = null;
    d.lng = null;
  }
  return d;
}

// ---------- Talking to the proxy ----------

// Send the report text to the proxy and get back a checked ReportDraft.
// context = { lastSeen: {lat, lng}, places: [{ name: 'Paseo Padre Parkway', lat, lng }, ...] }
// (named streets, creeks, parks and lakes near the last-seen point, nearest first)
// Throws an Error whose message is 'offline', 'proxy_error' or 'bad_response'.
export async function parseReport(text, context = {}, lang = 'en') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
  if (!proxyUrl) throw new Error('proxy_error');

  const places = (context.places || []).slice(0, 60);
  const body = {
    text: String(text || '').slice(0, MAX_TEXT),
    lang,
    context: {
      lastSeen: context.lastSeen || null,
      places,
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
  // Checked, and held to the report's own words and the places we sent (confineDraft).
  const draft = confineDraft(data, body.text, places);
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
