// tests/voice.test.js — the optional voice bot (Deepgram + ElevenLabs) in the proxy, and the
// app's fallback when its keys aren't set. Runs with `node --test`; Deepgram and ElevenLabs
// are faked, nothing goes online.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.js';
import { setProxyUrl, getVoiceCaps } from '../report.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; setProxyUrl(''); });

const KEYS = { ALLOWED_ORIGIN: '*', DEEPGRAM_API_KEY: 'dg-key', ELEVENLABS_API_KEY: 'el-key' };
const req = (path, init = {}) => new Request(`https://proxy.example${path}`, {
  ...init, headers: { Origin: 'https://site.example', ...(init.headers || {}) },
});

test('GET /voice says which voice services have keys, without showing them', async () => {
  const none = await (await worker.fetch(req('/voice'), { ALLOWED_ORIGIN: '*' })).json();
  assert.deepEqual(none, { listen: false, speak: false });
  const both = await (await worker.fetch(req('/voice'), KEYS)).json();
  assert.deepEqual(both, { listen: true, speak: true });
  assert.ok(!JSON.stringify(both).includes('key'));
});

test('GET /voice from another website is refused', async () => {
  const res = await worker.fetch(req('/voice', { headers: { Origin: 'https://evil.example' } }),
    { ...KEYS, ALLOWED_ORIGIN: 'https://site.example' });
  assert.equal(res.status, 403);
});

test('POST /listen without a Deepgram key → 503 not_configured (the app then uses the phone)', async () => {
  const res = await worker.fetch(req('/listen?lang=en', { method: 'POST', body: new Uint8Array([1, 2, 3]) }),
    { ALLOWED_ORIGIN: '*' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'not_configured');
});

test('POST /listen sends the recording to Deepgram nova-3 in the right language', async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: ' 我看到他了 ' }] }] } }));
  };
  const res = await worker.fetch(req('/listen?lang=zh', {
    method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, body: new Uint8Array([1, 2, 3, 4]),
  }), KEYS);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: '我看到他了' });
  assert.match(call.url, /^https:\/\/api\.deepgram\.com\/v1\/listen\?/);
  assert.match(call.url, /model=nova-3/);
  assert.match(call.url, /language=zh-CN/);
  assert.equal(call.init.headers.Authorization, 'Token dg-key');
  assert.equal(call.init.headers['Content-Type'], 'audio/webm;codecs=opus');
});

test('POST /listen with an empty recording → 400', async () => {
  const res = await worker.fetch(req('/listen', { method: 'POST', body: new Uint8Array([]) }), KEYS);
  assert.equal(res.status, 400);
});

test('POST /speak asks ElevenLabs Flash v2.5 and returns MP3 audio', async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  const res = await worker.fetch(req('/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'J\'ai rempli un signalement.', lang: 'fr' }),
  }), KEYS);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal((await res.arrayBuffer()).byteLength, 3);
  assert.match(call.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?output_format=mp3_22050_32$/);
  assert.equal(call.init.headers['xi-api-key'], 'el-key');
  assert.equal(call.body.model_id, 'eleven_flash_v2_5');
  assert.equal(call.body.language_code, 'fr');
});

test('POST /speak without an ElevenLabs key → 503; ElevenLabs failing → 502', async () => {
  const body = JSON.stringify({ text: 'hello', lang: 'en' });
  const noKey = await worker.fetch(req('/speak', { method: 'POST', body }), { ALLOWED_ORIGIN: '*' });
  assert.equal(noKey.status, 503);
  globalThis.fetch = async () => new Response('quota', { status: 401 });
  const failed = await worker.fetch(req('/speak', { method: 'POST', body }), KEYS);
  assert.equal(failed.status, 502);
});

test('app: no proxy, or a proxy that cannot be reached → no voice bot (phone voice as before)', async () => {
  assert.deepEqual(await getVoiceCaps(), { listen: false, speak: false });
  setProxyUrl('https://proxy.example');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await getVoiceCaps(), { listen: false, speak: false });
  globalThis.fetch = async () => new Response(JSON.stringify({ listen: true, speak: 'yes' }));
  assert.deepEqual(await getVoiceCaps(), { listen: true, speak: false }); // only a real `true` counts
});
