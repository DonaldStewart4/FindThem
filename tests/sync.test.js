// Tests for sync.js: mirror patching, event sorting, the offline queue, and the integrity
// rules (no event can corrupt the shared map).
//
// The integrity part checks ONE table of good and bad events three ways, and all three must agree:
//   1. sync.js checkEvent: what every phone accepts from the database
//   2. firebase-rules.json, run by the small rules evaluator below: what Firebase accepts
//   3. tools/mock-firebase.py, over real HTTP: what the local test database accepts
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
};
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
//   - then every ".validate" at the written place and below it must be true
//   - "$name" keys match any key and set the variable $name; named keys win
//   - null is never stored; an error in a rule counts as false
// Validates only at and below the written place, which is the weaker of the two readings of
// Firebase's docs, so the rules are tested to be safe even then.

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
function rulesWrite(oldTree, writes, nowMs = Date.now()) {
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
      const [r, wild] = step(rule, keys[i]);
      rule = r;
      if (wild) vars = { ...vars, [wild]: keys[i] };
    }
    if (!granted) return null;
    if (!validateTree(rule, vars, newTree, keys, nowMs)) return null;
  }
  return newTree;
}

const withCase = { searches: { [S1]: { case: { ...CASE, direction: undefined, startedAt: undefined, createdAt: T0, engineVersion: 'x' } } } };

test('the event table: firebase-rules.json accepts exactly the good events', () => {
  for (const [name, event, ok] of TABLE) {
    const result = rulesWrite(withCase, [[`searches/${S1}/events/${sync.newPushId()}`, event]]);
    assert.equal(result !== null, ok, `${name}: rules said ${result ? 'yes' : 'no'}`);
  }
});

test('rules: events are append-only, need a push id, and cannot be written in pieces', () => {
  const id = sync.newPushId();
  const t1 = rulesWrite(withCase, [[`searches/${S1}/events/${id}`, ev.message]]);
  assert.ok(t1);
  assert.equal(rulesWrite(t1, [[`searches/${S1}/events/${id}`, w('message', { text: 'edited' })]]), null, 'overwrite');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/events/${id}/text`, 'edited']]), null, 'edit one field');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/events/${id}`, null]]), null, 'delete');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/events`, null]]), null, 'delete all events');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/events`, { [sync.newPushId()]: ev.message }]]), null, 'replace the whole list');
  assert.equal(rulesWrite(t1, [[`searches/${S1}`, null]]), null, 'delete the search');
  assert.equal(rulesWrite(withCase, [[`searches/${S1}/events/not-a-push-id`, ev.message]]), null, 'bad id');
  const id2 = sync.newPushId();
  assert.equal(rulesWrite(withCase, [[`searches/${S1}/events/${id2}/type`, 'message']]), null, 'a lone type');
  assert.equal(rulesWrite(withCase, [[`searches/${S1}/events/${id2}/lat`, 37.5]]), null, 'a lone field');
  // Several fields at once with PATCH: fine if together they make a whole, valid event.
  const fields = Object.entries(ev.message).map(([k, v]) => [`searches/${S1}/events/${id2}/${k}`, v]);
  assert.ok(rulesWrite(withCase, fields), 'PATCH of a whole event');
  assert.equal(rulesWrite(withCase, [...fields, [`searches/${S1}/events/${id2}/hack`, 1]]), null, 'PATCH with an extra field');
  assert.equal(rulesWrite(withCase, [[`searches/${'X'.repeat(32)}/events/${id2}`, ev.message]]), null, 'bad search id');
});

test('rules: the case is written once, whole and valid', () => {
  const caseDoc = { ...CASE, createdAt: NOW, engineVersion: sync.ENGINE_VERSION };
  const t1 = rulesWrite({}, [[`searches/${S1}/case`, caseDoc]]);
  assert.ok(t1, 'a good case');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/case`, caseDoc]]), null, 'written twice');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/case/minutes`, 999]]), null, 'changed later');
  assert.equal(rulesWrite(t1, [[`searches/${S1}/case`, null]]), null, 'deleted');
  const bad = {
    'no engineVersion': { ...caseDoc, engineVersion: undefined },
    'minutes 0': { ...caseDoc, minutes: 0 },
    'minutes 1441': { ...caseDoc, minutes: 1441 },
    'seed 1.5': { ...caseDoc, seed: 1.5 },
    'seed too big': { ...caseDoc, seed: 2 ** 32 },
    'mobility junk': { ...caseDoc, mobility: 'flying' },
    'lastSeen lat 200': { ...caseDoc, lastSeen: { lat: 200, lng: 0 } },
    'lastSeen extra': { ...caseDoc, lastSeen: { lat: 1, lng: 1, z: 1 } },
    '4 familiar places': { ...caseDoc, familiarPlaces: [1, 2, 3, 4].map(() => ({ lat: 1, lng: 1 })) },
    'familiar label 101': { ...caseDoc, familiarPlaces: [{ lat: 1, lng: 1, label: long(101) }] },
    'extra field': { ...caseDoc, hack: true },
    'createdAt 2 h ahead': { ...caseDoc, createdAt: NOW + 2 * 3600000 },
  };
  for (const [name, c] of Object.entries(bad)) {
    assert.equal(rulesWrite({}, [[`searches/${S1}/case`, c]]), null, name);
    if (name !== 'createdAt 2 h ahead') assert.notEqual(sync.checkCase(stripNulls(c)), null, `checkCase: ${name}`);
  }
  // Written in pieces (each piece alone is incomplete): refused.
  assert.equal(rulesWrite({}, [[`searches/${S1}/case/minutes`, 45]]), null, 'one field first');
  assert.equal(rulesWrite({}, [[`searches/${S1}/case/lastSeen/lat`, 37]]), null, 'one nested field first');
  assert.equal(sync.checkCase(stripNulls(caseDoc)), null);
});

