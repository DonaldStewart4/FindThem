// Tests for the engine's walkers (sim.js), probability map (grid.js) and routes (routes.js),
// on the real Fremont fixture. Written with Claude Code; see README "Who built what".
// Run just these with:   node --test tests/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../engine/index.js';
import { prepareArea, toXY } from '../engine/graph.js';
import { simulate, N_WALKERS } from '../engine/sim.js';
import { podForMinutes, sectorBoundsXY } from '../engine/grid.js';

const osm = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-area.json', import.meta.url)));
const area = prepareArea(osm);
const START = { lat: 37.5405, lng: -121.9795 }; // the Demo's last-seen point
const CASE = {
  lastSeen: START, minutes: 45, direction: 'NE', mobility: 'slow',
  familiarPlaces: [{ lat: 37.5485, lng: -121.963, label: 'Lake Elizabeth' }], seed: 20261121,
};
const run = (overrides = {}) => simulate(area, {
  start: START, minutes: 45, direction: null, mobility: 'normal', familiarPlaces: [], seed: 1, ...overrides,
});
const straightLine = (e, s) => { const a = toXY(area.origin, s.lat, s.lng); return Math.hypot(e.x - a.x, e.y - a.y); };
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const sum = (p) => p.reduce((a, b) => a + b, 0);

// ---- Walkers ----------------------------------------------------------------------------------

test('walkers: same seed gives identical results, a different seed does not', () => {
  const a = run({ seed: 42 });
  const b = run({ seed: 42 });
  const c = run({ seed: 43 });
  assert.equal(a.endpoints.length, N_WALKERS);
  assert.deepEqual(a.endpoints, b.endpoints);
  assert.deepEqual(a.edgeCounts, b.edgeCounts);
  assert.notDeepEqual(a.endpoints, c.endpoints);
});

test('walkers: edge counts have one slot per street piece and never exceed the walker count', () => {
  const r = run();
  assert.equal(r.edgeCounts.length, area.graph.edges.length);
  assert.ok(r.edgeCounts.every((n) => n >= 0 && n <= N_WALKERS));
  assert.ok(r.edgeCounts.some((n) => n > 0));
});

test('calibration: straight-line distance matches the dementia research (median ~0.8 km, ~89% within 1 mile)', () => {
  // No time limit (600 min) so only the "give up" distance and dead ends matter.
  const starts = [START, { lat: 37.553, lng: -121.970 }, { lat: 37.548, lng: -121.985 }, { lat: 37.560, lng: -121.975 }, { lat: 37.545, lng: -121.960 }];
  let withinMile = 0;
  let total = 0;
  for (const s of starts) {
    const d = run({ start: s, minutes: 600, seed: 7 }).endpoints.map((e) => straightLine(e, s));
    const m = median(d);
    assert.ok(m > 500 && m < 1050, `median ${Math.round(m)} m from ${JSON.stringify(s)}`);
    withinMile += d.filter((x) => x <= 1609).length;
    total += d.length;
  }
  const share = withinMile / total;
  assert.ok(share > 0.84 && share < 0.94, `share within 1 mile = ${(share * 100).toFixed(1)}%`);
});

test('walkers: time limits distance (0 minutes stays put; slower walkers go less far)', () => {
  const still = run({ minutes: 0 });
  assert.ok(still.endpoints.every((e) => straightLine(e, START) < 100), 'with 0 minutes everyone stays near the start');
  const normal = median(run({ minutes: 20, mobility: 'normal' }).endpoints.map((e) => straightLine(e, START)));
  const walker = median(run({ minutes: 20, mobility: 'walker' }).endpoints.map((e) => straightLine(e, START)));
  assert.ok(walker < normal, `walker-or-cane median ${Math.round(walker)} should be < normal ${Math.round(normal)}`);
});

test('walkers: a stated direction pulls them that way', () => {
  const s0 = toXY(area.origin, START.lat, START.lng);
  const r = run({ direction: 'NE' });
  let ne = 0;
  let sw = 0;
  for (const e of r.endpoints) {
    const along = (e.x - s0.x) + (e.y - s0.y); // positive = northeast of the start
    if (along > 50) ne++; else if (along < -50) sw++;
  }
  assert.ok(ne > 2 * sw, `northeast ${ne} vs southwest ${sw}`);
});

test('walkers: fast enough for a phone (under 1.5 s here)', () => {
  const t0 = performance.now();
  run({ seed: 99, minutes: 120 });
  assert.ok(performance.now() - t0 < 1500);
});

// ---- Probability map -----------------------------------------------------------------------------

test('replay: probabilities sum to 1 before and after searches and sightings', () => {
  const base = engine.replay(area, CASE, []);
  near1(sum(base.grid.p));
  const next = engine.nextSectors(base, 20, 1)[0];
  const events = [
    { id: 'a', type: 'searched', sectorId: next.sectorId, minutes: 20, at: 1 },
    { id: 'b', type: 'sighting', lat: 37.545, lng: -121.972, direction: 'E', minutesSince: 10, reliability: 0.6, at: 2 },
    { id: 'c', type: 'message', text: 'ignored by the engine', at: 3 },
  ];
  near1(sum(engine.replay(area, CASE, events).grid.p));
});

