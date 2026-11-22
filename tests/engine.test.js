// Tests for the engine on the real Fremont fixture: the 10 m ground map (surface.js), the
// walkers (sim.js), the probability map (grid.js) and routes (routes.js).
// Written with Claude Code; see README "Who built what".
// Run just these with:   node --test tests/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../engine/index.js';
import { prepareArea } from '../engine/graph.js';
import { simulate, N_WALKERS, STOP, KIND } from '../engine/sim.js';
import { PARAMS } from '../engine/params.js';
import {
  buildSurface, cellAt, snapToNetwork, latLngToXY, C, SURFACE_N,
} from '../engine/surface.js';
import {
  podForMinutes, sectorBoundsXY, sectorIdAt, gridOriginFor, groundClassAt, SPOT_SEPARATION_M,
} from '../engine/grid.js';

const osm = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-area.json', import.meta.url)));
const area = prepareArea(osm);
const START = { lat: 37.5405, lng: -121.9795 }; // the Demo's last-seen point
const CASE = {
  lastSeen: START, minutes: 45, direction: 'NE', mobility: 'slow',
  familiarPlaces: [{ lat: 37.5485, lng: -121.963, label: 'Lake Elizabeth' }], seed: 20261121,
};
const ORIGIN = gridOriginFor(CASE);
const surface = buildSurface(osm, ORIGIN);
const startCell = snapToNetwork(surface, cellAt(surface, START.lat, START.lng));
const run = (overrides = {}) => simulate(surface, { startCell, minutes: 45, seed: 1, ...overrides });

// Straight-line meters from the start to where walker w is at minute m (NaN if it left the map).
function distanceAt(walks, w, m) {
  const cell = walks.pos[w * (walks.T + 1) + m];
  if (cell < 0) return NaN;
  return 10 * Math.hypot(Math.floor(cell / SURFACE_N) - Math.floor(startCell / SURFACE_N), (cell % SURFACE_N) - (startCell % SURFACE_N));
}
const distancesAt = (walks, m) => Array.from({ length: walks.n }, (_, w) => distanceAt(walks, w, m)).filter(Number.isFinite);
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const sum = (p) => p.reduce((a, b) => a + b, 0);
const total = (pred) => sum(pred.grid.p) + pred.restOfWorld; // the map plus "not on this map"
function near1(x) { assert.ok(Math.abs(x - 1) < 1e-9, `sum is ${x}`); }

// ---- Ground map ----------------------------------------------------------------------------------

test('ground map: Lake Elizabeth is water, and roads, paths, buildings, creeks, yards and fences are all there', () => {
  assert.equal(groundClassAt(area, CASE, 37.5485, -121.9630), 'water'); // in the lake
  const counts = new Array(16).fill(0);
  for (const v of surface.cls) counts[v] += 1;
  for (const k of [C.ROAD, C.PATH, C.BUILDING, C.WATER, C.CREEK, C.YARD, C.BARRIER]) {
    assert.ok(counts[k] > 100, `class ${k} should appear on the map`);
  }
  assert.ok(surface.hasLayers);
});

test('ground map: an area saved before the new layers existed still works', () => {
  const { layers, ...oldOsm } = osm; // what a phone saved before Nov 22 holds
  const oldArea = prepareArea(oldOsm);
  const pred = engine.replay(oldArea, CASE, []);
  near1(total(pred));
  assert.ok(engine.topSpots(oldArea, pred, 3).length > 0);
  const oldSurface = buildSurface(oldOsm, ORIGIN);
  assert.equal(oldSurface.hasLayers, false);
  assert.ok(!oldSurface.cls.includes(C.BUILDING), 'no building layer, so no building squares');
});

test('ground map: a last-seen point in the lake or in a house starts on walkable ground', () => {
  const inLake = cellAt(surface, 37.5485, -121.9630);
  assert.equal(surface.cls[inLake], C.WATER);
  const snapped = snapToNetwork(surface, inLake);
  assert.ok(surface.region[snapped], 'snapped square is joined to the street network');
  // Walkers from there spread out instead of piling up in one spot (the old "island" bug).
  const walks = simulate(surface, { startCell: snapped, minutes: 60, seed: 3 });
  const where = new Map();
  for (let w = 0; w < walks.n; w++) {
    const cell = walks.pos[w * (walks.T + 1) + walks.T];
    where.set(cell, (where.get(cell) || 0) + 1);
  }
  assert.ok(Math.max(...where.values()) < 0.5 * walks.n, 'no single square holds half the walkers');
});

