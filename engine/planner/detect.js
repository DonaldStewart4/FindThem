// engine/planner/detect.js — how likely a searcher is to spot the person, square by square.
//
// A "coverage" is a list of squares with, for each, the probability that this piece of
// searching would spot a person standing there: { cells: Int32Array, det: Float32Array }.
// Coverages from different searchers or tasks are independent looks: misses multiply.
//
//   - Walking or driving a track: one look from distance d spots a person with probability
//     P0 · e^(−2 · P0 · d / W), W = the sweep width of that square's visibility class
//     (params.js). Only the closest approach counts, once.
//   - Knocking on doors (the "yards" task): each building, and the yards behind the houses,
//     get a fixed chance of their own on top of what the street view gives.
//   - Sweeping a park in lines: Koopman's random-search formula, POD = 1 − e^(−coverage).
//   - Standing at a containment point: a small chance for everyone nearby who is still walking.

import { V, DEFAULTS, mobileShare } from './params.js';
import { footprint, cellXY } from './world.js';

// ---- Day or night ---------------------------------------------------------------------------------

// The sun's height above the horizon in degrees at a moment (ms since 1970) and place.
// Standard low-precision solar position (Astronomical Almanac), good to about 1°.
export function sunElevationDeg(ms, lat, lng) {
  const rad = Math.PI / 180;
  const d = (ms - 946728000000) / 86400000; // days since noon UTC on 1 Jan 2000
  const g = (357.529 + 0.98560028 * d) * rad;           // mean anomaly
  const q = 280.459 + 0.98564736 * d;                    // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * rad;             // tilt of the Earth's axis
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstHours = 18.697374558 + 24.06570982441908 * d;
  const hourAngle = (gmstHours * 15 + lng) * rad - ra;
  const sinEl = Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / rad;
}

export function isNight(ms, lat, lng, P = DEFAULTS) {
  return sunElevationDeg(ms, lat, lng) < P.NIGHT_SUN_DEG;
}

// ---- Looks along a track ----------------------------------------------------------------------------

// Sweep width per visibility class for a pace ('search' | 'hasty' | 'drive'), by day or night.
export function sweepWidths(pace, night, P = DEFAULTS) {
  const base = night ? P.W_NIGHT : P.W_DAY;
  const factor = pace === 'hasty' ? P.HASTY_W_FACTOR : pace === 'drive' ? P.DRIVE_W_FACTOR : 1;
  return base.map((w) => w * factor);
}

export function paceSpeed(pace, P = DEFAULTS) {
  return pace === 'hasty' ? P.HASTY_SPEED_MPS : pace === 'drive' ? P.DRIVE_SEARCH_MPS : P.SEARCH_SPEED_MPS;
}

// Probability that one look from `dist` meters spots a person on a square of sweep width w.
export function lookProbability(dist, w, P = DEFAULTS) {
  return w > 0 ? P.P0 * Math.exp((-2 * P.P0 * dist) / w) : 0;
}

// Coverage of walking (or driving) a track: a list of squares in order.
export function trackCoverage(world, track, pace, night, P = DEFAULTS) {
  const fp = footprint(world, track);
  return coverageOfFootprint(world, fp, pace, night, P);
}

export function coverageOfFootprint(world, fp, pace, night, P = DEFAULTS) {
  const widths = sweepWidths(pace, night, P);
  const cells = [];
  const det = [];
  for (let i = 0; i < fp.cells.length; i++) {
    const p = lookProbability(fp.dist[i], widths[world.vis[fp.cells[i]]], P);
    if (p >= P.MIN_DET) { cells.push(fp.cells[i]); det.push(p); }
  }
  return { cells: Int32Array.from(cells), det: Float32Array.from(det) };
}

// Two or more coverages by the same searcher on the same task, as one: misses multiply.
export function mergeCoverage(world, list) {
  const scratch = world.tmp.det; // all zero between calls
  const touched = [];
  for (const cov of list) {
    for (let i = 0; i < cov.cells.length; i++) {
      const c = cov.cells[i];
      if (scratch[c] === 0) touched.push(c);
      scratch[c] = 1 - (1 - scratch[c]) * (1 - cov.det[i]);
    }
  }
  touched.sort((a, b) => a - b);
  const cells = Int32Array.from(touched);
  const det = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i++) { det[i] = scratch[cells[i]]; scratch[cells[i]] = 0; }
  return { cells, det };
}

