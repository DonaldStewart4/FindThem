// proxy/worker.js: a tiny Cloudflare Worker between the website and Jev (TypeSafe AI).
//
// Why it exists: the Jev API key must never be in the website's code. The key lives here
// as a secret (env.TYPESAFE_API_KEY), set with `wrangler secret put TYPESAFE_API_KEY`.
// The worker only turns a report into a ReportDraft JSON (INTERFACES.md section 5).
// It never sets probabilities; the person checks the draft and taps Confirm.
//
// Request:  POST { text, lang, context: { lastSeen: {lat,lng}, places: [{name,lat,lng}] } }
// Response: ReportDraft JSON, or { error: 'code' } with a 4xx/5xx status.

// Shared checker, so the browser and the proxy clean drafts the same way.
// (wrangler bundles these imports into the worker when deploying.)
import { validateDraft, MAX_TEXT } from '../report.js';
import { JEV_URL, buildJevRequest, jevToDraft, cleanPlaces } from './jev.js';

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    if (request.method !== 'POST') return reply(env, 405, { error: 'method' });

    // Only our site may call this (browsers send Origin; '*' allows any).
    const origin = request.headers.get('Origin');
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin !== env.ALLOWED_ORIGIN) {
      return reply(env, 403, { error: 'origin' });
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (tooMany(ip)) return reply(env, 429, { error: 'rate_limit' });
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

    let jev;
    try {
      jev = await askJev(env, buildJevRequest(text, lang, places));
    } catch (err) {
      return reply(env, 502, { error: 'upstream' });
    }

    const draft = validateDraft(jevToDraft(jev && jev.answers, text, places));
    if (!draft) return reply(env, 502, { error: 'bad_response' });
    return reply(env, 200, draft);
  },
};
