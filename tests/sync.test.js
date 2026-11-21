// Tests for sync.js: mirror patching, event sorting, and the offline queue.
// fetch and localStorage are replaced with small fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
let online = false;
const posted = [];
globalThis.fetch = async (url, opts) => {
  if (!online) throw new Error('offline');
  posted.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ name: '-p' + posted.length }) };
};

const sync = await import('../sync.js');

test('newSearchId is 32 hex chars and random', () => {
  const a = sync.newSearchId();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, sync.newSearchId());
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

test('sortedEvents sorts by at then id and adds ids', () => {
  const list = sync.sortedEvents({ '-b': { at: 5 }, '-a': { at: 5 }, '-c': { at: 1 } });
  assert.deepEqual(list.map((e) => e.id), ['-c', '-a', '-b']);
  assert.deepEqual(sync.sortedEvents(undefined), []);
});

test('addEvent without DB url queues', async () => {
  const r = await sync.addEvent('s1', { type: 'message', text: 'x', at: 1 });
  assert.equal(r.queued, true);
  assert.equal(r.error, 'no-db-url');
  assert.equal(sync.pendingCount(), 1);
});

test('offline events queue, then flush in order when online', async () => {
  sync.setDbUrl('https://db.example');
  const r = await sync.addEvent('s1', { type: 'message', text: 'y', at: 2, id: 'ignored' });
  assert.equal(r.error, 'offline');
  assert.equal(sync.pendingCount(), 2);
  online = true;
  const r2 = await sync.addEvent('s1', { type: 'message', text: 'z', at: 3 });
  assert.equal(r2.ok, true);
  assert.equal(sync.pendingCount(), 0);
  assert.deepEqual(posted.map((p) => p.body.text), ['x', 'y', 'z']);
  assert.equal(posted[0].url, 'https://db.example/searches/s1/events.json');
  assert.ok(!('id' in posted[1].body));
});

test('createSearch PUTs case with createdAt', async () => {
  const calls = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const r = await sync.createSearch('s2', { seed: 7 });
  globalThis.fetch = old;
  assert.equal(r.ok, true);
  assert.equal(calls[0].opts.method, 'PUT');
  assert.equal(calls[0].url, 'https://db.example/searches/s2/case.json');
  assert.ok(JSON.parse(calls[0].opts.body).createdAt > 0);
});
