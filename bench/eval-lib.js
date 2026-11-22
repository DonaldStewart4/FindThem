// bench/eval-lib.js — shared pieces of the calibration (tools/calibrate.js) and the evaluation
// (bench/prior-eval.js): the wide Fremont map, start points, the ISRID statistics a set of
// walkers is measured against, and "true" locations placed from ISRID statistics alone.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildSurface, cellAt, snapToNetwork, C, SURFACE_N, SURFACE_CELL_M, xyToLatLng } from '../engine/surface.js';
import { simulate, makeRandom, STOP, STOP_NAMES } from '../engine/sim.js';
import { findTypes, FIND_TYPES, BLOCKED, ISRID, distanceQuantile, paceSamples } from '../engine/prior.js';
import { gridOriginFor } from '../engine/grid.js';

export const WIDE_AREA_URL = new URL('../tools/data/fremont-wide.json.gz', import.meta.url);

// The wide Fremont map (a 11.2 km square): start points up to 2.2 km from its center still have
// data 3.4 km in every direction.
export function loadWideArea() {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(WIDE_AREA_URL)).toString('utf8'));
}

// ---- Start points ---------------------------------------------------------------------------------

export const START_SPREAD_M = 2100; // start points lie within this far (east-west and north-south)
                                    // of the wide map's center, so their whole grid has data
export const N_CALIBRATION_STARTS = 24;
export const N_HELDOUT_STARTS = 60;

