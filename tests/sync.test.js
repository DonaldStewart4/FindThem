// Tests for sync.js: mirror patching, event sorting, the offline queue, case updates, and the
// integrity rules (no event can corrupt the shared map).
//
// The integrity part checks ONE table of good and bad events, plus write scenarios (append-only,
// write-once case, partial writes, PATCH...), against every stand-in, and all must agree:
//   1. sync.js checkEvent / checkCase: what every phone accepts from the database
//   2. firebase-rules.json, run by the small rules evaluator below: what Firebase should accept
//   3. tools/mock-firebase.py, over real HTTP: what the local test database accepts
//   4. the real Firebase emulator, over HTTP, when FIREBASE_EMULATOR is set (see that test)
// fetch and localStorage are replaced with small fakes for the queue tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const realFetch = globalThis.fetch;

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
let online = false;
const posted = [];
globalThis.fetch = async (url, opts = {}) => {
  if (!online) throw new Error('offline');
  posted.push({ url, method: opts.method, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({}) };
};

const sync = await import('../sync.js');

const S1 = 'a1'.repeat(16); // search ids: 32 hex characters
const S2 = 'b2'.repeat(16);
const S9 = 'c3'.repeat(16);
const ME = '0123456789abcdef'; // a searcher id: 16 hex characters
const PAL = 'fedcba9876543210';
const NOW = Date.now();
const T0 = NOW - 10 * 60000; // ten minutes ago
const PUSH = /^[-0-9A-Za-z_]{20}$/;

// ---- The queue and the mirror ------------------------------------------------------------------

test('newSearchId is 32 hex chars and random; newPushId looks like a Firebase push id', () => {
  const a = sync.newSearchId();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, sync.newSearchId());
  const p = sync.newPushId();
  assert.match(p, PUSH);
  assert.notEqual(p, sync.newPushId());
  assert.ok(sync.newPushId(1000) < sync.newPushId(2000)); // time first, so ids sort by time
});

test('applyChange handles put/patch at root and nested paths, null deletes', () => {
  let m = sync.applyChange({}, 'put', '/', { case: { seed: 1 }, events: { '-a': { at: 2 } } });
  m = sync.applyChange(m, 'put', '/events/-b', { at: 1 });
  m = sync.applyChange(m, 'patch', '/events', { '-c': { at: 3 } });
  m = sync.applyChange(m, 'put', '/events/-a', null);
  assert.deepEqual(Object.keys(m.events).sort(), ['-b', '-c']);
  m = sync.applyChange(m, 'put', '/', null);
  assert.deepEqual(m, {});
  m = sync.applyChange(m, 'put', '/events/-z', { at: 5 }); // path into empty mirror
  assert.equal(m.events['-z'].at, 5);
});

test('applyChange: a patch of several places at once ("events/x" keys) lands at each place', () => {
  let m = sync.applyChange({}, 'put', '/', { events: { '-a': { at: 1 } } });
  m = sync.applyChange(m, 'patch', '/', { 'events/-b': { at: 2 }, 'searchers/abc': { lat: 1 } });
  assert.deepEqual(Object.keys(m.events).sort(), ['-a', '-b']);
  assert.equal(m.searchers.abc.lat, 1);
  assert.ok(!('events/-b' in m));
});