export function scaleCoverage(cov, factor) {
  if (factor === 1) return cov;
  return { cells: cov.cells, det: cov.det.map((d) => d * factor) };
}

// ---- Coverage by task type ---------------------------------------------------------------------------

// Knocking on the doors of a block: its building squares and back-yard squares.
export function canvassCoverage(world, task, night, P = DEFAULTS) {
  const factor = night ? P.NIGHT_CANVASS_FACTOR : 1;
  const cells = [];
  const det = [];
  for (const c of task.cells) {
    const v = world.vis[c];
    const p = v === V.BUILDING ? P.POD_CANVASS_BUILDING : v === V.YARD ? P.POD_CANVASS_YARD : 0;
    if (p > 0) { cells.push(c); det.push(p * factor); }
  }
  return { cells: Int32Array.from(cells), det: Float32Array.from(det) };
}

// How a park sweep goes: minutes needed, and the coverage reached. Lines one sweep width apart
// is coverage PARK_COVERAGE. If that would take longer than a task may (a big park at night),
// the time is capped and the coverage drops in proportion.
export function parkSweep(task, night, P = DEFAULTS) {
  const lineMeters = night ? task.lineMetersNight : task.lineMetersDay; // Σ square area ÷ W
  const full = (P.PARK_COVERAGE * lineMeters) / P.SEARCH_SPEED_MPS / 60;
  const minutes = Math.min(full, P.TASK_MAX_MIN);
  return { minutes, coverage: full > 0 ? (P.PARK_COVERAGE * minutes) / full : 0 };
}

export function sweepCoverage(task, coverage) {
  const p = 1 - Math.exp(-coverage);
  return { cells: task.cells, det: new Float32Array(task.cells.length).fill(p) };
}

// Standing at a containment point. Everyone within CATCH_M who is still walking has a
// PASS_SHARE chance of coming past, and the watcher sees POD_POST of those. (Three assumptions;
// see docs/PLANNER.md.) Plus an ordinary look at the squares around the post.
export function postCoverage(world, task, night, minutesSinceLastSeen, P = DEFAULTS) {
  const share = mobileShare(minutesSinceLastSeen, P) * P.PASS_SHARE * P.POD_POST;
  const { n, cellM } = world;
  const reach = Math.ceil(P.CATCH_M / cellM);
  const r0 = Math.floor(task.cell / n); const c0 = task.cell % n;
  const cells = [];
  for (let dr = -reach; dr <= reach; dr++) {
    const rr = r0 + dr;
    if (rr < 0 || rr >= n) continue;
    for (let dc = -reach; dc <= reach; dc++) {
      const c2 = c0 + dc;
      if (c2 < 0 || c2 >= n || Math.hypot(dr, dc) * cellM > P.CATCH_M) continue;
      cells.push(rr * n + c2);
    }
  }
  const passing = { cells: Int32Array.from(cells), det: new Float32Array(cells.length).fill(share) };
  return mergeCoverage(world, [passing, trackCoverage(world, [task.cell], 'search', night, P)]);
}

// The coverage of one piece of work, from what an event (or a planned option) says about it:
//   { type, task, track, fraction, canvass }   task may be null if this phone doesn't know the
//   segment; canvass: false = a yards task walked without knocking on doors.
export function coverageOfWork(world, work, night, minutesSinceLastSeen, P = DEFAULTS) {
  const { type, task } = work;
  const track = work.track || [];
  if (type === 'park' && task) {
    const sweep = parkSweep(task, night, P);
    return sweepCoverage(task, sweep.coverage * (work.fraction ?? 1));
  }
  if (type === 'containment' && task) return postCoverage(world, task, night, minutesSinceLastSeen, P);
  const pace = type === 'hasty' ? 'hasty' : type === 'drive' ? 'drive' : 'search';
  const walked = trackCoverage(world, track, pace, night, P);
  if (type === 'yards' && task && work.canvass !== false) return mergeCoverage(world, [walked, canvassCoverage(world, task, night, P)]);
  return walked;
}

// Probability picked up by a coverage on a map: Σ map[square] × detection.
export function gainOn(map, cov) {
  let gain = 0;
  for (let i = 0; i < cov.cells.length; i++) gain += map[cov.cells[i]] * cov.det[i];
  return gain;
}

export { cellXY };
