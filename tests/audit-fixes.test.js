// tests/audit-fixes.test.js — one test per fix from docs/AUDIT.md (Nov 22) that had no test:
//   - a finished task fades the map (engine/grid.js completedSearches)
//   - the emergency number follows where the phone is, not its language (i18n.js detectRegion)
//   - the street download gives up on a server that never answers (data.js fetchOverpass)
//   - a queued update is retried by itself (sync.js)
// Runs with `node --test`. Nothing goes online: fetch, localStorage and the clock are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// sync.js needs these two before it is imported.
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const engine = await import('../engine/index.js');
const i18n = await import('../i18n.js');
const data = await import('../data.js');
const sync = await import('../sync.js');

const osm = JSON.parse(readFileSync(new URL('./fixtures/demo-area.json', import.meta.url), 'utf8'));

// ---- A finished task fades the map -----------------------------------------------------------

test('a finished task ("Done, nobody found") lowers the map along its route, and only there', () => {
  const area = engine.prepareArea(osm);
  const now = 1795000000000;
  const caseInput = { lastSeen: { lat: 37.5443, lng: -121.9766 }, minutes: 90, direction: 'NE', mobility: 'normal', familiarPlaces: [], seed: 42, minutesAt: now };
  const me = '00000000000000a1';
  const before = engine.replay(area, caseInput, []);
  const plan = engine.planSearch(area, caseInput, before, { searchers: [{ id: me, lat: 37.5443, lng: -121.9766, at: now, mode: 'foot' }], events: [], nowMs: now });
  const option = plan.searchers[0].options.find((o) => o.type !== 'containment');
  const taken = { ...engine.assignedEvent(option, me, now), id: '-Oaaaaaaaaaaaaaaaaa1' };
  // Tapped "Done" a moment later: the planned search time counts, not the seconds on the clock.
  const done = { type: 'completed', searcherId: me, taskId: option.taskId, minutes: 1, at: now + 1000, id: '-Oaaaaaaaaaaaaaaaaa2' };

  const searches = engine.completedSearches([taken, done]);
  assert.ok(searches.length >= 1, 'the task covers at least one sector');
  assert.ok(searches.every((s) => s.type === 'searched' && /^r\d+c\d+$/.test(s.sectorId) && s.minutes >= 1));
  const total = searches.reduce((sum, s) => sum + s.minutes, 0);
  assert.ok(total <= option.searchMin + 1e-9, 'never more minutes than the task planned');

  const after = engine.replay(area, caseInput, [taken, done]);
  const sector = (p, id) => p.grid.sectors.find((s) => s.id === id);
  for (const s of searches) {
    assert.ok(sector(after, s.sectorId).probability < sector(before, s.sectorId).probability, `${s.sectorId} went down`);
    assert.ok(sector(after, s.sectorId).searchedMinutes > 0, `${s.sectorId} shows as searched`);
  }
  // Everything still adds up to 1, and ground the task never touched went up, not down.
  let sum = after.restOfWorld || 0;
  for (const v of after.grid.p) sum += v;
  assert.ok(Math.abs(sum - 1) < 1e-6, `the map sums to ${sum}`);
  const touched = new Set(searches.map((s) => s.sectorId));
  const other = before.grid.sectors.filter((s) => !touched.has(s.id) && s.probability > 0.01)[0];
  assert.ok(sector(after, other.id).probability >= other.probability);

  // Same answer whatever order the events arrive in; a second "Done" adds nothing.
  assert.deepEqual(engine.completedSearches([done, taken]), searches);
  const again = { ...done, at: now + 5000, id: '-Oaaaaaaaaaaaaaaaaa3' };
  assert.deepEqual(engine.completedSearches([taken, done, again]), searches);

  // The planner counts finished tasks itself, so it is given the map without them.
  const forPlanner = engine.replay(area, caseInput, [taken, done], { completed: false });
  assert.deepEqual(Array.from(forPlanner.grid.p.slice(0, 5000)), Array.from(before.grid.p.slice(0, 5000)));
});