// ---- Walkers -------------------------------------------------------------------------------------

test('walkers: same seed gives identical results, a different seed does not', () => {
  const a = run({ seed: 42 });
  const b = run({ seed: 42 });
  const c = run({ seed: 43 });
  assert.equal(a.n, N_WALKERS);
  assert.deepEqual(a.pos, b.pos);
  assert.deepEqual(a.reason, b.reason);
  assert.notDeepEqual(a.pos, c.pos);
});

test('walkers: positions are stored every minute, and a longer run starts the same way', () => {
  const short = run({ minutes: 60, seed: 5 });
  const long = run({ minutes: 120, seed: 5 });
  assert.equal(short.pos.length, N_WALKERS * 61);
  assert.equal(long.pos.length, N_WALKERS * 121);
  for (let w = 0; w < N_WALKERS; w += 7) {
    for (let m = 0; m <= 60; m += 5) {
      assert.equal(short.pos[w * 61 + m], long.pos[w * 121 + m], `walker ${w} minute ${m}`);
    }
  }
});

test('walkers: they differ from each other (speed, kind, road habit)', () => {
  const walks = run();
  const speeds = Array.from(walks.speed);
  const mean = sum(speeds) / speeds.length;
  const sd = Math.sqrt(sum(speeds.map((v) => (v - mean) ** 2)) / speeds.length);
  assert.ok(Math.abs(mean - PARAMS.SPEED_MEAN_MPS) < 0.03, `mean speed ${mean.toFixed(3)}`);
  assert.ok(sd > 0.15 && sd < 0.3, `speed spread ${sd.toFixed(3)} (the old engine had 0)`);
  const kinds = new Set(walks.kind);
  assert.ok(kinds.has(KIND.DIRECTION) && kinds.has(KIND.WANDER) && kinds.has(KIND.STAYER));
  const followers = sum(Array.from(walks.follower)) / walks.n;
  assert.ok(followers > 0.1 && followers < 0.4, `road followers ${followers.toFixed(2)}`);
  // So they don't all stop at the same distance: the spread of distances is wide.
  const d = distancesAt(walks, 45).sort((a, b) => a - b);
  assert.ok(d[Math.floor(d.length * 0.9)] > 3 * d[Math.floor(d.length * 0.25)]);
});

test('walkers: never inside a building or a fence; in water only if they walked in', () => {
  const walks = run({ minutes: 120, seed: 9 });
  for (let w = 0; w < walks.n; w++) {
    for (let m = 0; m <= walks.T; m += 3) {
      const cell = walks.pos[w * (walks.T + 1) + m];
      if (cell < 0) continue;
      const v = surface.cls[cell];
      assert.ok(v !== C.BUILDING && v !== C.BARRIER, `walker ${w} minute ${m} is inside class ${v}`);
      if (v === C.WATER) assert.equal(walks.reason[w], STOP.WATER);
    }
  }
});

test('walkers: time limits distance (0 minutes stays put; more time and faster walkers go farther)', () => {
  const still = run({ minutes: 0 });
  assert.ok(distancesAt(still, 0).every((d) => d === 0), 'with 0 minutes everyone is at the start');
  const walks = run({ minutes: 120 });
  const at15 = median(distancesAt(walks, 15));
  const at60 = median(distancesAt(walks, 60));
  assert.ok(at60 > at15, `median at 60 min (${at60}) should be beyond 15 min (${at15})`);
  const normal = median(distancesAt(run({ minutes: 20, mobility: 'normal' }), 20));
  const slow = median(distancesAt(run({ minutes: 20, mobility: 'slow' }), 20));
  const walker = median(distancesAt(run({ minutes: 20, mobility: 'walker' }), 20));
  assert.ok(walker < slow && slow < normal, `walker ${walker} < slow ${slow} < normal ${normal}`);
});