function near1(x) { assert.ok(Math.abs(x - 1) < 1e-9, `sum is ${x}`); }

test('replay: same case and events give the same map, whatever order the events arrive in', () => {
  const events = [
    { id: 'b', type: 'sighting', lat: 37.545, lng: -121.972, direction: null, minutesSince: 5, reliability: 0.3, at: 20 },
    { id: 'a', type: 'searched', sectorId: 'r12c12', minutes: 15, at: 10 },
  ];
  const one = engine.replay(area, CASE, events).grid.p;
  const two = engine.replay(area, CASE, [...events].reverse()).grid.p;
  assert.deepEqual(Array.from(one), Array.from(two));
});

test('a search with nobody found lowers that area and raises every other area (Bayes)', () => {
  const base = engine.replay(area, CASE, []);
  const target = engine.nextSectors(base, 20, 1)[0].sectorId;
  const after = engine.replay(area, CASE, [{ id: 'x', type: 'searched', sectorId: target, minutes: 20, at: 1 }]);
  const before = new Map(base.grid.sectors.map((s) => [s.id, s.probability]));
  for (const s of after.grid.sectors) {
    if (s.id === target) {
      assert.ok(s.probability < before.get(s.id));
      assert.equal(s.searchedMinutes, 20);
      assert.ok(Math.abs(s.pod - podForMinutes(20)) < 1e-12);
    } else if (before.get(s.id) > 0) {
      assert.ok(s.probability > before.get(s.id), `sector ${s.id} should rise`);
    }
  }
});

test('POD = 1 − e^(−coverage): 0 for no searching, rising toward 1', () => {
  assert.equal(podForMinutes(0), 0);
  assert.ok(podForMinutes(10) < podForMinutes(20));
  assert.ok(podForMinutes(20) > 0.2 && podForMinutes(20) < 0.6);
  assert.ok(podForMinutes(600) > 0.999);
});

test('a sure sighting moves probability toward the sighting', () => {
  const sight = { lat: 37.5520, lng: -121.9650 };
  const near = (pred) => {
    const s0 = toXY(area.origin, sight.lat, sight.lng);
    let mass = 0;
    pred.grid.p.forEach((v, i) => {
      const { lat, lng } = engine.cellToLatLng(area, pred.grid, i);
      const c = toXY(area.origin, lat, lng);
      if (Math.hypot(c.x - s0.x, c.y - s0.y) < 400) mass += v;
    });
    return mass;
  };
  const base = engine.replay(area, CASE, []);
  const after = engine.replay(area, CASE, [{ id: 's', type: 'sighting', ...sight, direction: null, minutesSince: 5, reliability: 0.9, at: 1 }]);
  assert.ok(near(after) > near(base) + 0.3, `${near(base).toFixed(3)} → ${near(after).toFixed(3)}`);
});

test('nextSectors matches brute force on a tiny hand-made map', () => {
  const probs = { r0c0: 0.1, r0c1: 0.4, r1c0: 0.2, r1c1: 0.2, r2c2: 0.1 };
  const prediction = { grid: { sectors: Object.entries(probs).map(([id, probability]) => ({ id, probability })) } };
  const got = engine.nextSectors(prediction, 20, 3).map((s) => s.sectorId);
  const pod = podForMinutes(20);
  const brute = Object.keys(probs).sort((a, b) => (probs[b] * pod - probs[a] * pod) || (a < b ? -1 : 1)).slice(0, 3);
  assert.deepEqual(got, brute);
  assert.deepEqual(got, ['r0c1', 'r1c0', 'r1c1']); // ties broken by sector id
});

test('topSpots: up to n spots, at least 150 m apart, with sensible fields', () => {
  const pred = engine.replay(area, CASE, []);
  const spots = engine.topSpots(area, pred, 8);
  assert.ok(spots.length > 0 && spots.length <= 8);
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lng));
    assert.ok(s.probability > 0 && s.probability <= 1);
    assert.ok(s.walkerShare >= 0 && s.walkerShare <= 1);
    assert.equal(s.hazard, ['creek', 'river', 'water', 'wetland'].includes(s.trapType));
    for (let j = 0; j < i; j++) {
      const a = toXY(area.origin, s.lat, s.lng);
      const b = toXY(area.origin, spots[j].lat, spots[j].lng);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 100, 'spots should be spread out');
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
      const mx = (nodes[e.a].x + nodes[e.b].x) / 2;
      const my = (nodes[e.a].y + nodes[e.b].y) / 2;
      assert.ok(mx >= b.minX && mx < b.maxX && my >= b.minY && my < b.maxY, 'edge outside its area');
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
  near1(sum(pred.grid.p));
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
