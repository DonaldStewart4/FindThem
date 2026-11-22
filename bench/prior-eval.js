// bench/prior-eval.js — how good is the new prior? An evaluation on held-out Fremont start points.
//
// Run from the project folder:   node bench/prior-eval.js           (about 6 minutes)
//                                node bench/prior-eval.js --quick   (a rough pass in about a minute)
// Then:                          node bench/prior-report.js         (writes the .md and .html report)
//
// THE TRUE LOCATIONS COME FROM ISRID STATISTICS ONLY, never from our walkers (placeTruth in
// bench/eval-lib.js): a distance from ISRID's urban distance curve, a find type from ISRID's
// urban find-location shares, a random square of that type at that distance. For a truth
// "t minutes after last seen" the distance is the smaller of that and pace × t, the pace drawn
// from the published gait-speed distribution.
//
// Four maps are scored on every case:
//   rings   plain distance rings around the last-seen point (what a searcher does by instinct)
//   stats   the ISRID statistics map (engine/prior.js, without the "still missing" evidence).
//           It is THE SAME RECIPE THAT PLACED THE TRUTHS, so it is an upper bound, not a rival.
//   old     the old engine: the prior on the main branch (frozen copy in bench/old-engine/),
//           its 25 m map exactly as the engine returned it. That map is spiky (5,000 end points
//           on street lines over a 2% even floor), so half the truths land on a floor square.
//   oldSmooth  the same map blurred the way the old app blurred it before drawing the red /
//           orange / yellow areas (a 7-square box blur, twice: about 150 m). This is the fair
//           picture of what a user of the old app was shown, and the one the report leads with.
//   new     the new prior, exactly as the app computes it (engine.replay with no events)
//
// The score is the area searched before reaching the person, searching the most likely squares
// first (km², lower is better), and the Rossmo-style R of Sava et al. 2016.
// The start points are the 60 that tools/calibrate.js never saw.
//
// Writes bench/prior-results.json. bench/prior-report.js turns that into the report.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as engine from '../engine/index.js';
import { replay } from '../engine/grid.js';
import { PARAMS, DEFAULTS } from '../engine/params.js';
import { makeRandom } from '../engine/sim.js';
import { statsMap } from '../engine/prior.js';
import { prepareArea as prepareOldArea, toXY as oldToXY } from './old-engine/graph.js';
import { replay as oldReplay } from './old-engine/grid.js';
import {
  loadWideArea, heldOutStarts, calibrationStarts, setupStart, placeTruth, areaBefore, rossmoR,
  ringsMap, measure, score, TARGETS, WEIGHTS, CELL_AREA_KM2, quantile,
} from './eval-lib.js';

const QUICK = process.argv.includes('--quick');
const OUT = new URL('./prior-results.json', import.meta.url);

const TIMES = [15, 30, 60, 120, 'end'];   // minutes since last seen; 'end' = where they end up
const END_MINUTES = 720;                  // the engines are asked for 12 h when the truth is "the end"
const TRUTHS_PER_START = QUICK ? 6 : 20;
const GRID_KM2 = 6.4 * 6.4;               // our map
const SAVA_KM2 = 25 * 25;                 // the extent Sava et al. scored over
const TIE_KM2 = 0.05;                     // both within this area = a tie (a few minutes of searching)
const METHODS = ['rings', 'stats', 'old', 'oldSmooth', 'new'];

// The blur the old app applied before drawing (app.js drawHeat on the main branch: boxBlur
// with radius 3, applied twice). Each square becomes the sum of the squares within 3 of it.
function boxBlur(src, cols, rows, r) {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let y = 0; y < rows; y++) {
    let acc = 0;
    for (let x = 0; x <= r && x < cols; x++) acc += src[y * cols + x];
    for (let x = 0; x < cols; x++) {
      tmp[y * cols + x] = acc;
      if (x + r + 1 < cols) acc += src[y * cols + x + r + 1];
      if (x - r >= 0) acc -= src[y * cols + x - r];
    }
  }
  for (let x = 0; x < cols; x++) {
    let acc = 0;
    for (let y = 0; y <= r && y < rows; y++) acc += tmp[y * cols + x];
    for (let y = 0; y < rows; y++) {
      out[y * cols + x] = acc;
      if (y + r + 1 < rows) acc += tmp[(y + r + 1) * cols + x];
      if (y - r >= 0) acc -= tmp[(y - r) * cols + x];
    }
  }
  return out;
}
const asDrawn = (p) => boxBlur(boxBlur(p, 256, 256, 3), 256, 256, 3);

const round = (x, digits = 4) => (Number.isFinite(x) ? Number(x.toFixed(digits)) : x);
const median = (xs) => quantile(xs, 0.5);