test('applyChange ignores __proto__ / constructor paths (no prototype pollution)', () => {
  const m = sync.applyChange({}, 'put', '/__proto__/polluted', 'yes');
  sync.applyChange(m, 'patch', '/', { '__proto__/polluted': 'yes', 'constructor/prototype/x': 1 });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('sortedEvents sorts by at then id and adds ids', () => {
  const list = sync.sortedEvents({ '-b': { at: 5 }, '-a': { at: 5 }, '-c': { at: 1 } });
  assert.deepEqual(list.map((e) => e.id), ['-c', '-a', '-b']);
  assert.deepEqual(sync.sortedEvents(undefined), []);
});

test('addEvent without DB url queues', async () => {
  const r = await sync.addEvent(S1, { type: 'message', text: 'x', at: T0 + 1 });
  assert.equal(r.queued, true);
  assert.equal(r.error, 'no-db-url');
  assert.equal(sync.pendingCount(), 1);
});

test('offline events queue, then flush in order when online, each PUT at its own push id', async () => {
  sync.setDbUrl('https://db.example');
  const r = await sync.addEvent(S1, { type: 'message', text: 'y', at: T0 + 2, id: 'ignored' });
  assert.equal(r.error, 'offline');
  assert.equal(sync.pendingCount(), 2);
  online = true;
  const r2 = await sync.addEvent(S1, { type: 'message', text: 'z', at: T0 + 3 });
  assert.equal(r2.ok, true);
  assert.equal(sync.pendingCount(), 0);
  assert.deepEqual(posted.map((p) => p.body.text), ['x', 'y', 'z']);
  for (const p of posted) {
    assert.equal(p.method, 'PUT');
    assert.match(p.url, new RegExp(`^https://db\\.example/searches/${S1}/events/[-0-9A-Za-z_]{20}\\.json$`));
  }
  assert.equal(new Set(posted.map((p) => p.url)).size, 3);
  assert.ok(!('id' in posted[1].body));
});

test('addEvent refuses a broken event without queueing or sending it', async () => {
  const before = posted.length;
  const r = await sync.addEvent(S1, { type: 'searched', sectorId: 'r1c1', minutes: 9000, at: T0 });
  assert.deepEqual(r, { ok: false, error: 'invalid', reason: 'bad:minutes' });
  assert.equal((await sync.addEvent('../../etc', { type: 'message', text: 'x', at: T0 })).reason, 'bad:searchId');
  assert.equal(sync.pendingCount(), 0);
  assert.equal(posted.length, before);
});

const CASE = {
  lastSeen: { lat: 37.5485, lng: -121.963 },
  minutes: 45,
  direction: null,
  mobility: 'walker',
  familiarPlaces: [{ lat: 37.55, lng: -121.96, label: 'Lake Elizabeth' }],
  seed: 123456789,
  minutesAt: NOW - 60000,
  area: 'demo',
  startedBy: 'Ana',
  startedAt: null,
};

test('createSearch PUTs the case with createdAt and engineVersion (nulls left out)', async () => {
  const calls = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const r = await sync.createSearch(S2, CASE);
  const bad = await sync.createSearch(S2, { ...CASE, mobility: 'flying' });
  globalThis.fetch = old;
  assert.equal(r.ok, true);
  assert.deepEqual(bad, { ok: false, error: 'invalid', reason: 'bad:mobility' });
  assert.equal(calls.length, 1); // the broken case was never sent
  assert.equal(calls[0].opts.method, 'PUT');
  assert.equal(calls[0].url, `https://db.example/searches/${S2}/case.json`);
  const body = JSON.parse(calls[0].opts.body);
  assert.ok(body.createdAt > 0);
  assert.equal(body.engineVersion, sync.ENGINE_VERSION);
  assert.ok(!('direction' in body) && !('startedAt' in body));
  assert.equal(sync.checkCase(body), null);
});

test('two events sent at the same moment each reach the database exactly once', async () => {
  const sent = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    await new Promise((r) => setTimeout(r, 20)); // a slow network, so the sends overlap
    sent.push(JSON.parse(opts.body).text);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    sync.setDbUrl('https://db.example');
    await Promise.all([
      sync.addEvent(S9, { type: 'message', text: 'one', at: T0 + 1 }),
      sync.addEvent(S9, { type: 'message', text: 'two', at: T0 + 2 }),
    ]);
    assert.deepEqual(sent.sort(), ['one', 'two']);
    assert.equal(sync.pendingCount(), 0);
  } finally {
    globalThis.fetch = old;
  }
});

test('setSearcherPosition overwrites my own entry, rounded to ~1 m; offline is not queued', async () => {
  sync.setDbUrl('https://db.example');
  const id = sync.newSearcherId();
  assert.match(id, /^[0-9a-f]{16}$/);
  online = false;
  assert.equal(await sync.setSearcherPosition('ab'.repeat(16), id, { lat: 37.5531234, lng: -121.9701234, name: 'Ana' }), false);
  online = true;
  const before = posted.length;
  assert.equal(await sync.setSearcherPosition('ab'.repeat(16), id, { lat: 37.5531234, lng: -121.9701234, name: 'Ana' }), true);
  const sent = posted[posted.length - 1];
  assert.equal(posted.length, before + 1); // only the online call reached the database
  assert.equal(sent.url, `https://db.example/searches/${'ab'.repeat(16)}/searchers/${id}.json`);
  assert.equal(sent.body.lat, 37.55312);
  assert.equal(sent.body.lng, -121.97012);
  assert.equal(sent.body.name, 'Ana');
  assert.equal(typeof sent.body.at, 'number');
});

// ---- The event table ------------------------------------------------------------------------------

const long = (n) => 'x'.repeat(n);
const ev = {
  searched: { type: 'searched', sectorId: 'r12c7', minutes: 20, by: 'Ana', cid: 'local-1700000000000-1', at: T0 },
  sighting: { type: 'sighting', lat: 37.55, lng: -121.96, direction: 'E', minutesSince: 10, reliability: 0.6, note: 'blue coat', by: 'Ana', cid: 'local-1-2', at: T0 },
  message: { type: 'message', text: 'I have the park', by: 'Ana', cid: 'local-1-3', at: T0 },
  assignedPlanner: { type: 'assigned', searcherId: ME, taskId: 'hasty:NE', at: T0, expiresAt: T0 + 3600000, track: [10, 11, 12], searchMin: 30, partnerId: PAL },
  assignedOld: { type: 'assigned', sectorId: 'r3c4', to: 'Ana', toId: ME, at: T0 },
  released: { type: 'released', searcherId: ME, taskId: 'y123', at: T0, track: [5, 6], fraction: 0.5 },
  completed: { type: 'completed', searcherId: ME, taskId: 'p77', at: T0, minutes: 25, track: [1], partnerId: PAL },
  caseUpdate: { type: 'caseUpdate', field: 'minutes', value: 40, by: 'Ana', cid: 'local-1-4', at: T0 },
  found: { type: 'found', lat: 37.55, lng: -121.96, note: 'at the bus stop, safe', by: 'Ana', cid: 'local-1-5', at: T0 },
};
const PLACE = { lat: 37.55, lng: -121.96, label: 'Lake Elizabeth' };
const w = (base, change) => {
  const out = { ...ev[base], ...change };
  for (const [k, v] of Object.entries(change)) if (v === undefined) delete out[k];
  return out;
};

// [name, event, accepted?, serverOnly?] — serverOnly: phones accept it (they don't use their
// own clock), only the database refuses it.
const TABLE = [
  ['searched', ev.searched, true],
  ['searched, minutes 1 (lowest)', w('searched', { minutes: 1 }), true],
  ['searched, minutes 600 (highest)', w('searched', { minutes: 600 }), true],
  ['searched, minutes 12.5', w('searched', { minutes: 12.5 }), true],
  ['searched, no name, no cid', w('searched', { by: undefined, cid: undefined }), true],
  ['sighting', ev.sighting, true],
  ['sighting, no direction (null)', w('sighting', { direction: null }), true],
  ['sighting, empty note', w('sighting', { note: '' }), true],
  ['message', ev.message, true],
  ['message, 150 emoji = 300 UTF-16 units', w('message', { text: '🙂'.repeat(150) }), true],
  ['assigned (planner)', ev.assignedPlanner, true],
  ['assigned (planner, door-knocking yes/no)', w('assignedPlanner', { canvass: false }), true],
  ['assigned, canvass not a yes/no', w('assignedPlanner', { canvass: 'yes' }), false],
  ['released with canvass', w('released', { canvass: true }), false],
  ['assigned (INTERFACES, with toId)', ev.assignedOld, true],
  ['assigned (INTERFACES, no toId)', w('assignedOld', { toId: undefined }), true],
  ['released', ev.released, true],
  ['released, nothing optional', w('released', { track: undefined, fraction: undefined }), true],
  ['completed', ev.completed, true],

  // wrong numbers / ranges
  ['minutes 0', w('searched', { minutes: 0 }), false],
  ['minutes 601', w('searched', { minutes: 601 }), false],
  ['minutes negative', w('searched', { minutes: -5 }), false],
  ['minutes as text', w('searched', { minutes: '20' }), false],
  ['minutes true', w('searched', { minutes: true }), false],
  ['lat 91', w('sighting', { lat: 91 }), false],
  ['lng -181', w('sighting', { lng: -181 }), false],
  ['lat as text', w('sighting', { lat: '37.55' }), false],
  ['lat an object', w('sighting', { lat: { x: 1 } }), false],
  ['reliability 0.5', w('sighting', { reliability: 0.5 }), false],
  ['reliability as text', w('sighting', { reliability: '0.9' }), false],
  ['reliability 1', w('sighting', { reliability: 1 }), false],
  ['direction "up"', w('sighting', { direction: 'up' }), false],
  ['minutesSince 1441', w('sighting', { minutesSince: 1441 }), false],
  ['minutesSince -1', w('sighting', { minutesSince: -1 }), false],
  ['sectorId junk', w('searched', { sectorId: 'r1c1; drop' }), false],
  ['completed minutes 0', w('completed', { minutes: 0 }), false],
  ['fraction 1.5', w('released', { fraction: 1.5 }), false],
  ['searchMin 601', w('assignedPlanner', { searchMin: 601 }), false],
  ['toId not hex', w('assignedOld', { toId: 'ZZZZ' }), false],
  ['searcherId too long', w('released', { searcherId: ME + '00' }), false],
  ['expiresAt before at', w('assignedPlanner', { expiresAt: T0 - 1 }), false],
  ['expiresAt more than 24 h later', w('assignedPlanner', { expiresAt: T0 + 86400001 }), false],
  ['track with a fraction', w('released', { track: [1, 2.5] }), false],
  ['track with a negative', w('released', { track: [-1] }), false],
  ['track with text', w('released', { track: ['7'] }), false],
  ['track not a list', w('released', { track: 'r1c1' }), false],
  ['track cell too big', w('released', { track: [1000000] }), false],

  // time
  ['at missing', w('searched', { at: undefined }), false],
  ['at as text', w('searched', { at: String(T0) }), false],
  ['at 1000 (1970)', w('searched', { at: 1000 }), false],
  ['at 2 hours in the future', w('searched', { at: NOW + 2 * 3600000 }), false, true],
  ['at year 3000', w('searched', { at: 32503680000000 }), false],

  // missing fields, wrong type, extra fields
  ['searched without sectorId', w('searched', { sectorId: undefined }), false],
  ['sighting without reliability', w('sighting', { reliability: undefined }), false],
  ['message without text', w('message', { text: undefined }), false],
  ['message, empty text', w('message', { text: '' }), false],
  ['message, text a number', w('message', { text: 42 }), false],
  ['assigned without task', w('assignedOld', { sectorId: undefined }), false],
  ['assigned without anyone', w('assignedOld', { to: undefined, toId: undefined }), false],
  ['released without taskId', w('released', { taskId: undefined }), false],
  ['unknown type', w('message', { type: 'teleport' }), false],
  ['type missing', w('message', { type: undefined }), false],
  ['type a number', w('message', { type: 3 }), false],
  ['extra field', w('searched', { hack: 1 }), false],
  ['a field of another type (minutes on a sighting)', w('sighting', { minutes: 20 }), false],
  ['a field of another type (text on searched)', w('searched', { text: 'hi' }), false],
  ['an "id" field stored inside', w('searched', { id: '-x' }), false],
  ['cid with a slash', w('searched', { cid: 'a/b' }), false],
  ['not an object (text)', 'hello', false],
  ['not an object (list)', [1, 2, 3], false],
  ['not an object (number)', 7, false],

  // oversized
  ['name 41 characters', w('searched', { by: long(41) }), false],
  ['note 301 characters', w('sighting', { note: long(301) }), false],
  ['message 301 characters', w('message', { text: long(301) }), false],
  ['message 151 emoji = 302 UTF-16 units', w('message', { text: '🙂'.repeat(151) }), false],
  ['message 100,000 characters', w('message', { text: long(100000) }), false],
  ['track of 2,001 squares', w('released', { track: Array.from({ length: 2001 }, (_, i) => i) }), false],
  ['taskId 65 characters', w('released', { taskId: long(65) }), false],

  // caseUpdate: one case field changed after sharing; the value is checked like that case field
  ['caseUpdate minutes', ev.caseUpdate, true],
  ['caseUpdate minutes 1440 (highest)', w('caseUpdate', { value: 1440 }), true],
  ['caseUpdate minutesAt', w('caseUpdate', { field: 'minutesAt', value: T0 }), true],
  ['caseUpdate direction', w('caseUpdate', { field: 'direction', value: 'NE' }), true],
  ['caseUpdate direction cleared (no value)', w('caseUpdate', { field: 'direction', value: undefined }), true],
  ['caseUpdate mobility', w('caseUpdate', { field: 'mobility', value: 'slow' }), true],
  ['caseUpdate familiarPlaces', w('caseUpdate', { field: 'familiarPlaces', value: [PLACE, { lat: 37.5, lng: -121.9 }] }), true],
  ['caseUpdate familiarPlaces cleared (no value)', w('caseUpdate', { field: 'familiarPlaces', value: undefined }), true],
  ['caseUpdate travel', w('caseUpdate', { field: 'travel', value: 'car' }), true],
  ['caseUpdate description', w('caseUpdate', { field: 'description', value: 'blue jacket, white cap' }), true],
  ['caseUpdate description empty', w('caseUpdate', { field: 'description', value: '' }), true],
  ['caseUpdate description cleared (no value)', w('caseUpdate', { field: 'description', value: undefined }), true],
  ['caseUpdate field seed (not allowed)', w('caseUpdate', { field: 'seed', value: 5 }), false],
  ['caseUpdate field lastSeen (not allowed)', w('caseUpdate', { field: 'lastSeen', value: { lat: 1, lng: 1 } }), false],
  ['caseUpdate field engineVersion (not allowed)', w('caseUpdate', { field: 'engineVersion', value: 'x' }), false],
  ['caseUpdate field missing', w('caseUpdate', { field: undefined }), false],
  ['caseUpdate field a number', w('caseUpdate', { field: 7 }), false],
  ['caseUpdate minutes 0', w('caseUpdate', { value: 0 }), false],
  ['caseUpdate minutes 1441', w('caseUpdate', { value: 1441 }), false],
  ['caseUpdate minutes as text', w('caseUpdate', { value: '40' }), false],
  ['caseUpdate minutes an object', w('caseUpdate', { value: { x: 40 } }), false],
  ['caseUpdate minutes without value', w('caseUpdate', { value: undefined }), false],
  ['caseUpdate minutesAt 1000', w('caseUpdate', { field: 'minutesAt', value: 1000 }), false],
  ['caseUpdate mobility junk', w('caseUpdate', { field: 'mobility', value: 'flying' }), false],
  ['caseUpdate mobility without value', w('caseUpdate', { field: 'mobility', value: undefined }), false],
  ['caseUpdate travel junk', w('caseUpdate', { field: 'travel', value: 'plane' }), false],
  ['caseUpdate direction "up"', w('caseUpdate', { field: 'direction', value: 'up' }), false],
  ['caseUpdate description 301', w('caseUpdate', { field: 'description', value: long(301) }), false],
  ['caseUpdate description a number', w('caseUpdate', { field: 'description', value: 5 }), false],
  ['caseUpdate 4 familiar places', w('caseUpdate', { field: 'familiarPlaces', value: [PLACE, PLACE, PLACE, PLACE] }), false],
  ['caseUpdate familiar place lat 91', w('caseUpdate', { field: 'familiarPlaces', value: [{ ...PLACE, lat: 91 }] }), false],
  ['caseUpdate familiar place extra key', w('caseUpdate', { field: 'familiarPlaces', value: [{ ...PLACE, phone: '555' }] }), false],
  ['caseUpdate familiar label 101', w('caseUpdate', { field: 'familiarPlaces', value: [{ ...PLACE, label: long(101) }] }), false],
  ['caseUpdate familiarPlaces not a list', w('caseUpdate', { field: 'familiarPlaces', value: 'Lake' }), false],
  ['caseUpdate familiar place without lng', w('caseUpdate', { field: 'familiarPlaces', value: [{ lat: 37.5 }] }), false],
  ['caseUpdate extra field', w('caseUpdate', { reason: 'typo' }), false],

  // found: the person was found
  ['found', ev.found, true],
  ['found, no note, no name', w('found', { note: undefined, by: undefined }), true],
  ['found lat 91', w('found', { lat: 91 }), false],
  ['found without lng', w('found', { lng: undefined }), false],
  ['found note 301', w('found', { note: long(301) }), false],
  ['found with reliability (a sighting field)', w('found', { reliability: 0.9 }), false],
  ['found with text (a message field)', w('found', { text: 'yay' }), false],
];

test('the event table: sync.js checkEvent accepts exactly the good events', () => {
  for (const [name, event, ok, serverOnly] of TABLE) {
    const reason = sync.checkEvent(event);
    assert.equal(reason === null, ok || !!serverOnly, `${name}: checkEvent said ${reason}`);
  }
});

// ---- A small Firebase rules evaluator ----------------------------------------------------------
// Runs firebase-rules.json the way Firebase does, for the parts our rules use:
//   - a write is allowed if some ".write" on the path from the root down to the written place
//     is true (data = before, newData = after, at that rule's place)
//   - then every ".validate" at the written place, below it, AND above it (with the data as it
//     would be after the write) must be true. The Firebase emulator does check the places above:
//     with the case's completeness check taken out of ".write", it still refused a lone
//     case/minutes write, because of the case's own ".validate" (tested 2026-11-22, emulator
//     v4.11.2; see docs/INTEGRITY-REPORT.md).
//   - "$name" keys match any key and set the variable $name; named keys win
//   - null is never stored; an error in a rule counts as false
// With { above: false } it skips the places above (the weaker reading of Firebase's docs). The
// scenarios are run both ways, so the rules don't depend on that detail.

const RULES = JSON.parse(readFileSync(new URL('../firebase-rules.json', import.meta.url), 'utf8')).rules;
for (const [name, fn] of Object.entries({
  matches(re) { return re.test(this); },
  contains(s) { return this.includes(s); },
  beginsWith(s) { return this.startsWith(s); },
})) Object.defineProperty(String.prototype, name, { value: fn, configurable: true });

function lookup(tree, keys) {
  let node = tree;
  for (const k of keys) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, k)) return null;
    node = node[k];
  }
  return node;
}
class Snap {
  constructor(tree, keys) { this.tree = tree; this.keys = keys; }
  val() { return lookup(this.tree, this.keys); }
  exists() { return this.val() !== null; }
  child(p) { return new Snap(this.tree, [...this.keys, ...String(p).split('/').filter(Boolean)]); }
  parent() { return new Snap(this.tree, this.keys.slice(0, -1)); }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren(list) {
    const v = this.val();
    if (list === undefined) return v !== null && typeof v === 'object' && Object.keys(v).length > 0;
    return v !== null && typeof v === 'object' && list.every((k) => this.hasChild(k));
  }
  isNumber() { return typeof this.val() === 'number'; }
  isString() { return typeof this.val() === 'string'; }
  isBoolean() { return typeof this.val() === 'boolean'; }
}
function stripNulls(v) {
  if (Array.isArray(v)) {
    const items = v.map(stripNulls);
    if (items.every((x) => x === null)) return null;
    if (items.some((x) => x === null)) return Object.fromEntries(items.map((x, i) => [String(i), x]).filter(([, x]) => x !== null));
    return items;
  }
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) { const s = stripNulls(x); if (s !== null) out[k] = s; }
    return Object.keys(out).length ? out : null;
  }
  return v === undefined ? null : v;
}
function setIn(tree, keys, value) {
  if (keys.length === 0) return value === null ? {} : value;
  const copy = structuredClone(tree ?? {});
  let node = copy;
  for (const k of keys.slice(0, -1)) {
    if (node[k] === null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  if (value === null) delete node[keys[keys.length - 1]];
  else node[keys[keys.length - 1]] = value;
  return copy;
}
function step(rule, key) {
  if (!rule || typeof rule !== 'object') return [null, null];
  if (!key.startsWith('.') && !key.startsWith('$') && Object.prototype.hasOwnProperty.call(rule, key)) return [rule[key], null];
  const wild = Object.keys(rule).find((k) => k.startsWith('$'));
  return wild ? [rule[wild], wild] : [null, null];
}
function evalRule(expr, vars) {
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(vars);
  try { return Boolean(new Function(...names, `return (${expr});`)(...names.map((n) => vars[n]))); } catch { return false; }
}
function validateTree(rule, vars, tree, keys, nowMs) {
  const snap = new Snap(tree, keys);
  if (!rule || !snap.exists()) return true;
  if ('.validate' in rule && !evalRule(rule['.validate'], { ...vars, newData: snap, data: snap, root: new Snap(tree, []), now: nowMs, auth: null })) return false;
  const v = snap.val();
  if (v === null || typeof v !== 'object') return true;
  return Object.keys(v).every((k) => {
    const [r, wild] = step(rule, k);
    return validateTree(r, wild ? { ...vars, [wild]: k } : vars, tree, [...keys, k], nowMs);
  });
}
// writes: [[path, value]]. Returns the new tree, or null if Firebase would refuse.
function rulesWrite(oldTree, writes, { nowMs = Date.now(), above = true } = {}) {
  let newTree = oldTree;
  const parsed = writes.map(([p, v]) => [p.split('/').filter(Boolean), stripNulls(v)]);
  for (const [keys, v] of parsed) newTree = setIn(newTree, keys, v);
  for (const [keys] of parsed) {
    let rule = RULES; let vars = {}; let granted = false;
    for (let i = 0; ; i++) {
      if (!granted && rule && '.write' in rule) {
        granted = evalRule(rule['.write'], { ...vars, data: new Snap(oldTree, keys.slice(0, i)), newData: new Snap(newTree, keys.slice(0, i)), root: new Snap(oldTree, []), now: nowMs, auth: null });
      }
      if (i === keys.length) break;
      const here = new Snap(newTree, keys.slice(0, i));
      if (above && rule && '.validate' in rule && here.exists()
        && !evalRule(rule['.validate'], { ...vars, newData: here, data: new Snap(oldTree, keys.slice(0, i)), root: new Snap(oldTree, []), now: nowMs, auth: null })) return null;
      const [r, wild] = step(rule, keys[i]);
      rule = r;
      if (wild) vars = { ...vars, [wild]: keys[i] };
    }
    if (!granted) return null;
    if (!validateTree(rule, vars, newTree, keys, nowMs)) return null;
  }
  return newTree;
}

// ---- Write scenarios: the same list runs against every database stand-in ------------------------
// Each scenario is a list of steps [method, path, body, expected HTTP status] (or
// ['ABSENT', path] = nothing may be stored there). Every scenario uses its own new search, so
// they don't affect each other. The list runs against:
//   - the rules evaluator above (firebase-rules.json)
//   - tools/mock-firebase.py over HTTP
//   - the real Firebase emulator over HTTP, when FIREBASE_EMULATOR is set (see the test)

const goodCase = () => ({ ...stripNulls(CASE), createdAt: NOW, engineVersion: sync.ENGINE_VERSION });
const BAD_CASES = {
  'no engineVersion': { engineVersion: undefined },
  'minutes 0': { minutes: 0 },
  'minutes 1441': { minutes: 1441 },
  'seed 1.5': { seed: 1.5 },
  'seed too big': { seed: 2 ** 32 },
  'mobility junk': { mobility: 'flying' },
  'travel junk': { travel: 'plane' },
  'description 301': { description: long(301) },
  'lastSeen lat 200': { lastSeen: { lat: 200, lng: 0 } },
  'lastSeen extra': { lastSeen: { lat: 1, lng: 1, z: 1 } },
  '4 familiar places': { familiarPlaces: [1, 2, 3, 4].map(() => ({ lat: 1, lng: 1 })) },
  'familiar label 101': { familiarPlaces: [{ lat: 1, lng: 1, label: long(101) }] },
  'extra field': { hack: true },
  'createdAt 2 h ahead': { createdAt: NOW + 2 * 3600000, serverOnly: true },
};
const badCase = (change) => {
  const out = { ...goodCase(), ...change };
  delete out.serverOnly;
  for (const [k, v] of Object.entries(change)) if (v === undefined) delete out[k];
  return out;
};

function scenarios() {
  const list = [];
  const add = (name, steps) => list.push({ name, steps });
  const s = () => sync.newSearchId();

  for (const [name, event, ok] of TABLE) {
    const id = s();
    add(`table: ${name}`, [['PUT', `searches/${id}/case`, goodCase(), 200], ['PUT', `searches/${id}/events/${sync.newPushId()}`, event, ok ? 200 : 401]]);
  }

  {
    const id = s(); const e = `searches/${id}/events`;
    const a = sync.newPushId(); const b = sync.newPushId(); const c = sync.newPushId(); const d = sync.newPushId();
    const fields = Object.fromEntries(Object.entries(ev.message));
    add('events are append-only and cannot be written in pieces', [
      ['PUT', `searches/${id}/case`, goodCase(), 200],
      ['PUT', `${e}/${a}`, ev.message, 200],
      ['PUT', `${e}/${a}`, ev.message, 401],                       // the same event again (a replay)
      ['PUT', `${e}/${a}`, w('message', { text: 'edited' }), 401], // overwrite
      ['PUT', `${e}/${a}/text`, 'edited', 401],                    // edit one field
      ['DELETE', `${e}/${a}`, undefined, 401],
      ['DELETE', e, undefined, 401],
      ['PUT', e, { [sync.newPushId()]: ev.message }, 401],         // replace the whole list
      ['DELETE', `searches/${id}`, undefined, 401],
      ['PUT', `${e}/not-a-push-id`, ev.message, 401],
      ['PUT', `${e}/${b}/type`, 'message', 401],                   // a lone type
      ['PUT', `${e}/${b}/lat`, 37.5, 401],                         // a lone field
      ['PATCH', `${e}/${b}`, fields, 200],                         // a whole event, field by field, in one write
      ['PATCH', `${e}/${c}`, { ...fields, hack: 1 }, 401],
      ['ABSENT', `${e}/${c}`],
      ['POST', e, ev.searched, 200],
      ['POST', e, w('searched', { minutes: 0 }), 401],
      ['PATCH', `searches/${id}`, { [`events/${c}`]: ev.message, [`events/${d}`]: w('message', { text: '' }) }, 401],
      ['ABSENT', `${e}/${c}`],                                     // nothing from the refused PATCH was stored
      ['ABSENT', `${e}/${d}`],
      ['PUT', `searches/${'X'.repeat(32)}/events/${d}`, ev.message, 401],
    ]);
  }

  {
    const id = s(); const c = `searches/${id}/case`;
    add('the case is written once', [
      ['PUT', c, goodCase(), 200],
      ['PUT', c, goodCase(), 401],
      ['PUT', `${c}/minutes`, 999, 401],
      ['PUT', `${c}/minutes`, 50, 401],
      ['DELETE', c, undefined, 401],
    ]);
    add('a case with travel and description', [['PUT', `searches/${s()}/case`, { ...goodCase(), travel: 'car', description: 'blue jacket' }, 200]]);
    for (const [name, change] of Object.entries(BAD_CASES)) add(`bad case: ${name}`, [['PUT', `searches/${s()}/case`, badCase(change), 401]]);
    add('a case under a bad search id', [['PUT', `searches/${id}x/case`, goodCase(), 401]]); // 33 characters
    const p = s();
    add('a case cannot be started one field at a time', [
      ['PUT', `searches/${p}/case/minutes`, 45, 401],
      ['PUT', `searches/${p}/case/lastSeen/lat`, 37, 401],
      ['ABSENT', `searches/${p}/case`],
    ]);
  }

  {
    const id = s(); const me = `searches/${id}/searchers/${ME}`;
    const pos = { lat: 37.5, lng: -121.9, at: NOW, name: 'Ana' };
    add('searcher positions: overwrite and remove, valid shapes only', [
      ['PUT', me, pos, 200],
      ['PUT', me, { ...pos, lat: 37.6 }, 200],
      ['DELETE', me, undefined, 200],
      ['PUT', me, { ...pos, lat: 'x' }, 401],
      ['PUT', me, { ...pos, extra: 1 }, 401],
      ['PUT', me, { ...pos, name: long(41) }, 401],
      ['PUT', `searches/${s()}/searchers/${ME}/lat`, 37.5, 401],
      ['PUT', `searches/${id}/searchers/NOTHEX`, pos, 401],
    ]);
  }
  return list;
}

// Runs every scenario; returns a list of every step whose answer was not the expected one.
async function runScenarios(backend) {
  const wrong = [];
  for (const sc of scenarios()) {
    for (const [method, path, body, expected] of sc.steps) {
      if (method === 'ABSENT') {
        const v = await backend.read(path);
        if (v !== null && v !== undefined) wrong.push(`${sc.name}: ${path} should be empty`);
        continue;
      }
      const status = await backend.write(method, path, body);
      if (status !== expected) wrong.push(`${sc.name}: ${method} ${path.replace(/[0-9a-f]{32}/, '<s>')} → ${status}, expected ${expected}`);
    }
  }
  return wrong;
}

function evaluatorBackend(options = {}) {
  let tree = {};
  return {
    async write(method, path, body) {
      let writes;
      if (method === 'PUT') writes = [[path, body]];
      else if (method === 'DELETE') writes = [[path, null]];
      else if (method === 'POST') writes = [[`${path}/${sync.newPushId()}`, body]];
      else if (method === 'PATCH') writes = Object.entries(body).map(([k, v]) => [`${path}/${k}`, v]);
      const next = rulesWrite(tree, writes, options);
      if (!next) return 401;
      tree = next;
      return 200;
    },
    async read(path) { return lookup(tree, path.split('/').filter(Boolean)); },
  };
}

function httpBackend(base, query = '') {
  const u = (path) => `${base}/${path}.json${query}`;
  return {
    async write(method, path, body) {
      const res = await realFetch(u(path), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      await res.text();
      return res.status;
    },
    async read(path) { return (await realFetch(u(path))).json(); },
    raw: (path, opts) => realFetch(u(path), opts),
  };
}

test('firebase-rules.json (rules evaluator) gives the expected answer to every write scenario', async () => {
  assert.deepEqual(await runScenarios(evaluatorBackend()), []);
  assert.deepEqual(await runScenarios(evaluatorBackend({ above: false })), [], 'without checking the places above');
});

test('checkCase refuses the same bad cases (except the clock check, which only the database does)', () => {
  assert.equal(sync.checkCase(goodCase()), null);
  assert.equal(sync.checkCase({ ...goodCase(), travel: 'bus', description: 'red hat' }), null);
  for (const [name, change] of Object.entries(BAD_CASES)) {
    const reason = sync.checkCase(badCase(change));
    if (change.serverOnly) assert.equal(reason, null, name);
    else assert.notEqual(reason, null, name);
  }
});

// ---- What phones do with what they receive -------------------------------------------------------

test('cleanEvents drops every bad event from the table, counts them, and never throws', () => {
  const events = {};
  const ids = [];
  for (const [, event] of TABLE) { const id = sync.newPushId(T0); ids.push(id); events[id] = event; }
  events['not-a-push-id'] = ev.message;   // bad key
  events[sync.newPushId(T0)] = null;     // nothing there
  const { events: kept, dropped, duplicates } = sync.cleanEvents(events);
  const good = TABLE.filter(([, , ok, serverOnly]) => ok || serverOnly).length;
  assert.equal(kept.length + duplicates, good);
  assert.equal(dropped.length, TABLE.length - good + 2);
  assert.ok(dropped.some((d) => d.id === 'not-a-push-id' && d.reason === 'bad:id'));
  for (const { id, ...stored } of kept) assert.equal(sync.checkEvent(stored), null, id);
  // Garbage in place of the whole list doesn't throw either.
  for (const junk of [undefined, null, 'x', 5, [1, 2], { a: [] }]) assert.doesNotThrow(() => sync.cleanEvents(junk));
});

test('duplicates and replays count once; the same events give the same list on every phone', () => {
  const a = sync.newPushId(T0);
  const b = sync.newPushId(T0 + 1);
  const replay = sync.newPushId(T0 + 2);
  const other = sync.newPushId(T0 + 3);
  const phone1 = { [a]: ev.searched, [b]: ev.sighting, [replay]: { ...ev.searched }, [other]: w('searched', { cid: 'local-9-9' }) };
  // Phone 2 got them in another order, with keys in another order inside each event.
  const flip = (o) => Object.fromEntries(Object.entries(o).reverse());
  const phone2 = Object.fromEntries(Object.entries(phone1).reverse().map(([k, v]) => [k, flip(v)]));
  const r1 = sync.cleanEvents(phone1);
  const r2 = sync.cleanEvents(phone2);
  assert.equal(r1.duplicates, 1);
  assert.deepEqual(r1.events.map((e) => e.id), [a, b, other]); // the copy is left out; a real second search stays
  assert.deepEqual(r2.events.map((e) => e.id), r1.events.map((e) => e.id));
  assert.equal(r1.events.filter((e) => e.type === 'searched').reduce((s, e) => s + e.minutes, 0), 40);
});

test('readMirror: a broken case is refused, a different engine version is flagged', () => {
  const good = { ...CASE, direction: undefined, startedAt: undefined, familiarPlaces: undefined, createdAt: T0, engineVersion: sync.ENGINE_VERSION };
  const r = sync.readMirror(stripNulls({ case: good, events: { [sync.newPushId()]: ev.message } }));
  assert.equal(r.info.versionMismatch, false);
  assert.equal(r.caseDoc.direction, null); // filled back in for the engine
  assert.deepEqual(r.caseDoc.familiarPlaces, []);
  assert.equal(r.events.length, 1);
  const old = sync.readMirror({ case: { ...stripNulls(good), engineVersion: '2026-11-21.0' } });
  assert.equal(old.info.versionMismatch, true);
  assert.equal(old.info.caseEngineVersion, '2026-11-21.0');
  const none = sync.readMirror({ case: { ...stripNulls(good), engineVersion: undefined } });
  assert.equal(none.caseDoc, null);
  assert.equal(none.info.caseProblem, 'missing:engineVersion');
  assert.equal(none.info.versionMismatch, true);
  const broken = sync.readMirror({ case: { ...stripNulls(good), seed: 'abc' }, searchers: { [ME]: { lat: 'x', lng: 1, at: T0 }, [PAL]: { lat: 1, lng: 1, at: T0 } } });
  assert.equal(broken.caseDoc, null);
  assert.equal(broken.info.caseProblem, 'bad:seed');
  assert.deepEqual(Object.keys(broken.searchers), [PAL]);
  assert.equal(sync.readMirror({}).info.versionMismatch, false); // no case yet: nothing to compare
  assert.doesNotThrow(() => sync.readMirror('junk'));
});

test('subscribe: junk from the stream is ignored, bad events never reach onChange', () => {
  const sources = [];
  globalThis.EventSource = class {
    constructor(u) { this.url = u; this.handlers = {}; sources.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.closed = true; }
  };
  const calls = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const stop = sync.subscribe(S1, (...args) => calls.push(args));
    const s = sources[0];
    const good = sync.newPushId(T0);
    const bad = sync.newPushId(T0 + 1);
    s.handlers.put({ data: 'not json {' });
    s.handlers.put({ data: '"just a string"' });
    s.handlers.put({ data: JSON.stringify({ path: '/', data: { events: { [good]: ev.searched, [bad]: w('searched', { minutes: 'lots' }) } } }) });
    s.handlers.patch({ data: JSON.stringify({ path: '/', data: { [`events/${sync.newPushId(T0 + 2)}`]: ev.searched } }) }); // a replay
    assert.equal(calls.length, 2);
    const [caseDoc, events, searchers, info] = calls[1];
    assert.equal(caseDoc, null);
    assert.deepEqual(events.map((e) => e.id), [good]);
    assert.deepEqual(searchers, {});
    assert.equal(info.dropped, 1);
    assert.equal(info.droppedIds[0].reason, 'bad:minutes');
    assert.equal(info.duplicates, 1);
    stop();
    assert.ok(s.closed);
    let status = null;
    sync.subscribe('../x', () => {}, (st) => { status = st; });
    assert.equal(status, 'denied');
  } finally {
    console.warn = warn;
    delete globalThis.EventSource;
  }
});

// ---- caseUpdate: the latest one per field wins -----------------------------------------------------

test('compareIds orders by Unicode code point, the same on every phone', () => {
  assert.ok(sync.compareIds('-', '0') < 0);
  assert.ok(sync.compareIds('Z', 'a') < 0);           // 'Z' (90) before 'a' (97)
  assert.ok(sync.compareIds('ab', 'abc') < 0);
  assert.equal(sync.compareIds('abc', 'abc'), 0);
  assert.ok(sync.compareIds('\u{1F600}', '￿') > 0); // code point 0x1F600 > 0xFFFF (UTF-16 order would say the opposite)
});

test('caseUpdate: latest at wins per field, ties by id; any update beats the first value; cleared fields', () => {
  const pid = (t, tail) => sync.newPushId(t).slice(0, 8) + tail.repeat(12);
  const base = { ...goodCase(), direction: 'N', description: 'red coat' };
  const up = (field, value, at, tail, extra = {}) => {
    const e = { type: 'caseUpdate', field, at, by: 'Ana', ...extra };
    if (value !== undefined) e.value = value;
    return [pid(at, tail), e];
  };
  const events = Object.fromEntries([
    up('minutes', 40, T0 + 1000, 'a'),
    up('minutes', 50, T0 + 2000, 'b'),
    up('minutes', 60, T0 + 2000, 'c'),            // same time as 50: the larger id ('c' > 'b') wins
    up('minutes', 99, T0 - 999999, 'd'),          // older than the others: loses to them
    up('direction', 'NE', T0 + 1000, 'i'),
    up('direction', undefined, T0 + 3000, 'j'),   // cleared later: back to unknown
    up('familiarPlaces', undefined, T0 + 1000, 'e'),
    up('travel', 'bus', T0 + 1000, 'f'),
    up('mobility', 'flying', T0 + 9000, 'g'),     // broken: dropped, so mobility keeps its value
    [pid(T0, 'h'), ev.searched],
  ]);
  const r = sync.readMirror({ case: base, events });
  assert.equal(r.caseDoc.minutes, 60);
  assert.equal(r.caseDoc.direction, null);
  assert.deepEqual(r.caseDoc.familiarPlaces, []);
  assert.equal(r.caseDoc.travel, 'bus');
  assert.equal(r.caseDoc.mobility, base.mobility);
  assert.equal(r.caseDoc.description, 'red coat'); // never updated: the first value stays
  assert.equal(r.baseCase.minutes, base.minutes);   // the case as written is kept too
  assert.equal(r.baseCase.direction, 'N');
  assert.equal(r.info.caseUpdates, 8);
  assert.equal(r.info.dropped, 1);
  // Another phone with the events in another order gets exactly the same case.
  const r2 = sync.readMirror({ case: base, events: Object.fromEntries(Object.entries(events).reverse()) });
  assert.deepEqual(r2.caseDoc, r.caseDoc);
  // The merged case is still a valid case.
  const stored = Object.fromEntries(Object.entries(r.caseDoc).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)));
  assert.equal(sync.checkCase(stored), null);
  // applyCaseUpdates doesn't change what it was given.
  assert.equal(base.minutes, CASE.minutes);
  assert.equal(sync.applyCaseUpdates(null, []), null);
});