test('walkers: a stated direction pulls them that way', () => {
  const walks = run({ headingDeg: 45 });
  const sr = Math.floor(startCell / SURFACE_N);
  const sc = startCell % SURFACE_N;
  let ne = 0;
  let sw = 0;
  for (let w = 0; w < walks.n; w++) {
    const cell = walks.pos[w * (walks.T + 1) + walks.T];
    if (cell < 0) continue;
    const along = (Math.floor(cell / SURFACE_N) - sr) + ((cell % SURFACE_N) - sc); // + = northeast
    if (along > 5) ne++; else if (along < -5) sw++;
  }
  assert.ok(ne > 2 * sw, `northeast ${ne} vs southwest ${sw}`);
});

// ---- Probability map -----------------------------------------------------------------------------

const EVENTS = [
  { id: 'a', type: 'searched', sectorId: 'r15c16', minutes: 20, at: 1 },
  { id: 'b', type: 'sighting', lat: 37.545, lng: -121.972, direction: 'E', minutesSince: 10, reliability: 0.6, at: 2 },
  { id: 'c', type: 'message', text: 'ignored by the engine', at: 3 },
  { id: 'd', type: 'searched', sectorId: 'r17c18', minutes: 15, at: 4 },
  { id: 'e', type: 'sighting', lat: 37.5465, lng: -121.969, direction: null, minutesSince: 0, reliability: 0.9, at: 5 },
  { id: 'f', type: 'searched', sectorId: 'r18c19', minutes: 30, at: 6 },
];

test('replay: the map plus "not on this map" sums to 1 after EVERY event', () => {
  for (let k = 0; k <= EVENTS.length; k++) {
    const pred = engine.replay(area, CASE, EVENTS.slice(0, k));
    near1(total(pred));
    assert.ok(pred.restOfWorld >= 0 && pred.restOfWorld < 1);
    assert.ok(pred.grid.p.every((v) => v >= 0), 'no negative chance');
    near1(sum(pred.grid.sectors.map((s) => s.probability)) + pred.restOfWorld);
  }
});

test('replay: same case and events give the same map, whatever order the events arrive in', () => {
  const one = engine.replay(area, CASE, EVENTS).grid.p;
  const two = engine.replay(area, CASE, [...EVENTS].reverse()).grid.p;
  assert.deepEqual(Array.from(one), Array.from(two));
});

test('replay: events with the same time are ordered by id the way sync.js orders them', () => {
  // "B" sorts before "a" by code point (what Firebase push ids and sync.js use), but after it
  // in most languages' dictionary order. A search and a sighting don't commute, so the order shows.
  const tied = [
    { id: 'a', type: 'sighting', lat: 37.5415, lng: -121.9785, direction: null, minutesSince: 5, reliability: 0.6, at: 10 },
    { id: 'B', type: 'searched', sectorId: sectorIdAt(ORIGIN, 37.5415, -121.9785), minutes: 30, at: 10 },
  ];
  const got = engine.replay(area, CASE, tied).grid.p;
  const sameOrderSpelledOut = engine.replay(area, CASE, [{ ...tied[1], at: 9 }, tied[0]]).grid.p;
  const otherOrder = engine.replay(area, CASE, [{ ...tied[0], at: 9 }, tied[1]]).grid.p;
  assert.deepEqual(Array.from(got), Array.from(sameOrderSpelledOut));
  assert.notDeepEqual(Array.from(got), Array.from(otherOrder));
});

test('replay: minutes sent as text ("20") count the same as the number 20', () => {
  const asNumbers = [1, 2].map((k) => ({ id: 'n' + k, type: 'searched', sectorId: 'r15c16', minutes: 20, at: k }));
  const asText = asNumbers.map((e) => ({ ...e, minutes: '20' }));
  const a = engine.replay(area, CASE, asNumbers);
  const b = engine.replay(area, CASE, asText);
  assert.deepEqual(Array.from(a.grid.p), Array.from(b.grid.p));
  const sector = b.grid.sectors.find((s) => s.id === 'r15c16');
  assert.equal(sector.searchedMinutes, 40); // not "02020"
  assert.ok(Math.abs(sector.pod - podForMinutes(40)) < 1e-12);
});