// The truth's square on the OLD engine's grid, which is anchored to its own area center.
function oldGridCell(oldArea, lat, lng) {
  const { x, y } = oldToXY(oldArea.origin, lat, lng);
  const col = Math.floor((x + 3200) / 25);
  const row = Math.floor((y + 3200) / 25);
  if (col < 0 || col >= 256 || row < 0 || row >= 256) return -1;
  return row * 256 + col;
}

// The smallest set of squares holding 80% of the chance on the map ("hot zone").
function hotZone(p) {
  const order = Array.from(p.keys()).sort((a, b) => p[b] - p[a]);
  let total = 0;
  for (const v of p) total += v;
  const zone = new Uint8Array(p.length);
  let sum = 0;
  for (const i of order) { if (sum >= 0.8 * total) break; zone[i] = 1; sum += p[i]; }
  return zone;
}
function overlap(a, b) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) both += 1; if (a[i] || b[i]) either += 1; }
  return either ? both / either : 1;
}

function main() {
  const t0 = Date.now();
  const osm = loadWideArea();
  const area = engine.prepareArea(osm);
  const starts = heldOutStarts(osm).slice(0, QUICK ? 10 : 60);
  console.log(`${starts.length} held-out start points, ${TRUTHS_PER_START} true locations per start and time`);

  const cases = [];        // one row per true location
  const mismatch = [];     // the person has been gone 100 minutes; the app is told 60
  const restOfWorld = Object.fromEntries(TIMES.map((t) => [t, []]));
  const timing = { cold: [], warm: [], block: [] };
  const stability = { blend: { 60: [], end: [] }, walkersOnly: { 60: [], end: [] } };

  starts.forEach((start, k) => {
    const setup = setupStart(osm, start);
    // The old engine anchors its grid to the center of its download, so give it one centered
    // on this start (the best case for it).
    const oldArea = prepareOldArea({ ...osm, center: start });
    const rings = ringsMap(setup);
    const baseCase = { lastSeen: start, direction: null, mobility: 'normal', familiarPlaces: [], seed: 5000 + k };

    const maps = {};
    for (const time of TIMES) {
      const minutes = time === 'end' ? END_MINUTES : time;
      const pred = replay(area, { ...baseCase, minutes }, []);
      const oldP = oldReplay(oldArea, { ...baseCase, minutes }, []).grid.p;
      const stats = statsMap(setup.surface, setup.startCell, time === 'end' ? Infinity : minutes, { stillMissing: false }).grid;
      maps[time] = { new: pred.grid.p, old: oldP, oldSmooth: asDrawn(oldP), stats, rings };
      restOfWorld[time].push(pred.restOfWorld);
    }
    // Time one cold replay on a freshly prepared area (nothing cached).
    {
      const fresh = engine.prepareArea(osm);
      const c0 = performance.now();
      replay(fresh, { ...baseCase, minutes: 60 }, []);
      timing.cold.push(performance.now() - c0);
      const c1 = performance.now();
      replay(fresh, { ...baseCase, minutes: 55 }, []); // a 5-minute clock tick inside the same 15-minute block
      timing.warm.push(performance.now() - c1);
      const c2 = performance.now();
      replay(fresh, { ...baseCase, minutes: 65 }, []); // a tick that crosses into the next block: the walkers run again
      timing.block.push(performance.now() - c2);
    }

    const scoreTruth = (truth, which) => {
      const out = {};
      for (const m of METHODS) {
        const values = which[m];
        const cell = m === 'old' || m === 'oldSmooth' ? oldGridCell(oldArea, truth.lat, truth.lng) : truth.gridCell;
        out[m] = cell < 0 ? GRID_KM2 : areaBefore(values, cell);
      }
      return out;
    };

    TIMES.forEach((time, ti) => {
      const random = makeRandom(900000 + 1000 * k + ti);
      for (let j = 0; j < TRUTHS_PER_START; j++) {
        const truth = placeTruth(setup, random, { minutes: time === 'end' ? Infinity : time });
        if (truth.offMap) { cases.push({ k, time, offMap: true, d: round(truth.distanceM, 0) }); continue; }
        const areas = scoreTruth(truth, maps[time]);
        cases.push({ k, time, d: round(truth.distanceM, 0), type: truth.type, ...Object.fromEntries(METHODS.map((m) => [m, round(areas[m])])) });
      }
    });

    // Mismatch: truths at 100 minutes, maps for 60 (what the app was told) and for 100.
    {
      const random = makeRandom(700000 + k);
      const old100 = oldReplay(oldArea, { ...baseCase, minutes: 100 }, []).grid.p;
      const right = {
        new: replay(area, { ...baseCase, minutes: 100 }, []).grid.p,
        old: old100, oldSmooth: asDrawn(old100),
        stats: statsMap(setup.surface, setup.startCell, 100, { stillMissing: false }).grid, rings,
      };
      for (let j = 0; j < TRUTHS_PER_START; j++) {
        const truth = placeTruth(setup, random, { minutes: 100 });
        if (truth.offMap) continue;
        const told60 = scoreTruth(truth, maps[60]);
        const told100 = scoreTruth(truth, right);
        mismatch.push({ k, d: round(truth.distanceM, 0), rings: round(told60.rings),
          new60: round(told60.new), new100: round(told100.new), old60: round(told60.oldSmooth), old100: round(told100.oldSmooth),
          stats60: round(told60.stats), stats100: round(told100.stats) });
      }
    }

    // Stability: the same case with another seed. How much do the two hot zones overlap?
    if (k < (QUICK ? 4 : 20)) {
      for (const [label, minutes] of [[60, 60], ['end', END_MINUTES]]) {
        const a = { ...baseCase, minutes };
        const b = { ...baseCase, minutes, seed: 880000 + k };
        stability.blend[label].push(overlap(hotZone(replay(area, a, []).grid.p), hotZone(replay(area, b, []).grid.p)));
        stability.walkersOnly[label].push(overlap(hotZone(replay(area, a, [], { blend: 1 }).grid.p), hotZone(replay(area, b, [], { blend: 1 }).grid.p)));
      }
    }
    console.log(`  start ${k + 1}/${starts.length}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  });

  // ---- Calibration check on the held-out starts, and sensitivity --------------------------------
  console.log('calibration table and sensitivity...');
  const heldSetups = heldOutStarts(osm).slice(0, QUICK ? 8 : 24).map((s) => setupStart(osm, s));
  const calSetups = calibrationStarts(osm).slice(0, QUICK ? 8 : 24).map((s) => setupStart(osm, s));
  const walkers = QUICK ? 150 : 600;
  const fitted = { ...PARAMS };
  const heldOut = measure(heldSetups, fitted, { walkersPerStart: walkers, seed: 31 });
  const onCalibration = measure(calSetups, fitted, { walkersPerStart: walkers, seed: 31 });
  const defaults = measure(calSetups, { ...DEFAULTS }, { walkersPerStart: walkers, seed: 31 });
  const temperateTargets = { within300m: 25, within1000m: 50, within2400m: 75 };

  // Sensitivity: one number at a time, ±50% (DATA numbers ±20%), everything else as fitted.
  let calibration = null;
  try { calibration = JSON.parse(fs.readFileSync(new URL('../tools/calibration.json', import.meta.url), 'utf8')); } catch { /* not calibrated yet */ }
  const sensWalkers = QUICK ? 100 : 300;
  const baseStats = measure(calSetups, fitted, { walkersPerStart: sensWalkers, seed: 1 });
  const baseScore = score(baseStats);
  const sensitivity = [];
  const knobList = [
    ...(calibration ? calibration.knobs.map((kn) => ({ name: kn.name, kind: 'ASSUMPTION', step: 0.5, low: kn.low, high: kn.high })) : []),
    { name: 'SPEED_MEAN_MPS', kind: 'DATA', step: 0.2, low: 0.2, high: 1.3 },
    { name: 'ROAD_FOLLOWER_SHARE', kind: 'DATA', step: 0.2, low: 0, high: 1 },
    { name: 'MOVE_FRAC_MAX', kind: 'ASSUMPTION', step: 0.5, low: 0.36, high: 1 },
    { name: 'STRUCT_MIN_M', kind: 'ASSUMPTION', step: 0.5, low: 0, high: 400 },
    { name: 'HEADING_MEMORY', kind: 'ASSUMPTION', step: 0.5, low: 0, high: 0.95 },
  ];
  for (const kn of knobList) {
    const row = { name: kn.name, kind: kn.kind, step: kn.step, value: fitted[kn.name] };
    for (const [side, factor] of [['lower', 1 - kn.step], ['higher', 1 + kn.step]]) {
      const value = Math.min(kn.high, Math.max(kn.low, fitted[kn.name] * factor));
      const stats = measure(calSetups, { ...fitted, [kn.name]: value }, { walkersPerStart: sensWalkers, seed: 1 });
      // Which statistic moved most, in the score's own units.
      let moved = null;
      for (const key of Object.keys(WEIGHTS)) {
        const size = Math.abs(stats[key] - baseStats[key]) / (key.startsWith('trackOffset') || key.startsWith('dispersion') ? TARGETS[key] : 10);
        if (!moved || size > moved.size) moved = { key, size, change: stats[key] - baseStats[key] };
      }
      row[side] = { value: round(value, 5), score: round(score(stats), 3), change: round(score(stats) - baseScore, 3), moved: moved ? `${moved.key} ${moved.change >= 0 ? '+' : ''}${moved.change.toFixed(1)}` : '' };
    }
    row.impact = Math.max(Math.abs(row.lower.change), Math.abs(row.higher.change));
    sensitivity.push(row);
  }
  sensitivity.sort((a, b) => b.impact - a.impact);

  // The spotting rate has two jobs. Job 1 (road finds) is in the calibration table. Job 2:
  // how much weight the same rate takes off roads in the app's "still missing" evidence.
  const rate = fitted.SPOT_RATE_PER_MIN;
  const keepAfter = (exposure, minutes) => Math.pow(1 - rate, exposure * minutes);
  const stillMissing = {
    ratePerMinute: rate,
    weightLeft: [
      { road: 'main road (primary)', exposure: 1.0 }, { road: 'secondary road', exposure: 0.63 }, { road: 'collector (tertiary)', exposure: 0.4 },
      { road: 'residential street', exposure: 0.18 }, { road: 'footway', exposure: 0.1 }, { road: 'driveway / parking aisle', exposure: 0.06 },
    ].map((r) => ({ ...r, after10: round(keepAfter(r.exposure, 10), 3), after30: round(keepAfter(r.exposure, 30), 3), after60: round(keepAfter(r.exposure, 60), 3) })),
  };

  const results = {
    date: new Date().toISOString(), quick: QUICK,
    starts: starts.length, truthsPerStart: TRUTHS_PER_START, times: TIMES, methods: METHODS,
    gridKm2: GRID_KM2, savaKm2: SAVA_KM2, tieKm2: TIE_KM2, cellAreaKm2: CELL_AREA_KM2,
    cases, mismatch,
    restOfWorld: Object.fromEntries(TIMES.map((t) => [t, round(restOfWorld[t].reduce((a, b) => a + b, 0) / restOfWorld[t].length)])),
    timing: { coldMedianMs: round(median(timing.cold), 0), coldMaxMs: round(Math.max(...timing.cold), 0), clockTickMedianMs: round(median(timing.warm), 0), blockTickMedianMs: round(median(timing.block), 0) },
    stability: {
      blend: { 60: round(median(stability.blend[60]), 3), end: round(median(stability.blend.end), 3) },
      walkersOnly: { 60: round(median(stability.walkersOnly[60]), 3), end: round(median(stability.walkersOnly.end), 3) },
      starts: stability.blend[60].length,
    },
    calibrationCheck: { targets: TARGETS, weights: WEIGHTS, temperateTargets, defaults, onCalibration, heldOut, walkersPerStart: walkers,
      scoreDefaults: round(score(defaults), 2), scoreCalibration: round(score(onCalibration), 2), scoreHeldOut: round(score(heldOut), 2) },
    sensitivity: { baseScore: round(baseScore, 3), rows: sensitivity },
    stillMissing,
    params: fitted,
    seconds: round((Date.now() - t0) / 1000, 0),
  };
  fs.writeFileSync(OUT, JSON.stringify(results) + '\n');

  // A short summary on the terminal; the full tables are in the report.
  const on = cases.filter((c) => !c.offMap);
  console.log(`\n${cases.length} cases (${cases.length - on.length} off the map), ${results.seconds} s\n`);
  console.log('time   method   median km²   found within 0.25 / 0.5 / 1 / 2 km²   mean R (6.4 km map)');
  for (const time of TIMES) {
    const rows = on.filter((c) => c.time === time);
    for (const m of METHODS) {
      const a = rows.map((c) => c[m]);
      const within = [0.25, 0.5, 1, 2].map((b) => `${Math.round((100 * a.filter((x) => x <= b).length) / a.length)}%`.padStart(4)).join(' / ');
      const R = a.reduce((s, x) => s + rossmoR(x, GRID_KM2), 0) / a.length;
      console.log(`${String(time).padEnd(6)} ${m.padEnd(8)} ${median(a).toFixed(3).padStart(8)}     ${within}            ${R.toFixed(3)}`);
    }
  }
  console.log(`\ncold replay median ${results.timing.coldMedianMs} ms (max ${results.timing.coldMaxMs}), clock tick ${results.timing.clockTickMedianMs} ms`);
  console.log(`hot-zone overlap between two seeds: new prior ${results.stability.blend[60]} at 60 min, ${results.stability.blend.end} at the end; walkers alone ${results.stability.walkersOnly[60]} / ${results.stability.walkersOnly.end}`);
  console.log('Wrote bench/prior-results.json');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
