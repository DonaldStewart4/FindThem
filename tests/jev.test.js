// Tests for the report box's Jev integration (proxy/jev.js and proxy/worker.js).
// Jev itself is never called: fetch is replaced with a fake that returns Jev-shaped answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJevRequest, jevToDraft, cleanPlaces, MIN_CONFIDENCE, MAX_PLACES, MINUTE_OPTION } from '../proxy/jev.js';

const PLACES = [
  { name: 'Lake Elizabeth', lat: 37.5487, lng: -121.9637 },
  { name: 'Paseo Padre Parkway', lat: 37.5501, lng: -121.9702 },
];

// A Jev answer for a choice question.
const pick = (choice, confidence = 0.9) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });

test('cleanPlaces drops bad entries, duplicates and the reserved name "none", and caps the list', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ name: `Street ${i}`, lat: 1, lng: 2 }));
  const out = cleanPlaces([{ name: 'A', lat: 1, lng: 2 }, { name: 'A', lat: 3, lng: 4 }, { name: 'none', lat: 1, lng: 1 },
    { name: 'B', lat: 'x', lng: 2 }, null, ...many]);
  assert.equal(out[0].name, 'A');
  assert.equal(out.filter((p) => p.name === 'A').length, 1);
  assert.ok(!out.some((p) => p.name === 'none' || p.name === 'B'));
  assert.equal(out.length, MAX_PLACES);
  assert.deepEqual(cleanPlaces(undefined), []);
});

test('buildJevRequest asks five questions, with the places plus "none" as place options', () => {
  const req = buildJevRequest('saw him by the lake', 'en', PLACES);
  assert.equal(req.model, 'jev-latest');
  assert.deepEqual(Object.keys(req.questions).sort(), ['direction', 'kind', 'minutes', 'place', 'sure']);
  assert.equal(req.questions.sure.type, 'score');
  assert.equal(req.questions.sure.criteria.length, 3);
  assert.deepEqual(Object.keys(req.questions.place.criteria).sort(), ['Lake Elizabeth', 'Paseo Padre Parkway', 'none']);
  assert.equal(req.state.report, 'saw him by the lake');
  assert.ok(!JSON.stringify(req.state).includes('37.5487'), 'coordinates are not sent to Jev');
});

test('confident answers become a full sighting draft, pinned to the chosen place', () => {
  const draft = jevToDraft({
    kind: pick('sighting'), direction: pick('E'), minutes: pick(MINUTE_OPTION[10]), place: pick('Lake Elizabeth'),
    sure: { type: 'score', score: 2.2, confidence: 0.8 },
  }, '  Definitely saw him by the lake 10 min ago, blue coat, heading east  ', PLACES);
  assert.deepEqual(draft, {
    kind: 'sighting', placeText: 'Lake Elizabeth', lat: 37.5487, lng: -121.9637, direction: 'E',
    minutesSince: 10, reliability: 0.9, note: 'Definitely saw him by the lake 10 min ago, blue coat, heading east',
  });
});

test('answers below MIN_CONFIDENCE are left empty for the person to fill in', () => {
  const low = MIN_CONFIDENCE - 0.1;
  const draft = jevToDraft({
    kind: pick('sighting'), direction: pick('N', low), minutes: pick(MINUTE_OPTION[5], low), place: pick('Lake Elizabeth', low),
    sure: { type: 'score', score: 0, confidence: low },
  }, 'saw someone', PLACES);
  assert.equal(draft.direction, null);
  assert.equal(draft.minutesSince, null);
  assert.equal(draft.lat, null);
  assert.equal(draft.placeText, '');
  assert.equal(draft.reliability, 0.6); // unsure about "how sure" → the middle option
});

test('an unsure kind becomes a sighting with only the note filled in', () => {
  const draft = jevToDraft({ kind: pick('message', 0.3), direction: pick('W') }, 'umm the park?', PLACES);
  assert.equal(draft.kind, 'sighting');
  assert.equal(draft.direction, null);
  assert.equal(draft.note, 'umm the park?');
});

test('"unknown" and "none" mean not stated; missing answers are safe', () => {
  const draft = jevToDraft({ kind: pick('searched'), direction: pick('unknown'), minutes: pick('unknown'), place: pick('none') }, 'checked the school, nothing', PLACES);
  assert.equal(draft.kind, 'searched');
  assert.equal(draft.direction, null);
  assert.equal(draft.minutesSince, null);
  assert.equal(draft.lat, null);
  assert.equal(jevToDraft(undefined, 'x', []).kind, 'sighting');
});

test('worker: calls Jev with the key, retries once when busy, returns a checked draft', async () => {
  const { default: worker } = await import('../proxy/worker.js');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
    if (calls.length === 1) return { ok: false, status: 529 }; // busy the first time
    return { ok: true, status: 200, json: async () => ({ answers: { kind: pick('sighting'), direction: pick('NE'), minutes: pick(MINUTE_OPTION[15]), place: pick('none'), sure: { score: 1, confidence: 0.9 } } }) };
  };
  try {
    const request = new Request('https://proxy.example/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://site.example' },
      body: JSON.stringify({ text: 'I think I saw her heading northeast 15 minutes ago', lang: 'en', context: { places: PLACES } }),
    });
    const res = await worker.fetch(request, { TYPESAFE_API_KEY: 'test-key', ALLOWED_ORIGIN: '*' });
    const draft = await res.json();
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(calls[0].auth, 'Bearer test-key');
    assert.equal(draft.kind, 'sighting');
    assert.equal(draft.direction, 'NE');
    assert.equal(draft.minutesSince, 15);
    assert.equal(draft.reliability, 0.6);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('worker: no key → 500 no_key; wrong origin → 403', async () => {
  const { default: worker } = await import('../proxy/worker.js');
  const make = (origin) => new Request('https://proxy.example/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ text: 'hi' }),
  });
  const noKey = await worker.fetch(make('https://site.example'), { ALLOWED_ORIGIN: '*' });
  assert.equal(noKey.status, 500);
  assert.equal((await noKey.json()).error, 'no_key');
  const badOrigin = await worker.fetch(make('https://evil.example'), { TYPESAFE_API_KEY: 'k', ALLOWED_ORIGIN: 'https://site.example' });
  assert.equal(badOrigin.status, 403);
});