test('replay does not change the case, the events or the map data it was given', () => {
  const caseBefore = JSON.stringify(CASE);
  const eventsBefore = JSON.stringify(EVENTS);
  const nodesBefore = JSON.stringify(osm.nodes.slice(0, 50)) + osm.layers.buildings.length;
  const frozenCase = JSON.parse(caseBefore);
  const frozenEvents = JSON.parse(eventsBefore);
  const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const pred = engine.replay(area, deepFreeze(frozenCase), deepFreeze(frozenEvents)); // would throw on a write
  engine.topSpots(area, pred, 8);
  engine.nextSectors(pred, 20, 3);
  engine.routeFor(area, pred, 'r15c16');
  assert.equal(JSON.stringify(CASE), caseBefore);
  assert.equal(JSON.stringify(EVENTS), eventsBefore);
  assert.equal(JSON.stringify(osm.nodes.slice(0, 50)) + osm.layers.buildings.length, nodesBefore);
});

test('a search with nobody found lowers that area by exactly Bayes\' amount and raises every other area', () => {
  const base = engine.replay(area, CASE, []);
  const target = engine.nextSectors(base, 20, 1)[0];
  const after = engine.replay(area, CASE, [{ id: 'x', type: 'searched', sectorId: target.sectorId, minutes: 20, at: 1 }]);
  const before = new Map(base.grid.sectors.map((s) => [s.id, s.probability]));
  const pod = podForMinutes(20);
  const p = target.probability;
  const lift = 1 / (1 - p * pod); // Bayes: everything not searched is divided by P(nobody found)
  for (const s of after.grid.sectors) {
    if (s.id === target.sectorId) {
      assert.ok(Math.abs(s.probability - p * (1 - pod) * lift) < 1e-9, `${s.probability} vs Bayes ${p * (1 - pod) * lift}`);
      assert.equal(s.searchedMinutes, 20);
      assert.ok(Math.abs(s.pod - pod) < 1e-12);
    } else {
      assert.ok(Math.abs(s.probability - before.get(s.id) * lift) < 1e-9, `sector ${s.id}: ${s.probability} vs ${before.get(s.id) * lift}`);
    }
  }
  assert.ok(Math.abs(after.restOfWorld - base.restOfWorld * lift) < 1e-9);
  // A second search of the same area compounds: (1 − POD)².
  const twice = engine.replay(area, CASE, [1, 2].map((k) => ({ id: 'x' + k, type: 'searched', sectorId: target.sectorId, minutes: 20, at: k })));
  const keep2 = (1 - pod) ** 2;
  const got = twice.grid.sectors.find((s) => s.id === target.sectorId).probability;
  assert.ok(Math.abs(got - (p * keep2) / (1 - p + p * keep2)) < 1e-9);
});

test('POD = 1 − e^(−coverage): 0 for no searching, rising toward 1', () => {
  assert.equal(podForMinutes(0), 0);
  assert.ok(podForMinutes(10) < podForMinutes(20));
  assert.ok(podForMinutes(20) > 0.2 && podForMinutes(20) < 0.6);
  assert.ok(podForMinutes(600) > 0.999);
});

// Chance within `radius` meters of a point.
function chanceNear(pred, point, radius) {
  const s0 = latLngToXY(pred.grid.origin, point.lat, point.lng);
  let mass = 0;
  pred.grid.p.forEach((v, i) => {
    const { lat, lng } = engine.cellToLatLng(area, pred.grid, i);
    const c = latLngToXY(pred.grid.origin, lat, lng);
    if (Math.hypot(c.x - s0.x, c.y - s0.y) < radius) mass += v;
  });
  return mass;
}

test('a sure sighting moves probability toward the sighting', () => {
  const sight = { lat: 37.5520, lng: -121.9650 };
  const base = engine.replay(area, CASE, []);
  const after = engine.replay(area, CASE, [{ id: 's', type: 'sighting', ...sight, direction: null, minutesSince: 5, reliability: 0.9, at: 1 }]);
  assert.ok(chanceNear(after, sight, 400) > chanceNear(base, sight, 400) + 0.3,
    `${chanceNear(base, sight, 400).toFixed(3)} → ${chanceNear(after, sight, 400).toFixed(3)}`);
});