// Random "homes": ground that touches a building and is no more than 30 m from a road.
// The same seed always gives the same list. Calibration takes the first N_CALIBRATION_STARTS,
// the evaluation takes the next N_HELDOUT_STARTS: the two sets never share a point.
export function pickStarts(osm, count, seed = 20261122) {
  const center = osm.center;
  const surface = buildSurface(osm, center);
  const n = surface.n;
  const candidates = [];
  const half = Math.round(START_SPREAD_M / SURFACE_CELL_M);
  for (let r = n / 2 - half; r < n / 2 + half; r++) {
    for (let c = n / 2 - half; c < n / 2 + half; c++) {
      const i = r * n + c;
      if (surface.nearBuilding[i] && surface.region[i] && surface.cls[i] === C.YARD && surface.dRoad[i] <= 30) candidates.push(i);
    }
  }
  const random = makeRandom(seed);
  const starts = [];
  const taken = new Set();
  while (starts.length < count && taken.size < candidates.length) {
    const i = candidates[Math.floor(random() * candidates.length)];
    if (taken.has(i)) continue;
    taken.add(i);
    const x = ((i % n) + 0.5) * SURFACE_CELL_M - surface.radiusM;
    const y = (Math.floor(i / n) + 0.5) * SURFACE_CELL_M - surface.radiusM;
    const { lat, lng } = xyToLatLng(center, x, y);
    starts.push({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
  }
  return starts;
}

export function calibrationStarts(osm) {
  return pickStarts(osm, N_CALIBRATION_STARTS + N_HELDOUT_STARTS).slice(0, N_CALIBRATION_STARTS);
}
export function heldOutStarts(osm) {
  return pickStarts(osm, N_CALIBRATION_STARTS + N_HELDOUT_STARTS).slice(N_CALIBRATION_STARTS);
}

// The ground map and start square for a start point, the way the engine would set it up.
export function setupStart(osm, start) {
  const origin = gridOriginFor({ lastSeen: start });
  const surface = buildSurface(osm, origin);
  const startCell = snapToNetwork(surface, cellAt(surface, start.lat, start.lng));
  return { start, origin, surface, startCell, types: findTypes(surface) };
}

// ---- The statistics we fit and check (all from Koester's dementia chapter unless noted) --------------

export const TARGETS = {
  // Urban distance from the last-seen point (n = 336): share of people found within each
  // distance. THE PRIMARY TARGET.
  within300m: 25, within1100m: 50, within3200m: 75,
  // Urban find location (n = 223), percent.
  structure: 35, road: 36, linear: 9, field: 6, water: 6, drainage: 4, woods: 3, brush: 1,
  // Track offset, meters from the nearest road or path, for people found off one (n = 110).
  trackOffset25: 4, trackOffset50: 15, trackOffset75: 71, trackOffset95: 307,
  // Dispersion angle, degrees (temperate, n = 11).
  dispersion25: 11, dispersion50: 23, dispersion75: 66,
  // Mobility, hours (temperate, n = 42). A CHECK, not fitted (see params.js).
  mobilityH25: 0, mobilityH50: 0.25, mobilityH75: 3.8, mobilityH95: 18,
  // Rowe et al. 2011 (325 newspaper reports): on foot, found within 1 mile. A CHECK.
  within1mile: 53,
};

// How much each statistic counts in the fit. Shares are in percentage points / 10, the others
// as a fraction of the target. Distance carries the most weight by far.
export const WEIGHTS = {
  within300m: 3, within1100m: 4, within3200m: 3,
  structure: 1, road: 1.5, linear: 0.75, field: 0.5, water: 1, drainage: 1, woods: 0.25, brush: 0.25,
  trackOffset50: 0.5, trackOffset75: 0.5,
  dispersion50: 0.25, // only 11 cases behind it
};
const SHARE_KEYS = new Set(['within300m', 'within1100m', 'within3200m', 'structure', 'road', 'linear', 'field', 'water', 'drainage', 'woods', 'brush', 'within1mile']);

export function score(stats) {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const target = TARGETS[key];
    const error = SHARE_KEYS.has(key) ? Math.abs(stats[key] - target) / 10 : Math.abs(stats[key] - target) / Math.max(target, 1e-6);
    total += weight * error;
  }
  return total;
}

export function quantile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// Runs walkers from every start with SPOTTING ON (a walker noticed on a road is found there),
// for 12 hours, pools them, and measures the statistics above. `setups` come from setupStart().
// The same seeds are used for every parameter set, so differences come from the parameters.
export function measure(setups, params, { walkersPerStart = 300, seed = 1, minutes = 720 } = {}) {
  const distance = [];      // meters; Infinity = left the map
  const offsets = [];
  const dispersion = [];
  const mobilityH = [];
  const typeCount = new Array(FIND_TYPES.length).fill(0);
  const reasonCount = new Array(STOP_NAMES.length).fill(0);
  let total = 0;
  let typed = 0;
  setups.forEach((setup, k) => {
    const { surface, startCell, types } = setup;
    const n = surface.n;
    const r0 = Math.floor(startCell / n);
    const c0 = startCell % n;
    const walks = simulate(surface, { startCell, minutes, seed: seed + 7919 * k, spotting: true, n: walkersPerStart, params });
    for (let w = 0; w < walks.n; w++) {
      total += 1;
      reasonCount[walks.reason[w]] += 1;
      mobilityH.push(Math.min(walks.stopMin[w], walks.T) / 60);
      const cell = walks.endCell[w];
      if (cell < 0) { distance.push(Infinity); continue; } // off the map: farther than 3.2 km
      const dr = Math.floor(cell / n) - r0;
      const dc = (cell % n) - c0;
      const d = Math.hypot(dr, dc) * SURFACE_CELL_M;
      distance.push(d);
      const type = types[cell];
      if (type !== BLOCKED) { typeCount[type] += 1; typed += 1; }
      const cls = surface.cls[cell];
      if (cls !== C.ROAD && cls !== C.PATH && cls !== C.SERVICE) offsets.push(surface.dRoad[cell]);
      const first = walks.cell100[w];
      if (first >= 0 && d > 150) {
        // Angle between the first 100 m of travel and the bearing to where they ended.
        const a1 = Math.atan2((first % n) - c0, Math.floor(first / n) - r0);
        const a2 = Math.atan2(dc, dr);
        let diff = Math.abs(a1 - a2) * (180 / Math.PI);
        if (diff > 180) diff = 360 - diff;
        dispersion.push(diff);
      }
    }
  });
  const share = (test) => (100 * distance.filter(test).length) / total;
  const stats = {
    within300m: share((d) => d <= 300), within1100m: share((d) => d <= 1100), within3200m: share((d) => d <= 3200),
    within1mile: share((d) => d <= 1609),
    trackOffset25: quantile(offsets, 0.25), trackOffset50: quantile(offsets, 0.5), trackOffset75: quantile(offsets, 0.75), trackOffset95: quantile(offsets, 0.95),
    dispersion25: quantile(dispersion, 0.25), dispersion50: quantile(dispersion, 0.5), dispersion75: quantile(dispersion, 0.75),
    mobilityH25: quantile(mobilityH, 0.25), mobilityH50: quantile(mobilityH, 0.5), mobilityH75: quantile(mobilityH, 0.75), mobilityH95: quantile(mobilityH, 0.95),
    leftMap: (100 * reasonCount[STOP.LEFT_MAP]) / total,
    walkers: total,
  };
  FIND_TYPES.forEach((name, i) => { stats[name] = typed ? (100 * typeCount[i]) / typed : 0; });
  STOP_NAMES.forEach((name, i) => { stats['stop: ' + name] = (100 * reasonCount[i]) / total; });
  return stats;
}

// ---- "True" locations, from ISRID statistics ONLY ----------------------------------------------------
// No walker of ours is involved. Each truth is:
//   1. a distance drawn from ISRID's urban distance curve (where the person ends up);
//      for a truth "t minutes after last seen" the distance is the smaller of that and
//      pace × t, with the pace drawn from the published gait-speed distribution;
//   2. a find type drawn from ISRID's urban find-location shares, among the types present at
//      that distance;
//   3. a random square of that type at that distance (within 10% or 30 m), anywhere around.
// Returns { cell, lat, lng, distanceM, type, endDistanceM } or { offMap: true, distanceM }.
export function placeTruth(setup, random, { minutes = Infinity, mobility = 'normal', profile = 'urban' } = {}) {
  const { surface, startCell, types } = setup;
  const n = surface.n;
  const r0 = Math.floor(startCell / n);
  const c0 = startCell % n;
  const endDistance = distanceQuantile(random(), profile);
  let d = endDistance;
  if (Number.isFinite(minutes)) {
    const pace = paceSamples(mobility);
    d = Math.min(d, pace[Math.floor(random() * pace.length)] * minutes);
  }
  const tolerance = Math.max(0.1 * d, 30);
  const lo = Math.max(0, d - tolerance);
  const hi = d + tolerance;
  const loCells = lo / SURFACE_CELL_M;
  const hiCells = hi / SURFACE_CELL_M;
  // Collect the squares in the ring, by type.
  const byType = FIND_TYPES.map(() => []);
  const reach = Math.ceil(hiCells);
  for (let r = Math.max(0, r0 - reach); r <= Math.min(n - 1, r0 + reach); r++) {
    for (let c = Math.max(0, c0 - reach); c <= Math.min(n - 1, c0 + reach); c++) {
      const dist = Math.hypot(r - r0, c - c0);
      if (dist < loCells || dist > hiCells) continue;
      const t = types[r * n + c];
      if (t !== BLOCKED) byType[t].push(r * n + c);
    }
  }
  // Share of the ring that is on the map: a ring that pokes out past the edge puts the truth
  // off the map with the matching chance.
  const ringArea = Math.PI * (hiCells * hiCells - loCells * loCells);
  let onMapCells = 0;
  for (let r = r0 - reach; r <= r0 + reach; r++) {
    for (let c = c0 - reach; c <= c0 + reach; c++) {
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      const dist = Math.hypot(r - r0, c - c0);
      if (dist >= loCells && dist <= hiCells) onMapCells += 1;
    }
  }
  const uOff = random();
  const uType = random();
  const uCell = random();
  if (uOff > Math.min(1, onMapCells / Math.max(ringArea, 1))) return { offMap: true, distanceM: d, endDistanceM: endDistance };
  const shares = FIND_TYPES.map((name, i) => (byType[i].length ? ISRID[profile].find[name] || 0 : 0));
  const totalShare = shares.reduce((a, b) => a + b, 0);
  if (!(totalShare > 0)) return { offMap: true, distanceM: d, endDistanceM: endDistance };
  let pick = uType * totalShare;
  let type = 0;
  for (; type < shares.length - 1; type++) { pick -= shares[type]; if (pick <= 0 && shares[type] > 0) break; }
  while (shares[type] === 0 && type > 0) type--;
  const cells = byType[type];
  const cell = cells[Math.min(cells.length - 1, Math.floor(uCell * cells.length))];
  const x = ((cell % n) + 0.5) * SURFACE_CELL_M - surface.radiusM;
  const y = (Math.floor(cell / n) + 0.5) * SURFACE_CELL_M - surface.radiusM;
  const { lat, lng } = xyToLatLng(surface.origin, x, y);
  // The same place as a square of the 25 m probability map.
  const gridCell = Math.floor((2 * Math.floor(cell / n) + 1) / 5) * 256 + Math.floor((2 * (cell % n) + 1) / 5);
  return {
    cell, gridCell, lat, lng, type: FIND_TYPES[type],
    distanceM: Math.hypot(Math.floor(cell / n) - r0, (cell % n) - c0) * SURFACE_CELL_M,
    endDistanceM: endDistance,
  };
}

// ---- Scoring a map against a truth ----------------------------------------------------------------------

export const CELL_AREA_KM2 = (25 * 25) / 1e6;

// Area searched before reaching the person, searching the most likely squares first:
// squares with a higher value than the truth's, plus half of those with the same value
// (Sava et al.'s n + m/2). `values` is a map over the 25 m grid; returns km².
export function areaBefore(values, truthCell) {
  const v = values[truthCell];
  let higher = 0;
  let same = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > v) higher += 1;
    else if (values[i] === v) same += 1;
  }
  return (higher + same / 2) * CELL_AREA_KM2;
}

// Rossmo-style score (Sava, Twardy, Koester, Sonwalkar 2016): r = (n + m/2) / N, R = (0.5 − r) / 0.5.
// +1 = the person is in the single most likely square, 0 = no better than a blank map.
// `extentKm2` is the area the map is scored over.
export function rossmoR(areaKm2, extentKm2) {
  return (0.5 - areaKm2 / extentKm2) / 0.5;
}

// A plain distance-ring map: nearer squares first. Values fall with distance from the start.
export function ringsMap(setup) {
  const { surface, startCell } = setup;
  const n = surface.n;
  const startRow = (Math.floor(startCell / n) + 0.5) * 0.4; // in 25 m squares
  const startCol = ((startCell % n) + 0.5) * 0.4;
  const out = new Float64Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) out[r * 256 + c] = -Math.hypot(r + 0.5 - startRow, c + 0.5 - startCol);
  return out;
}