test('a task with no route (stand and watch) or with no matching "taken" event searches nothing', () => {
  const me = '00000000000000a1';
  const post = { type: 'assigned', searcherId: me, taskId: 'c123', searchMin: 30, track: [1234], at: 10, id: 'a' };
  const done = { type: 'completed', searcherId: me, taskId: 'c123', minutes: 30, at: 20, id: 'b' };
  assert.deepEqual(engine.completedSearches([post, done]), []);
  assert.deepEqual(engine.completedSearches([done]), []);
  assert.deepEqual(engine.completedSearches([{ ...post, track: [-5, 'x', 1e9] }, done]), []);
});

// ---- The emergency number --------------------------------------------------------------------

test('a phone on US time gets 911 whatever its language', () => {
  for (const languages of [['zh-CN'], ['ja-JP'], ['es-ES'], ['fr-FR'], ['en-GB']]) {
    for (const timeZone of ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'Pacific/Honolulu', 'America/Indiana/Indianapolis']) {
      const region = i18n.detectRegion({ timeZone, languages });
      assert.equal(region, 'US', `${languages[0]} in ${timeZone}`);
      assert.equal(i18n.emergencyNumber(region), '911');
      assert.equal(i18n.defaultUnits(region), 'imperial');
    }
  }
});

test('elsewhere the time zone still beats the language, and the language is the fallback', () => {
  assert.equal(i18n.emergencyNumber(i18n.detectRegion({ timeZone: 'Asia/Tokyo', languages: ['en-US'] })), '110');
  assert.equal(i18n.emergencyNumber(i18n.detectRegion({ timeZone: 'Europe/Paris', languages: ['en-US'] })), '112');
  assert.equal(i18n.detectRegion({ timeZone: 'Europe/Lisbon', languages: ['pt-PT'] }), 'PT'); // zone not listed: language
  assert.equal(i18n.detectRegion({ timeZone: '', languages: ['en-GB'] }), 'GB');
});

// ---- The street download ---------------------------------------------------------------------

test('a map server that never answers is given up on, the next one is tried, and the error says "timeout"', async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  // Never answers, but stops when told to (as a real fetch does when its signal aborts).
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    asked.push(url);
    assert.ok(opts.signal, 'the download can be stopped');
    opts.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
  });
  const reports = [];
  try {
    await assert.rejects(
      data.fetchOverpass(37.55, -121.97, 3200, { attempts: 5, firstDelayMs: 1, timeoutMs: 30, onProgress: (p) => reports.push(p) }),
      (err) => err.timeout === true && !err.offline,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(asked.length, 2, 'two tries, then it stops');
  assert.notEqual(asked[0], asked[1], 'the second try goes to another server');
  assert.equal(reports.find((p) => p.stage === 'retry').reason, 'busy');
});