test('a sighting is not discounted by a search made before the person was seen there', () => {
  // The clock: last seen at T0; the case says 120 minutes have passed (minutesAt = T0 + 120 min).
  const T0 = 1_700_000_000_000;
  const timed = { ...CASE, minutes: 120, minutesAt: T0 + 120 * 60000 };
  const sight = { lat: 37.5440, lng: -121.9740 };
  const sector = sectorIdAt(gridOriginFor(timed), sight.lat, sight.lng);
  const sighting = { id: 's', type: 'sighting', ...sight, direction: null, minutesSince: 5, reliability: 0.9, at: T0 + 115 * 60000 };
  const earlySearch = { id: 'e', type: 'searched', sectorId: sector, minutes: 30, at: T0 + 20 * 60000 };   // 90 min before the sighting
  const lateSearch = { id: 'l', type: 'searched', sectorId: sector, minutes: 30, at: T0 + 118 * 60000 };   // after it
  const prob = (events) => engine.replay(area, timed, events).grid.sectors.find((s) => s.id === sector).probability;
  const alone = prob([sighting]);
  const withEarly = prob([earlySearch, sighting]);
  const withLate = prob([sighting, lateSearch]);
  assert.ok(Math.abs(withEarly - alone) < 0.02, `early search changed it: ${alone.toFixed(3)} → ${withEarly.toFixed(3)}`);
  assert.ok(withLate < alone - 0.05, `a search after the sighting should lower it: ${alone.toFixed(3)} → ${withLate.toFixed(3)}`);
});

test('a sighting spreads out as the clock runs', () => {
  const T0 = 1_700_000_000_000;
  const sight = { lat: 37.5440, lng: -121.9740 };
  const sighting = { id: 's', type: 'sighting', ...sight, direction: null, minutesSince: 5, reliability: 0.9, at: T0 + 60 * 60000 };
  const at = (minutes) => engine.replay(area, { ...CASE, minutes, minutesAt: T0 + minutes * 60000 }, [sighting]);
  const soon = chanceNear(at(60), sight, 150);
  const later = chanceNear(at(120), sight, 150);
  assert.ok(later < soon - 0.05, `chance within 150 m of the sighting: ${soon.toFixed(3)} at once, ${later.toFixed(3)} an hour later`);
});

test('a search only counts against people who were there at the time', () => {
  // A far area searched 5 minutes after last seen: nobody could have reached it yet, so the
  // search says nothing about where they are an hour later.
  const T0 = 1_700_000_000_000;
  const timed = { ...CASE, minutes: 90, minutesAt: T0 + 90 * 60000 };
  const base = engine.replay(area, timed, []);
  const far = base.grid.sectors
    .filter((s) => s.probability > 0.005)
    .map((s) => ({ s, d: Math.hypot(latLngToXY(base.grid.origin, s.center.lat, s.center.lng).x, latLngToXY(base.grid.origin, s.center.lat, s.center.lng).y) }))
    .sort((a, b) => b.d - a.d)[0].s;
  const prob = (at) => engine.replay(area, timed, [{ id: 'q', type: 'searched', sectorId: far.id, minutes: 40, at }])
    .grid.sectors.find((s) => s.id === far.id).probability;
  const early = prob(T0 + 5 * 60000);
  const now = prob(T0 + 90 * 60000);
  assert.ok(now < 0.7 * far.probability, `searching it now should lower it: ${far.probability.toFixed(4)} → ${now.toFixed(4)}`);
  assert.ok(early > 0.9 * far.probability, `searching it at minute 5 should barely matter: ${far.probability.toFixed(4)} → ${early.toFixed(4)}`);
});

test('the map is for "t minutes since last seen": more time spreads it out', () => {
  const spread = (minutes) => {
    const pred = engine.replay(area, { ...CASE, minutes, direction: null, familiarPlaces: [] }, []);
    return chanceNear(pred, START, 300);
  };
  const s10 = spread(10);
  const s45 = spread(45);
  const s180 = spread(180);
  assert.ok(s10 > s45 && s45 > s180, `chance within 300 m: ${s10.toFixed(2)} at 10 min, ${s45.toFixed(2)} at 45, ${s180.toFixed(2)} at 180`);
});