test('addEvent sends a caseUpdate; a cleared value is simply left out, as Firebase stores it', async () => {
  online = true;
  sync.setDbUrl('https://db.example');
  const before = posted.length;
  assert.equal((await sync.addEvent(S1, { type: 'caseUpdate', field: 'familiarPlaces', value: [], at: T0 })).ok, true);
  assert.equal((await sync.addEvent(S1, { type: 'caseUpdate', field: 'direction', value: null, at: T0 })).ok, true);
  assert.equal((await sync.addEvent(S1, { type: 'caseUpdate', field: 'minutes', value: null, at: T0 })).reason, 'missing:value');
  assert.equal((await sync.addEvent(S1, { type: 'found', lat: 37.5, lng: -121.9, at: T0, by: 'Ana' })).ok, true);
  const sent = posted.slice(before).map((p) => p.body);
  assert.equal(sent.length, 3);
  assert.ok(!('value' in sent[0]) && !('value' in sent[1]));
  assert.equal(sent[2].type, 'found');
});

// ---- The mock database and the Firebase emulator, over real HTTP -----------------------------------

let mock = null;
let mockUrl = null;
const startMock = () => new Promise((resolve) => {
  const child = spawn('python3', [`${root}tools/mock-firebase.py`, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', () => resolve(null)); // no python3: those tests are skipped
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
    const m = /localhost:(\d+)/.exec(out);
    if (m && !mockUrl) { mockUrl = `http://localhost:${m[1]}`; resolve(child); }
  });
  child.stderr.on('data', () => {});
  setTimeout(() => resolve(null), 5000);
});
after(() => { if (mock) mock.kill(); });

