// Tests for the engine's second hazard class: woods and brush near the likely area, which
// volunteers "check from the path" (engine/grid.js: WOODS_CODES, grid.woods, sector.woods,
// spot.woodsNearby, woodsSpots). 29% of the deaths in the real-case set were in woods.
// Written with Claude Code; see README "Who built what".
// Run just these with:   node --test tests/woods-hazard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../engine/index.js';
import {
  woodsSpots, hazardSpots, gridOriginFor, groundClassAt,
  HAZARD_MIN_CHANCE, HAZARD_REACH_M, WOODS_CODES, HAZARD_CODES, HAZARD_CHECK,
} from '../engine/grid.js';
import { planSearch } from '../engine/planner/index.js';

const osm = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-area.json', import.meta.url)));
const START = { lat: 37.5405, lng: -121.9795 }; // the Demo's last-seen point
const CASE = {
  lastSeen: START, minutes: 45, direction: 'NE', mobility: 'slow',
  familiarPlaces: [{ lat: 37.5485, lng: -121.963, label: 'Lake Elizabeth' }], seed: 20261121,
};

// A square polygon of the given kind, `halfM` meters each way around a point.
function patch(id, type, lat, lng, halfM) {
  const dLat = halfM / 111320;
  const dLng = halfM / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    id, type, name: null, shape: 'area',
    points: [
      { lat: lat - dLat, lng: lng - dLng }, { lat: lat - dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng: lng - dLng },
      { lat: lat - dLat, lng: lng - dLng },
    ],
  };
}
// The Demo's map with three made-up patches added:
//   woods 120 m north-east of the last-seen point (inside the likely area),
//   brush 150 m west of it (inside the likely area),
//   woods 2.6 km south-west (on the map, but nobody is likely to be there at 45 minutes).
const NEAR_WOODS = { lat: START.lat + 0.0008, lng: START.lng + 0.0010 };
const NEAR_BRUSH = { lat: START.lat, lng: START.lng - 0.0017 };
const FAR_WOODS = { lat: START.lat - 0.0165, lng: START.lng - 0.0210 };
const withPatches = {
  ...osm,
  features: [
    ...osm.features,
    patch('t-near-woods', 'woods', NEAR_WOODS.lat, NEAR_WOODS.lng, 40),
    patch('t-near-brush', 'brush', NEAR_BRUSH.lat, NEAR_BRUSH.lng, 40),
    patch('t-far-woods', 'woods', FAR_WOODS.lat, FAR_WOODS.lng, 60),
  ],
};
const area = engine.prepareArea(withPatches);
const pred = engine.replay(area, CASE, []);
const plainArea = engine.prepareArea(osm);
const plainPred = engine.replay(plainArea, CASE, []);

// The 25 m square of a prediction's map that holds a point.
function cellOf(prediction, point) {
  const { lat, lng } = prediction.grid.origin;
  const x = (point.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
  const y = (point.lat - lat) * 111320;
  const half = (prediction.grid.cols * prediction.grid.cellSize) / 2;
  return Math.floor((y + half) / prediction.grid.cellSize) * prediction.grid.cols + Math.floor((x + half) / prediction.grid.cellSize);
}

// Ground classes found at a 5 × 5 spread of points over a patch (streets and buildings are
// drawn over land use, so not every point of a patch stays woods).
function classesIn(point, halfM) {
  const found = new Set();
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const lat = point.lat + (i * halfM * 0.4) / 111320;
      const lng = point.lng + (j * halfM * 0.4) / (111320 * Math.cos((point.lat * Math.PI) / 180));
      found.add(groundClassAt(area, CASE, lat, lng));
    }
  }
  return found;
}

test('woods hazard: the patches are on the ground map as woods and brush', () => {
  assert.ok(classesIn(NEAR_WOODS, 40).has('woods'));
  assert.ok(classesIn(NEAR_BRUSH, 40).has('brush'));
  assert.ok(classesIn(FAR_WOODS, 60).has('woods'));
});