test('every phone cuts the ground into the same areas, whatever map download it holds', () => {
  // Phone B holds an area downloaded around a point 700 m away (a saved home area). The same
  // streets, a different center. (The old engine anchored the grid to that center, so sector
  // r12c12 was a different square on each phone.) Layers are dropped so the two only differ
  // in their center.
  const { layers, ...plain } = osm;
  const phoneA = prepareArea(plain);
  const phoneB = prepareArea({ ...plain, center: { lat: plain.center.lat + 0.0063, lng: plain.center.lng } });
  const a = engine.replay(phoneA, CASE, []);
  const b = engine.replay(phoneB, CASE, []);
  assert.deepEqual(a.grid.origin, b.grid.origin);
  assert.deepEqual(a.grid.sectors.map((s) => s.bounds), b.grid.sectors.map((s) => s.bounds));
  // At 45 minutes no walker has reached the edge of either download, so the maps are identical.
  assert.deepEqual(Array.from(a.grid.p), Array.from(b.grid.p));
  // And a search event lands on the same ground on both.
  const ev = [{ id: 'x', type: 'searched', sectorId: 'r15c16', minutes: 20, at: 1 }];
  assert.deepEqual(Array.from(engine.replay(phoneA, CASE, ev).grid.p), Array.from(engine.replay(phoneB, CASE, ev).grid.p));
});

test('a phone that joined by share link (6-decimal coordinates) gets the same map as the one that made it', () => {
  const full = { ...CASE, lastSeen: { lat: 37.54050000123, lng: -121.97950000456 } };
  const fromLink = { ...CASE, lastSeen: { lat: +full.lastSeen.lat.toFixed(6), lng: +full.lastSeen.lng.toFixed(6) } };
  assert.deepEqual(Array.from(engine.replay(area, full, []).grid.p), Array.from(engine.replay(area, fromLink, []).grid.p));
});

test('nextSectors: highest gain first, ties broken by sector id', () => {
  const probs = { r0c0: 0.1, r0c1: 0.4, r1c0: 0.2, r1c1: 0.2, r2c2: 0.1 };
  const prediction = { grid: { sectors: Object.entries(probs).map(([id, probability]) => ({ id, probability })) } };
  const got = engine.nextSectors(prediction, 20, 3);
  assert.deepEqual(got.map((s) => s.sectorId), ['r0c1', 'r1c0', 'r1c1']);
  assert.ok(Math.abs(got[0].gain - 0.4 * podForMinutes(20)) < 1e-12);
});

test('topSpots: up to n spots, really at least 150 m apart, with sensible fields', () => {
  for (const minutes of [10, 45, 120]) {
    const pred = engine.replay(area, { ...CASE, minutes }, []);
    const spots = engine.topSpots(area, pred, 8);
    assert.ok(spots.length > 0 && spots.length <= 8);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lng));
      assert.ok(s.probability > 0 && s.probability <= 1);
      assert.ok(s.walkerShare >= 0 && s.walkerShare <= 1);
      assert.equal(s.hazard, ['creek', 'river', 'water', 'wetland'].includes(s.trapType));
      for (let j = 0; j < i; j++) {
        const a = latLngToXY(pred.grid.origin, s.lat, s.lng);
        const b = latLngToXY(pred.grid.origin, spots[j].lat, spots[j].lng);
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(gap >= SPOT_SEPARATION_M - 0.5, `minutes ${minutes}: spots ${j} and ${i} are ${gap.toFixed(0)} m apart`);
      }
    }
  }
});

// ---- Routes ----------------------------------------------------------------------------------------

