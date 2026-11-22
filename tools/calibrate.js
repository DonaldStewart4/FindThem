// tools/calibrate.js — fits the walkers' ASSUMPTION numbers to the published ISRID statistics.
//
// Run from the project folder:   node tools/calibrate.js          (about 5 minutes)
//                                node tools/calibrate.js --quick  (a rough fit in under a minute)
//
// What it does:
//   1. Picks 24 start points ("homes") on the wide Fremont map. 60 OTHER points are held out for
//      bench/prior-eval.js and are never used here.
//   2. For a setting of the numbers: runs 300 walkers from every start for 12 hours WITH
//      SPOTTING ON (a walker noticed on a road is found there), and measures the statistics in
//      bench/eval-lib.js: distance from the last-seen point (the primary target), where people
//      are found, track offset, dispersion angle.
//   3. Searches for the setting with the lowest score: a random search over the allowed ranges,
//      then repeated small changes to the best setting found so far (an evolution strategy).
//      Every setting is tested with the same random seeds, so differences are real.
//   4. Re-tests the best few with 1,000 walkers per start and new seeds, and keeps the winner.
//   5. Chooses BLEND_WALKERS, the walkers' share of the map, by evaluation: on the same start
//      points, with true locations placed from ISRID statistics alone, it tries every blend from
//      0 to 1 and keeps the one that reaches the person in the least area (step "--blend", run
//      in a fresh process so the engine has loaded the fitted numbers).
//   6. Writes engine/calibrated.json, engine/calibrated.js (the copy the browser imports) and
//      tools/calibration.json (everything the report needs: before / after, limits, the blend curve).
//
// DATA numbers (walking speed, the 34% who keep to roads) are never tuned.
// The spotting rate is fitted JOINTLY with the road finds: the one rate has to produce ISRID's
// 36% found on roads here, and is then the rate the app uses for "still missing".

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, PARAMS } from '../engine/params.js';
import { makeRandom } from '../engine/sim.js';
import {
  loadWideArea, calibrationStarts, setupStart, measure, score, TARGETS, WEIGHTS,
  placeTruth, areaBefore,
} from '../bench/eval-lib.js';

const QUICK = process.argv.includes('--quick');
const OUT_JSON = new URL('../engine/calibrated.json', import.meta.url);
const OUT_JS = new URL('../engine/calibrated.js', import.meta.url);
const OUT_REPORT = new URL('./calibration.json', import.meta.url);

// ---- What is tuned, and within what limits -------------------------------------------------------
// name: [low, high, 'log' if the range is searched on a logarithmic scale]
export const KNOBS = {
  MOBILE_MEDIAN_MIN: [10, 1440, 'log'],       // median minutes of mobility
  MOBILE_SIGMA: [0.5, 2.5],                   // its spread
  SHARE_WANDER: [0.02, 0.6],                  // shares are relative to SHARE_DIRECTION, which
  SHARE_STAYER: [0.02, 0.9],                  // stays fixed; the report shows them as percentages
  STAYER_MOBILE_MEDIAN_MIN: [1, 60, 'log'],
  TURN_SCALE_DEG: [15, 90],
  WANDER_TURN_SCALE_DEG: [30, 180],
  COURSE_SCALE_DEG: [15, 120],
  ROAD_STICK: [1.5, 40, 'log'],
  OPEN_BOOST: [0.3, 8, 'log'],
  P_STRUCT_STEP: [0.0003, 0.05, 'log'],
  P_STRUCT_STAYER: [0.005, 1, 'log'],
  P_WATER_ENTER: [0.01, 0.9, 'log'],
  P_CREEK_STUCK: [0.001, 0.9, 'log'],
  P_WOODS_STUCK: [0.001, 0.3, 'log'],
  P_BRUSH_STUCK: [0.001, 0.3, 'log'],
  SPOT_RATE_PER_MIN: [0.001, 0.5, 'log'],
};
const NAMES = Object.keys(KNOBS);

