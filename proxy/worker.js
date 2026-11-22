// proxy/worker.js: a tiny Cloudflare Worker between the website and Jev (TypeSafe AI).
//
// Why it exists: the Jev API key must never be in the website's code. The key lives here
// as a secret (env.TYPESAFE_API_KEY), set with `wrangler secret put TYPESAFE_API_KEY`.
// The worker only turns a report into a ReportDraft JSON (INTERFACES.md section 5).
// It never sets probabilities; the person checks the draft and taps Confirm.
//
// Routes:
//   POST /         { text, lang, context: { lastSeen, places: [{name,lat,lng}], intersections: [{streets,lat,lng}] } } → ReportDraft JSON
//   GET  /voice    → { listen, speak }: which optional voice services have keys (proxy/voice.js)
//   POST /listen?lang=en   body = a recording (audio/webm or audio/mp4) → { text } (Deepgram)
//   POST /speak    { text, lang: 'en' } → MP3 audio (ElevenLabs; English only, others → 400)
// Errors: { error: 'code' } with a 4xx/5xx status.

// Shared checker, so the browser and the proxy clean drafts the same way.
// (wrangler bundles these imports into the worker when deploying.)
import { validateDraft, MAX_TEXT } from '../report.js';
import { JEV_URL, buildJevRequest, safeJevDraft, cleanPlaces, cleanIntersections } from './jev.js';
import {
  voiceCapabilities, buildDeepgramRequest, deepgramText, buildElevenLabsRequest,
  MAX_AUDIO_BYTES, MAX_SPEAK_CHARS, SPEAK_LANGS,
} from './voice.js';

const RATE_LIMIT = 20;          // requests per IP ...
const RATE_WINDOW_MS = 60000;   // ... per minute
const RETRY_WAIT_MS = 800;      // one retry if Jev is busy (429/529)

// Simple per-IP counter. It lives in this worker instance's memory, so it is
// "best effort" (Cloudflare may run several instances), but it stops basic abuse.
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 5000) hits.clear(); // keep memory small
    return false;
  }
  h.count++;
  return h.count > RATE_LIMIT;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(env, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// Calls Jev once, and once more after a short wait if it says it's busy.
async function askJev(env, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 529) && attempt === 0) {
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
      continue;
    }
    throw new Error(`jev ${res.status}`);
  }
  throw new Error('jev busy');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

    // Only our site may call this (browsers send Origin; '*' allows any).
    const origin = request.headers.get('Origin');
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin !== env.ALLOWED_ORIGIN) {
      return reply(env, 403, { error: 'origin' });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/voice' && request.method === 'GET') return reply(env, 200, voiceCapabilities(env));
    if (request.method !== 'POST') return reply(env, 405, { error: 'method' });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (tooMany(ip)) return reply(env, 429, { error: 'rate_limit' });

    if (path === '/listen') return listen(request, env);
    if (path === '/speak') return speak(request, env);
    if (path !== '/') return reply(env, 404, { error: 'not_found' });
    return readReport(request, env);
  },
};

// POST /: report text → ReportDraft, by asking Jev.
async function readReport(request, env) {
  if (!env.TYPESAFE_API_KEY) return reply(env, 500, { error: 'no_key' });

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return reply(env, 400, { error: 'bad_json' });
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT).trim() : '';
  if (!text) return reply(env, 400, { error: 'no_text' });
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 5) : 'en';
  const places = cleanPlaces(body.context && body.context.places);
  const intersections = cleanIntersections(body.context && body.context.intersections);

  let jev;
  try {
    jev = await askJev(env, buildJevRequest(text, lang, places, intersections));
  } catch (err) {
    return reply(env, 502, { error: 'upstream' });
  }

  // Jev's answers go through the safety layer (proxy/jev.js safeJevDraft) before anything is sent back.
  const draft = validateDraft(safeJevDraft(jev && jev.answers, text, places, { intersections, lang }));
  if (!draft) return reply(env, 502, { error: 'bad_response' });
  return reply(env, 200, draft);
}

// POST /listen?lang=xx: a recording → { text }, with Deepgram. Nothing is stored.
async function listen(request, env) {
  if (!env.DEEPGRAM_API_KEY) return reply(env, 503, { error: 'not_configured' });
  const lang = (new URL(request.url).searchParams.get('lang') || 'en').slice(0, 5);
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return reply(env, 400, { error: 'no_audio' });
  if (audio.byteLength > MAX_AUDIO_BYTES) return reply(env, 413, { error: 'too_long' });

  const { url, init } = buildDeepgramRequest(env, audio, request.headers.get('Content-Type'), lang);
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return reply(env, 502, { error: 'upstream' });
  }
  if (!res.ok) return reply(env, 502, { error: 'upstream' });
  const text = deepgramText(await res.json().catch(() => null));
  return reply(env, 200, { text: text.slice(0, MAX_TEXT) });
}

// POST /speak { text, lang }: MP3 of the text, with ElevenLabs.
async function speak(request, env) {
  if (!env.ELEVENLABS_API_KEY) return reply(env, 503, { error: 'not_configured' });
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return reply(env, 400, { error: 'bad_json' });
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_SPEAK_CHARS).trim() : '';
  if (!text) return reply(env, 400, { error: 'no_text' });
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 5) : '';
  // English only: anything else is refused before ElevenLabs is called (no cost, no speech).
  if (!SPEAK_LANGS.includes(lang)) return reply(env, 400, { error: 'unsupported_language' });

  const { url, init } = buildElevenLabsRequest(env, text, lang);
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return reply(env, 502, { error: 'upstream' });
  }
  if (!res.ok) return reply(env, 502, { error: 'upstream' });
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', ...corsHeaders(env) },
  });
}