test('routeFor: stays inside its area, follows connected streets, and times the walk', () => {
  const pred = engine.replay(area, CASE, []);
  for (const { sectorId } of engine.nextSectors(pred, 20, 3)) {
    const route = engine.routeFor(area, pred, sectorId);
    const b = sectorBoundsXY(sectorId);
    const { nodes, edges } = area.graph;
    assert.ok(route.edgeIndices.length > 0, `route in ${sectorId} should have streets`);
    assert.equal(route.points.length, route.edgeIndices.length + 1);
    for (const i of route.edgeIndices) {
      const e = edges[i];
      const m = latLngToXY(pred.grid.origin, (nodes[e.a].lat + nodes[e.b].lat) / 2, (nodes[e.a].lng + nodes[e.b].lng) / 2);
      assert.ok(m.x >= b.minX && m.x < b.maxX && m.y >= b.minY && m.y < b.maxY, 'edge outside its area');
    }
    for (let k = 1; k < route.edgeIndices.length; k++) {
      const prev = edges[route.edgeIndices[k - 1]];
      const cur = edges[route.edgeIndices[k]];
      const shared = [prev.a, prev.b].some((n) => n === cur.a || n === cur.b);
      assert.ok(shared, 'consecutive streets must connect');
    }
    assert.ok(Math.abs(route.minutes - route.lengthM / 0.8 / 60) < 1e-9);
  }
});

test('routeFor and replay cope with an unknown area id', () => {
  const pred = engine.replay(area, CASE, [{ id: 'z', type: 'searched', sectorId: 'nonsense', minutes: 10, at: 1 }]);
  near1(total(pred));
  assert.equal(engine.routeFor(area, pred, 'nonsense').points.length, 0);
});

test('topSpots are listed from most to least likely (by the total chance around each)', () => {
  // A later minute count once produced 15.8% listed above 16.2%.
  for (const minutes of [45, 55, 90]) {
    const pred = engine.replay(area, { ...CASE, minutes }, []);
    const spots = engine.topSpots(area, pred, 8);
    for (let i = 1; i < spots.length; i++) {
      assert.ok(spots[i - 1].probability >= spots[i].probability, `minutes ${minutes}: spot ${i} > spot ${i - 1}`);
    }
  }
});

// ---- Speed -------------------------------------------------------------------------------------------

test('fast enough for a phone: a cold replay with 7 searches and 3 sightings', () => {
  // "Cold" = a case the engine has not seen: new ground map, new walkers, nothing cached.
  // A mid-range phone runs this kind of code about 3× slower than a laptop, and the limit on a
  // phone is 2 s, so the laptop limit here is 650 ms. The other test files run at the same
  // time and compete for the processor, so the cold run is done twice (two different cases,
  // each on a freshly prepared area) and the quicker one counts.
  const T0 = 1_700_000_000_000;
  const coldRun = (lastSeen, seed) => {
    const fresh = prepareArea(osm);
    const cold = { ...CASE, lastSeen, minutes: 75, minutesAt: T0 + 75 * 60000, seed };
    const origin = gridOriginFor(cold);
    const events = [];
    for (let k = 0; k < 7; k++) {
      events.push({ id: 's' + k, type: 'searched', sectorId: sectorIdAt(origin, lastSeen.lat + 0.002 * (k % 3 - 1), lastSeen.lng + 0.0025 * (k % 4 - 1)), minutes: 20, at: T0 + (30 + 5 * k) * 60000 });
    }
    for (let k = 0; k < 3; k++) {
      events.push({ id: 'w' + k, type: 'sighting', lat: lastSeen.lat + 0.001 + 0.003 * k, lng: lastSeen.lng + 0.002 - 0.002 * k, direction: 'N', minutesSince: 10, reliability: 0.6, at: T0 + (40 + 10 * k) * 60000 });
    }
    const t0 = performance.now();
    const pred = engine.replay(fresh, cold, events);
    const ms = performance.now() - t0;
    near1(total(pred));
    const t1 = performance.now();
    engine.replay(fresh, { ...cold, minutes: 80, minutesAt: T0 + 80 * 60000 }, events); // the 5-minute clock tick
    return { ms, tick: performance.now() - t1 };
  };
  const a = coldRun({ lat: 37.5521, lng: -121.9712 }, 99);
  const b = coldRun({ lat: 37.5461, lng: -121.9762 }, 100);
  const ms = Math.min(a.ms, b.ms);
  const tick = Math.min(a.tick, b.tick);
  assert.ok(ms < 650, `cold replay took ${ms.toFixed(0)} ms`);
  assert.ok(tick < 300, `the clock-tick replay took ${tick.toFixed(0)} ms`);
});