test('rules: searcher positions can be overwritten and removed, but only with a valid shape', () => {
  const pos = { lat: 37.5, lng: -121.9, at: NOW, name: 'Ana' };
  const t1 = rulesWrite({}, [[`searches/${S1}/searchers/${ME}`, pos]]);
  assert.ok(t1);
  assert.ok(rulesWrite(t1, [[`searches/${S1}/searchers/${ME}`, { ...pos, lat: 37.6 }]]), 'overwrite');
  assert.ok(rulesWrite(t1, [[`searches/${S1}/searchers/${ME}`, null]]), 'remove');
  assert.equal(rulesWrite({}, [[`searches/${S1}/searchers/${ME}`, { ...pos, lat: 'x' }]]), null, 'lat text');
  assert.equal(rulesWrite({}, [[`searches/${S1}/searchers/${ME}`, { ...pos, extra: 1 }]]), null, 'extra');
  assert.equal(rulesWrite({}, [[`searches/${S1}/searchers/${ME}`, { ...pos, name: long(41) }]]), null, 'long name');
  assert.equal(rulesWrite({}, [[`searches/${S1}/searchers/${ME}/lat`, 37.5]]), null, 'a lone field');
  assert.equal(rulesWrite({}, [[`searches/${S1}/searchers/NOTHEX`, pos]]), null, 'bad id');
  assert.equal(sync.checkSearcher(pos), null);
  assert.equal(sync.checkSearcher({ ...pos, lat: 'x' }), 'bad:lat');
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

// ---- The mock database, over real HTTP ------------------------------------------------------------

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

async function put(path, body, method = 'PUT') {
  const res = await realFetch(`${mockUrl}/${path}.json`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.status;
}

test('the event table: tools/mock-firebase.py accepts exactly the good events', async (t) => {
  mock = await startMock();
  if (!mock) { t.skip('python3 not available'); return; }
  assert.equal(await put(`searches/${S1}/case`, { ...stripNulls(CASE), createdAt: NOW, engineVersion: sync.ENGINE_VERSION }), 200);
  for (const [name, event, ok] of TABLE) {
    const status = await put(`searches/${S1}/events/${sync.newPushId()}`, event);
    assert.equal(status, ok ? 200 : 401, `${name}: mock said ${status}`);
  }
});

test('mock: append-only events, write-once case, all-or-nothing PATCH, no deletes', async (t) => {
  if (!mock) { t.skip('python3 not available'); return; }
  const id = sync.newPushId();
  assert.equal(await put(`searches/${S1}/events/${id}`, ev.message), 200);
  assert.equal(await put(`searches/${S1}/events/${id}`, ev.message), 401, 'same id again (a replay)');
  assert.equal(await put(`searches/${S1}/events/${id}/text`, 'edited'), 401, 'edit');
  assert.equal(await put(`searches/${S1}/events/${id}`, null, 'DELETE'), 401, 'delete');
  assert.equal(await put(`searches/${S1}/events`, {}, 'PUT'), 401, 'replace the whole list');
  assert.equal(await put(`searches/${S1}/case`, { ...stripNulls(CASE), createdAt: NOW, engineVersion: 'x' }), 401, 'case again');
  assert.equal(await put(`searches/${S1}/events`, ev.searched, 'POST'), 200, 'POST of a good event');
  assert.equal(await put(`searches/${S1}/events`, w('searched', { minutes: 0 }), 'POST'), 401, 'POST of a bad event');
  const a = sync.newPushId(); const b = sync.newPushId();
  assert.equal(await put(`searches/${S1}`, { [`events/${a}`]: ev.message, [`events/${b}`]: w('message', { text: '' }) }, 'PATCH'), 401, 'PATCH with one bad event');
  const list = await (await realFetch(`${mockUrl}/searches/${S1}/events.json`)).json();
  assert.ok(!(a in list) && !(b in list), 'nothing from the refused PATCH was written');
  assert.equal(list[id].text, ev.message.text, 'the first copy is unchanged');
  const res = await realFetch(`${mockUrl}/searches/${S1}/events/${sync.newPushId()}.json`, { method: 'PUT', body: '{not json' });
  assert.equal(res.status, 400);
  assert.equal((await realFetch(`${mockUrl}/.json`)).status, 401, 'reading the whole database');
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