test('tools/mock-firebase.py gives the expected answer to every write scenario', async (t) => {
  mock = await startMock();
  if (!mock) { t.skip('python3 not available'); return; }
  const wrong = await runScenarios(httpBackend(mockUrl));
  assert.deepEqual(wrong, []);
});

// Only over HTTP: a body that isn't JSON, and reading outside a search.
async function httpOnlyChecks(backend) {
  const res = await backend.raw(`searches/${sync.newSearchId()}/events/${sync.newPushId()}`, { method: 'PUT', body: '{not json' });
  assert.equal(res.status, 400);
  await res.text();
  const all = await backend.raw('');
  assert.equal(all.status, 401, 'reading the whole database');
  await all.text();
}

test('mock: a body that is not JSON gets 400; reading the whole database is refused', async (t) => {
  if (!mock) { t.skip('python3 not available'); return; }
  await httpOnlyChecks(httpBackend(mockUrl));
});

// The real Firebase Realtime Database emulator (firebase-tools, needs Java), loaded with
// firebase-rules.json. Run it, then point this test at it, for example:
//   firebase emulators:start --only database --project demo-findthem
//   FIREBASE_EMULATOR='http://127.0.0.1:9000?ns=demo-findthem-default-rtdb' node --test tests/sync.test.js
// (firebase.json: { "database": { "rules": "firebase-rules.json" }, "emulators": { "database": { "port": 9000 } } })
test('the Firebase emulator gives the expected answer to every write scenario', async (t) => {
  const target = process.env.FIREBASE_EMULATOR;
  if (!target) { t.skip('set FIREBASE_EMULATOR to run against the Firebase emulator'); return; }
  const u = new URL(target);
  const backend = httpBackend(`${u.origin}${u.pathname.replace(/\/$/, '')}`, u.search);
  const wrong = await runScenarios(backend);
  if (wrong.length) console.log(`Firebase emulator disagreed on ${wrong.length} steps:\n${wrong.join('\n')}`);
  assert.deepEqual(wrong, []);
  await httpOnlyChecks(backend);
});

