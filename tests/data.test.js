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

// ---- Two-phase download, square areas, coverage (added with the "prior v2" engine) ------------
// These run loadArea() itself. Node has no IndexedDB, so nothing is saved or found saved: the
// function logs "could not read / save" and carries on, exactly as a phone in private browsing does.

import { loadArea, coversGrid, boxAround, parseOverpass, relationFeatures, buildQuery, buildLayersQuery, GRID_HALF_M, DEFAULT_RADIUS_M, HOME_RADIUS_M } from '../data.js';

const STREETS = { elements: [
  { type: 'way', id: 1, nodes: [10, 11], geometry: [{ lat: 37.55, lon: -121.97 }, { lat: 37.551, lon: -121.97 }], tags: { highway: 'residential', name: 'Test St' } },
  { type: 'way', id: 2, nodes: [20, 21, 22, 20], geometry: [{ lat: 37.552, lon: -121.97 }, { lat: 37.553, lon: -121.97 }, { lat: 37.553, lon: -121.969 }, { lat: 37.552, lon: -121.97 }], tags: { natural: 'water', name: 'Test Pond' } },
] };
const LAYERS = { elements: [
  { type: 'way', id: 3, nodes: [1, 2, 3, 4, 1], geometry: [{ lat: 37.5501, lon: -121.9701 }, { lat: 37.5502, lon: -121.9701 }, { lat: 37.5502, lon: -121.97 }, { lat: 37.5501, lon: -121.97 }, { lat: 37.5501, lon: -121.9701 }] }, // no tags = a building
  { type: 'way', id: 4, nodes: [5, 6], geometry: [{ lat: 37.55, lon: -121.971 }, { lat: 37.551, lon: -121.971 }], tags: { barrier: 'fence' } },
  { type: 'node', id: 7, lat: 37.5505, lon: -121.9705 },
] };
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

test('loadArea is two-phase: a full area from the streets first, buildings and land use later', async () => {
  const bodies = [];
  let sendLayers; // the test decides when the second (big) answer arrives
  const layersArrive = new Promise((resolve) => { sendLayers = resolve; });
  globalThis.fetch = async (url, options) => {
    bodies.push(decodeURIComponent(options.body));
    if (bodies.length === 1) return new Response(JSON.stringify(STREETS), { status: 200 });
    await layersArrive;
    return new Response(JSON.stringify(LAYERS), { status: 200 });
  };
  // loadArea returns while the second answer is still on its way: the first map doesn't wait.
  const result = await quiet(() => loadArea(37.55012, -121.97049));
  // Phase 1: streets, creeks, parks. Enough for the engine; no ground layers yet.
  assert.equal(result.osm.ways.length, 1);
  assert.equal(result.osm.features.length, 1);
  assert.equal(result.osm.layers, undefined);
  assert.match(bodies[0], /highway/);
  assert.doesNotMatch(bodies[0], /building/);
  // The download is a square around the case's grid origin (the point rounded to 3 decimals),
  // a little bigger than the engine's map.
  assert.deepEqual(result.osm.center, { lat: 37.55, lng: -121.97 });
  assert.equal(result.osm.radiusM, DEFAULT_RADIUS_M);
  assert.ok(DEFAULT_RADIUS_M > GRID_HALF_M);
  const b = boxAround(37.55, -121.97, DEFAULT_RADIUS_M);
  assert.deepEqual(result.osm.bounds, b);
  assert.ok(bodies[0].includes(`[bbox:${b.south},${b.west},${b.north},${b.east}]`));
  // Phase 2 arrives later through `more`.
  assert.ok(result.more instanceof Promise);
  sendLayers();
  const better = await quiet(() => result.more);
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /building/);
  assert.equal(better.osm.layers.buildings.length, 1);
  assert.equal(better.osm.layers.lines[0].kind, 'fence');
  assert.equal(better.osm.layers.busStops.length, 1);
  assert.equal(better.osm.ways, result.osm.ways, 'the streets are the same objects: nothing is downloaded twice');
});

test('if the second download fails, the first map simply stays (more gives null, never an error)', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify(STREETS), { status: 200 });
    throw new TypeError('Failed to fetch');
  };
  const result = await quiet(() => loadArea(37.55, -121.97));
  assert.equal(result.osm.ways.length, 1);
  assert.equal(await quiet(() => result.more), null);
});

test('a saved area is reused only if it covers the whole map', () => {
  const origin = { lat: 37.55, lng: -121.97 };
  const square = (lat, lng, half) => ({ center: { lat, lng }, radiusM: half, bounds: boxAround(lat, lng, half) });
  assert.equal(coversGrid(square(37.55, -121.97, DEFAULT_RADIUS_M), origin), true);
  // The same size of square centered 700 m north: the map's south edge has no data.
  assert.equal(coversGrid(square(37.5563, -121.97, DEFAULT_RADIUS_M), origin), false);
  // A "home area" is saved bigger, so a last-seen point 700 m away is still covered.
  assert.equal(coversGrid(square(37.5563, -121.97, HOME_RADIUS_M), origin), true);
  // An area saved before Nov 22 was a circle of 3.2 km: it never reaches the map's corners.
  assert.equal(coversGrid({ center: origin, radiusM: 3200 }, origin), false);
  assert.equal(coversGrid(null, origin), false);
});

test('the two requests ask for different things, both by box', () => {
  const streets = buildQuery(37.55, -121.97);
  const layers = buildLayersQuery(37.55, -121.97);
  for (const q of [streets, layers]) assert.match(q, /\[bbox:[-\d.,]+\]/);
  assert.match(streets, /waterway/);
  assert.match(streets, /relation\[natural/);
  assert.doesNotMatch(streets, /pressurised/);
  assert.match(layers, /way\[building\]/);
  assert.match(layers, /bus_stop/);
  assert.match(layers, /motorway/);
});

test('a lake stored as a relation becomes one area feature, its pieces joined end to end', () => {
  const lake = { type: 'relation', id: 99, tags: { natural: 'water', name: 'Split Lake' }, members: [
    { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }] },
    { type: 'way', role: 'inner', geometry: [{ lat: 1.4, lon: 1.4 }, { lat: 1.5, lon: 1.5 }, { lat: 1.4, lon: 1.5 }, { lat: 1.4, lon: 1.4 }] }, // an island: ignored
    { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 1 }, { lat: 2, lon: 2 }] }, // runs the other way round
  ] };
  const features = relationFeatures(lake);
  assert.equal(features.length, 1);
  assert.equal(features[0].id, 'r99');
  assert.equal(features[0].type, 'water');
  assert.equal(features[0].shape, 'area');
  assert.equal(features[0].points.length, 5);
  assert.deepEqual(features[0].points[0], features[0].points[4]);
  const osm = parseOverpass({ elements: [lake] }, { lat: 1.5, lng: 1.5 }, 3400);
  assert.equal(osm.features[0].name, 'Split Lake');
});