test('a slow server that does answer in time is not cut off', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise((resolve) => setTimeout(() => resolve(new Response('{"elements":[]}', { status: 200 })), 20));
  try {
    const json = await data.fetchOverpass(37.55, -121.97, 3200, { attempts: 1, firstDelayMs: 1, timeoutMs: 2000 });
    assert.deepEqual(json, { elements: [] });
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- The send queue retries by itself --------------------------------------------------------

test('an update whose send failed is sent again 15 s later, with nobody posting anything', async (t) => {
  const realFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let up = false;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (!up) throw new TypeError('connection reset');
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  try {
    sync.setDbUrl('https://db.example.test');
    const id = 'd4'.repeat(16);
    const first = await sync.addEvent(id, { type: 'message', text: 'I saw him by the lake', at: Date.now(), cid: 'local-1-1', by: 'Ana' });
    assert.equal(first.queued, true);
    assert.equal(sync.queuedEvents(id).length, 1);

    up = true;                 // the connection is back, but the browser never said "online"
    t.mock.timers.tick(14000);
    await settle();
    assert.equal(sent.length, 0, 'not yet');
    t.mock.timers.tick(1000);  // 15 s after the failed send
    await settle();
    assert.equal(sent.length, 1, 'sent by the retry timer');
    assert.equal(sent[0].text, 'I saw him by the lake');
    assert.equal(sync.queuedEvents(id).length, 0);
  } finally {
    globalThis.fetch = realFetch;
    sync.setDbUrl('');
    t.mock.timers.reset();
  }
});

// ---- Push 2 --------------------------------------------------------------------------------

test('a server that is briefly too busy (503) does not delete the update; a real "no" does not block the ones behind it', async () => {
  const realFetch = globalThis.fetch;
  const id = 'e5'.repeat(16);
  const tried = [];
  let mode = 'busy';
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (opts.method === 'PUT') tried.push(body.text);
    if (mode === 'busy') return { ok: false, status: 503, json: async () => null };
    if (body && body.text === 'refused') return { ok: false, status: 401, json: async () => null };
    if (!body) return { ok: false, status: 404, json: async () => null }; // the "is it there already?" look
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    sync.setDbUrl('https://db.example.test');
    const at = Date.now();
    const first = await sync.addEvent(id, { type: 'message', text: 'refused', at, cid: 'c-1' });
    assert.equal(first.queued, true, '503: kept for later');
    assert.equal(sync.queuedEvents(id).length, 1);
    await sync.addEvent(id, { type: 'message', text: 'good one', at: at + 1, cid: 'c-2' });
    assert.equal(sync.queuedEvents(id).length, 2);

    mode = 'up';
    tried.length = 0;
    const result = await sync.flushQueue();
    assert.deepEqual(tried, ['refused', 'good one'], 'the event behind the refused one is sent in the same go');
    assert.equal(result.error, 'rejected');
    assert.equal(sync.queuedEvents(id).length, 0);
  } finally {
    globalThis.fetch = realFetch;
    sync.setDbUrl('');
  }
});

test('an Overpass "runtime error" answer, or one that is not JSON, counts as busy, not as a map and not as no internet', async () => {
  const realFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 91 seconds.' }), { status: 200 }); };
    const reports = [];
    await assert.rejects(
      data.fetchOverpass(37.55, -121.97, 3200, { attempts: 3, firstDelayMs: 1, onProgress: (p) => reports.push(p) }),
      (err) => !err.offline && /timed out/.test(err.message),
    );
    assert.equal(calls, 3, 'every try was used');
    assert.ok(reports.filter((p) => p.stage === 'retry').every((p) => p.reason === 'busy'));

    globalThis.fetch = async () => new Response('<html><body>too busy</body></html>', { status: 200 });
    await assert.rejects(
      data.fetchOverpass(37.55, -121.97, 3200, { attempts: 3, firstDelayMs: 1 }),
      (err) => !err.offline,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a search with a oddly written sector id ("r015c016") shows as searched on that sector', () => {
  const area = engine.prepareArea(osm);
  const now = 1795000000000;
  const caseInput = { lastSeen: { lat: 37.5443, lng: -121.9766 }, minutes: 90, direction: null, mobility: 'normal', familiarPlaces: [], seed: 7, minutesAt: now };
  const map = engine.replay(area, caseInput, [{ type: 'searched', sectorId: 'r015c016', minutes: 30, at: now, id: 'a' }]);
  assert.equal(map.grid.sectors.find((s) => s.id === 'r15c16').searchedMinutes, 30);
});

test('the bundled Demo file counts as covering a pin only when it covers that pin\'s whole map', () => {
  assert.equal(data.coversGrid(osm, { lat: 37.541, lng: -121.98 }), true, 'the Demo case itself');
  assert.equal(data.coversGrid(osm, { lat: 37.570, lng: -121.970 }), false, 'a pin 1.9 km north of where the map opens');
});