test('mock + sync.js: a send whose answer was lost is retried at the same id and stored once', async (t) => {
  if (!mock) { t.skip('python3 not available'); return; }
  const SR = 'd4'.repeat(16);
  sync.setDbUrl(mockUrl);
  let loseAnswer = true;
  globalThis.fetch = async (url, opts) => {
    const res = await realFetch(url, opts);
    if (loseAnswer && opts && opts.method === 'PUT') { loseAnswer = false; throw new Error('connection dropped'); }
    return res;
  };
  try {
    const r1 = await sync.addEvent(SR, ev.searched);
    assert.equal(r1.error, 'offline'); // it did reach the database, but this phone can't know
    assert.equal(sync.pendingCount(), 1);
    const r2 = await sync.flushQueue(); // refused as "already there", then confirmed by reading it
    assert.equal(r2.ok, true);
    assert.equal(sync.pendingCount(), 0);
    const stored = await (await realFetch(`${mockUrl}/searches/${SR}/events.json`)).json();
    assert.equal(Object.keys(stored).length, 1);
    const r3 = await sync.addEvent(SR, { ...ev.searched, at: NOW + 3 * 3600000 }); // phone clock far ahead
    assert.equal(r3.ok, false);
    assert.equal(r3.error, 'rejected');
    assert.equal(sync.pendingCount(), 0); // a refused event isn't retried forever
  } finally {
    globalThis.fetch = async () => { throw new Error('offline'); };
  }
});