test('woods hazard: woods and brush inside the likely area are flagged, far-off woods are not', () => {
  const { woods, woodsType, cols, rows } = pred.grid;
  assert.equal(woods.length, cols * rows);
  assert.equal(woodsType.length, cols * rows);
  for (let i = 0; i < woods.length; i++) {
    if (!woodsType[i]) assert.equal(woods[i], 0, 'a square with no woods or brush has no woods score');
  }
  const near = cellOf(pred, NEAR_WOODS);
  const brush = cellOf(pred, NEAR_BRUSH);
  const far = cellOf(pred, FAR_WOODS);
  assert.equal(WOODS_CODES[woodsType[near]], 'woods');
  assert.equal(WOODS_CODES[woodsType[brush]], 'brush');
  assert.equal(WOODS_CODES[woodsType[far]], 'woods', 'the far patch is known to the layer...');
  assert.ok(woods[near] >= HAZARD_MIN_CHANCE, `near woods score ${woods[near]}`);
  assert.ok(woods[brush] >= HAZARD_MIN_CHANCE, `near brush score ${woods[brush]}`);
  assert.ok(woods[far] < HAZARD_MIN_CHANCE, `...but is not flagged: score ${woods[far]}`);

  // The lists the screen reads.
  const spots = woodsSpots(area, pred, 20);
  assert.ok(spots.length >= 2);
  const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180));
  assert.ok(spots.some((s) => s.type === 'woods' && distM(s, NEAR_WOODS) < 100), 'the near woods are listed');
  assert.ok(spots.some((s) => s.type === 'brush' && distM(s, NEAR_BRUSH) < 100), 'the near brush is listed');
  assert.ok(!spots.some((s) => distM(s, FAR_WOODS) < 300), 'the far woods are not listed');
  for (let i = 0; i < spots.length; i++) {
    assert.ok(['woods', 'brush'].includes(spots[i].type));
    assert.equal(spots[i].check, 'from_path');
    assert.equal(spots[i].check, HAZARD_CHECK.woods);
    assert.ok(spots[i].nearbyProbability >= HAZARD_MIN_CHANCE && spots[i].nearbyProbability <= 1);
    if (i > 0) assert.ok(spots[i - 1].nearbyProbability >= spots[i].nearbyProbability, 'highest score first');
  }

  // Sectors: the ones holding the near patches are flagged, the far one is not.
  const sectorAt = (point) => pred.grid.sectors.find((s) => point.lat >= s.bounds[0][0] && point.lat < s.bounds[1][0] && point.lng >= s.bounds[0][1] && point.lng < s.bounds[1][1]);
  assert.equal(sectorAt(NEAR_WOODS).woods, true);
  assert.ok(sectorAt(NEAR_WOODS).woodsScore >= HAZARD_MIN_CHANCE);
  assert.equal(sectorAt(NEAR_BRUSH).woods, true);
  assert.equal(sectorAt(FAR_WOODS).woods, false);

  // Top spots: any spot within reach of a flagged patch says so, with the distance.
  const top = engine.topSpots(area, pred, 8);
  const flagged = top.filter((s) => s.woodsNearby);
  assert.ok(flagged.length > 0, 'at least one "check these first" spot has the woods or brush nearby');
  for (const s of flagged) {
    assert.ok(['woods', 'brush'].includes(s.woodsNearby.type));
    assert.ok(s.woodsNearby.distanceM <= HAZARD_REACH_M);
    assert.equal(s.woodsNearby.check, 'from_path');
  }
});

test('woods hazard: a separate class; the water layer and its flags mean what they did', () => {
  // Water-class lists never name woods, and woods never make a spot "for professionals".
  for (const h of hazardSpots(area, pred, 10)) {
    assert.ok(['water', 'creek', 'wetland'].includes(h.type));
    assert.equal(h.check, 'from_bank');
  }
  for (let i = 0; i < pred.grid.hazardType.length; i++) assert.ok(pred.grid.hazardType[i] < HAZARD_CODES.length);
  for (const s of engine.topSpots(area, pred, 8)) {
    if (s.hazardNearby) assert.ok(['water', 'creek', 'wetland'].includes(s.hazardNearby.type));
    if (s.hazard) assert.ok(['creek', 'river', 'water', 'wetland'].includes(s.trapType));
  }
  // On the unchanged Demo map, the water layer is the same with or without the new class
  // looking on, and old readers of the prediction still find every field they used.
  assert.ok(plainPred.grid.hazard instanceof Float32Array && plainPred.grid.woods instanceof Float32Array);
  assert.ok(plainPred.grid.sectors.every((s) => typeof s.hazard === 'boolean' && typeof s.woods === 'boolean'));
  assert.ok(engine.topSpots(plainArea, plainPred, 8).every((s) => 'woodsNearby' in s && 'hazardNearby' in s));
});

test('woods hazard: deterministic, and the planner still plans (woods are not a water task)', () => {
  const again = engine.replay(engine.prepareArea(withPatches), CASE, []);
  assert.deepEqual(Array.from(again.grid.woods), Array.from(pred.grid.woods));
  assert.deepEqual(Array.from(again.grid.woodsType), Array.from(pred.grid.woodsType));

  const nowMs = 1795000000000;
  const searchers = [0, 1, 2, 3].map((k) => ({ id: 's' + k, lat: START.lat + 0.0002 * k, lng: START.lng, mode: 'foot', at: nowMs }));
  const plan = planSearch(area, { ...CASE, minutesAt: nowMs }, pred, { searchers, events: [], nowMs });
  assert.equal(plan.searchers.length, 4);
  for (const s of plan.searchers) {
    for (const o of s.options) {
      // "Do not enter the water" belongs to bank checks only; a park task that takes in woods
      // or brush says "stay on the path" instead.
      if (o.danger.warnings.includes('do_not_enter_water')) assert.equal(o.type, 'hazard_check');
      if (o.type === 'park' && o.danger.warnings.includes('stay_on_path')) assert.ok(o.danger.level >= 1);
    }
  }
});
