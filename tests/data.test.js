// tests/data.test.js — the street download tells "no internet" apart from "server busy".
// Runs with `node --test`. fetch and navigator.onLine are faked; nothing goes online.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOverpass, searchPlaces } from '../data.js';

const realFetch = globalThis.fetch;
function setOnline(value) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
}
afterEach(() => {
  globalThis.fetch = realFetch;
  setOnline(true);
});

test('a failed connection is reported as offline, not busy', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const reports = [];
  await assert.rejects(
    fetchOverpass(37.55, -121.97, 3200, { attempts: 2, firstDelayMs: 1, onProgress: (p) => reports.push(p) }),
    (err) => err.offline === true,
  );
  const retry = reports.find((p) => p.stage === 'retry');
  assert.equal(retry.reason, 'offline');
});

test('a 504 from the server is reported as busy', async () => {
  globalThis.fetch = async () => new Response('busy', { status: 504 });
  const reports = [];
  await assert.rejects(
    fetchOverpass(37.55, -121.97, 3200, { attempts: 2, firstDelayMs: 1, onProgress: (p) => reports.push(p) }),
    (err) => !err.offline,
  );
  assert.equal(reports.find((p) => p.stage === 'retry').reason, 'busy');
});

test('when the phone says it is offline, it stops at once without trying', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
  setOnline(false);
  await assert.rejects(fetchOverpass(37.55, -121.97, 3200, { firstDelayMs: 1 }), (err) => err.offline === true);
  assert.equal(calls, 0);
});

test('a download that works reports bytes and returns the JSON', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ elements: [] }), { status: 200 });
  const reports = [];
  const json = await fetchOverpass(37.55, -121.97, 3200, { onProgress: (p) => reports.push(p) });
  assert.deepEqual(json, { elements: [] });
  assert.ok(reports.some((p) => p.stage === 'download' && p.bytes > 0));
});

test('place search marks a failed connection as offline', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(searchPlaces('Lake Elizabeth'), (err) => err.offline === true);
});

test('two failed connections in a row stop the retries (Wi-Fi with no internet)', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchOverpass(37.55, -121.97, 3200, { attempts: 5, firstDelayMs: 1 }), (err) => err.offline === true);
  assert.equal(calls, 2);
});