const toUnit = (name, value) => {
  const [lo, hi, scale] = KNOBS[name];
  return scale === 'log' ? Math.log(value / lo) / Math.log(hi / lo) : (value - lo) / (hi - lo);
};
const fromUnit = (name, u) => {
  const [lo, hi, scale] = KNOBS[name];
  const x = Math.min(1, Math.max(0, u));
  return scale === 'log' ? lo * Math.exp(x * Math.log(hi / lo)) : lo + x * (hi - lo);
};
const paramsFrom = (unit) => {
  const p = { ...DEFAULTS };
  NAMES.forEach((name, i) => { p[name] = fromUnit(name, unit[i]); });
  return p;
};
const round4 = (x) => Number(x.toPrecision(4));

function normal(random) {
  return Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
}

// ---- Step 5: the blend, by evaluation (runs in a fresh process) ------------------------------------

async function chooseBlend() {
  const engine = await import('../engine/index.js');
  const { replay } = await import('../engine/grid.js');
  const osm = loadWideArea();
  const area = engine.prepareArea(osm);
  const starts = calibrationStarts(osm);
  const blends = Array.from({ length: 21 }, (_, i) => i / 20);
  const times = [30, 60, 120, Infinity]; // minutes since last seen; Infinity = where they end up
  const truthsPerStart = QUICK ? 10 : 40;
  const sumLog = times.map(() => blends.map(() => 0));
  const counts = times.map(() => 0);
  starts.forEach((start, k) => {
    const setup = setupStart(osm, start);
    times.forEach((minutes, ti) => {
      const caseInput = { lastSeen: start, minutes: Number.isFinite(minutes) ? minutes : 720, direction: null, mobility: 'normal', familiarPlaces: [], seed: 1000 + k };
      const walkers = replay(area, caseInput, [], { blend: 1 }).grid.p;
      const stats = replay(area, caseInput, [], { blend: 0 }).grid.p;
      const random = makeRandom(77000 + 131 * k + ti);
      const mixed = new Float64Array(walkers.length);
      const truths = [];
      for (let j = 0; j < truthsPerStart; j++) {
        const truth = placeTruth(setup, random, { minutes });
        if (!truth.offMap) truths.push(truth.gridCell);
      }
      blends.forEach((w, bi) => {
        for (let i = 0; i < mixed.length; i++) mixed[i] = w * walkers[i] + (1 - w) * stats[i];
        for (const cell of truths) sumLog[ti][bi] += Math.log10(areaBefore(mixed, cell));
      });
      counts[ti] += truths.length;
    });
    process.stdout.write(`  blend: start ${k + 1}/${starts.length}\r`);
  });
  // Score of a blend = the mean, over all times and cases, of log10(area searched before
  // reaching the person). The log keeps a few huge areas from deciding everything.
  const curve = blends.map((w, bi) => {
    let total = 0;
    let cases = 0;
    const byTime = {};
    times.forEach((minutes, ti) => {
      total += sumLog[ti][bi];
      cases += counts[ti];
      byTime[Number.isFinite(minutes) ? `${minutes} min` : 'end'] = round4(10 ** (sumLog[ti][bi] / counts[ti]));
    });
    return { blend: w, meanLogArea: total / cases, typicalAreaKm2: round4(10 ** (total / cases)), byTime };
  });
  let best = curve[0];
  for (const point of curve) if (point.meanLogArea < best.meanLogArea - 1e-12) best = point;
  console.log('\n  walkers\' share | typical area searched before reaching the person (km², geometric mean)');
  for (const point of curve) {
    console.log(`  ${point.blend.toFixed(2)}           | ${point.typicalAreaKm2.toFixed(4)}   ${Object.entries(point.byTime).map(([k, v]) => `${k}: ${v}`).join('  ')}${point === best ? '   <= best' : ''}`);
  }
  return { best: best.blend, curve, cases: counts.reduce((a, b) => a + b, 0) };
}

function writeCalibrated(params, note) {
  const body = { note, params };
  fs.writeFileSync(OUT_JSON, JSON.stringify(body, null, 2) + '\n');
  fs.writeFileSync(OUT_JS, `// engine/calibrated.js — WRITTEN BY tools/calibrate.js. Do not edit by hand.
// The same content is in engine/calibrated.json; this copy exists because browsers on older
// phones cannot import a .json file as a module. These values override the defaults in params.js.
export default ${JSON.stringify(body, null, 2)};
`);
}

// ---- Main ------------------------------------------------------------------------------------------

async function main() {
  if (process.argv.includes('--blend')) {
    const result = await chooseBlend();
    const saved = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    saved.params.BLEND_WALKERS = result.best;
    writeCalibrated(saved.params, saved.note);
    const report = JSON.parse(fs.readFileSync(OUT_REPORT, 'utf8'));
    report.blend = result;
    fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 1) + '\n');
    console.log(`\n  BLEND_WALKERS = ${result.best}${result.best === 0 || result.best === 1 ? '   (AT ITS LIMIT)' : ''}`);
    return;
  }

  const t0 = Date.now();
  const osm = loadWideArea();
  const starts = calibrationStarts(osm);
  const setups = starts.map((s) => setupStart(osm, s));
  for (const s of setups) void s.surface.dRoad; // work out the road distances once
  console.log(`${setups.length} start points on the wide Fremont map, ${((Date.now() - t0) / 1000).toFixed(1)} s to set up`);

  const walkers = QUICK ? 120 : 300;
  const evaluate = (unit) => {
    const stats = measure(setups, paramsFrom(unit), { walkersPerStart: walkers, seed: 1 });
    return { unit, stats, score: score(stats) };
  };
  const defaultUnit = NAMES.map((name) => Math.min(1, Math.max(0, toUnit(name, DEFAULTS[name]))));
  const before = evaluate(defaultUnit);
  console.log(`defaults: score ${before.score.toFixed(2)}`);

  // Random search.
  const random = makeRandom(4242);
  const tried = [before];
  const nRandom = QUICK ? 30 : 140;
  for (let i = 0; i < nRandom; i++) {
    tried.push(evaluate(NAMES.map(() => random())));
    if ((i + 1) % 20 === 0) console.log(`  random ${i + 1}/${nRandom}: best ${Math.min(...tried.map((t) => t.score)).toFixed(2)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  // Refinement: change a few numbers of the best setting a little; keep the change if it helps.
  let best = tried.reduce((a, b) => (b.score < a.score ? b : a));
  const nRefine = QUICK ? 40 : 260;
  for (let i = 0; i < nRefine; i++) {
    const step = 0.25 * Math.pow(0.03 / 0.25, i / nRefine); // 0.25 of the range, shrinking to 0.03
    const candidate = best.unit.map((u) => (random() < 0.35 ? Math.min(1, Math.max(0, u + step * normal(random))) : u));
    const result = evaluate(candidate);
    tried.push(result);
    if (result.score < best.score) best = result;
    if ((i + 1) % 20 === 0) console.log(`  refine ${i + 1}/${nRefine}: best ${best.score.toFixed(2)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }

  // Noise check: the best few, with more walkers and new seeds.
  tried.sort((a, b) => a.score - b.score);
  const finalists = tried.slice(0, QUICK ? 3 : 6).map((f) => {
    const stats = measure(setups, paramsFrom(f.unit), { walkersPerStart: QUICK ? 400 : 1000, seed: 9001 });
    console.log(`  finalist: ${f.score.toFixed(2)} with ${walkers} walkers per start -> ${score(stats).toFixed(2)} with ${QUICK ? 400 : 1000} and new seeds`);
    return { unit: f.unit, stats, score: score(stats) };
  });
  const winner = finalists.reduce((a, b) => (b.score < a.score ? b : a));
  const fitted = paramsFrom(winner.unit);
  const beforeConfirm = measure(setups, { ...DEFAULTS }, { walkersPerStart: QUICK ? 400 : 1000, seed: 9001 });

  // Shares as they will be used (they are relative weights; normalize for the record).
  const shareTotal = fitted.SHARE_DIRECTION + fitted.SHARE_WANDER + fitted.SHARE_STAYER;
  const out = {};
  for (const name of NAMES) out[name] = round4(fitted[name]);
  out.SHARE_DIRECTION = round4(fitted.SHARE_DIRECTION / shareTotal);
  out.SHARE_WANDER = round4(fitted.SHARE_WANDER / shareTotal);
  out.SHARE_STAYER = round4(fitted.SHARE_STAYER / shareTotal);
  out.BLEND_WALKERS = PARAMS.BLEND_WALKERS; // replaced by the --blend step below

  const atLimit = [];
  const knobs = NAMES.map((name, i) => {
    const u = winner.unit[i];
    const limit = u < 0.03 ? 'low' : u > 0.97 ? 'high' : null;
    if (limit) atLimit.push(`${name} (${limit})`);
    return { name, low: KNOBS[name][0], high: KNOBS[name][1], scale: KNOBS[name][2] || 'linear', default: DEFAULTS[name], fitted: round4(fitted[name]), position: round4(u), atLimit: limit };
  });

  const note = `Fitted by tools/calibrate.js on ${new Date().toISOString().slice(0, 10)} to the ISRID urban dementia statistics, on ${setups.length} Fremont start points. Score ${score(beforeConfirm).toFixed(2)} -> ${winner.score.toFixed(2)} (lower is closer).`;
  writeCalibrated(out, note);
  fs.writeFileSync(OUT_REPORT, JSON.stringify({
    date: new Date().toISOString(), quick: QUICK, starts, walkersPerStart: walkers, settingsTried: tried.length,
    targets: TARGETS, weights: WEIGHTS,
    before: { score: score(beforeConfirm), stats: beforeConfirm },
    after: { score: winner.score, stats: winner.stats },
    knobs, atLimit, params: out, seconds: (Date.now() - t0) / 1000,
  }, null, 1) + '\n');

  console.log(`\n${tried.length} settings tried in ${((Date.now() - t0) / 1000).toFixed(0)} s. Score ${score(beforeConfirm).toFixed(2)} -> ${winner.score.toFixed(2)}`);
  console.log('\nstatistic            target   before    after');
  for (const key of Object.keys(TARGETS)) {
    console.log(`${key.padEnd(18)} ${String(TARGETS[key]).padStart(8)} ${beforeConfirm[key].toFixed(1).padStart(8)} ${winner.stats[key].toFixed(1).padStart(8)}${WEIGHTS[key] ? '' : '   (check only, not fitted)'}`);
  }
  console.log('\nwhy walkers stopped (after):');
  for (const [key, value] of Object.entries(winner.stats)) if (key.startsWith('stop: ') && value > 0) console.log(`  ${key.slice(6).padEnd(28)} ${value.toFixed(1)}%`);
  console.log('\nfitted numbers:');
  for (const k of knobs) console.log(`  ${k.name.padEnd(26)} ${String(k.default).padStart(8)} -> ${String(k.fitted).padStart(8)}   range ${k.low} to ${k.high}${k.atLimit ? `   AT ITS ${k.atLimit.toUpperCase()} LIMIT` : ''}`);
  console.log(atLimit.length ? `\nAt a limit: ${atLimit.join(', ')}` : '\nNo number ended at a limit.');

  // Step 5 in a fresh process, so the engine loads the numbers just written.
  console.log('\nChoosing the blend by evaluation...');
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--blend', ...(QUICK ? ['--quick'] : [])], { stdio: 'inherit' });
  if (child.status !== 0) throw new Error('the blend step failed');
  console.log(`\nWrote engine/calibrated.json, engine/calibrated.js and tools/calibration.json (${((Date.now() - t0) / 1000).toFixed(0)} s in all)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
