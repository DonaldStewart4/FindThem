// bench/real-cases.js — a real-world check of the prior against 161 news-reported cases of
// people with dementia who walked away and were found (docs/research/cases-public.csv).
//
// THESE CASES ARE NEVER USED FOR CALIBRATION. tools/calibrate.js does not read them. They are a
// held-out check only: does the model's picture look like what actually happened?
//
// Run from the project folder:
//   node bench/real-cases.js          the four comparisons below (no network)
//   node bench/real-cases-maps.js     optional, needs the internet: for the few cases whose two
//                                     points are known to street level, download that town's
//                                     map and score the prior on the real found place
//                                     (writes bench/real-cases-maps.json, which this script
//                                     then includes)
// Then:  node bench/prior-report.js   (adds the "Real cases" section to the report)
//
// The comparisons:
//   1. Distance from the last-seen point: model vs real (all, strict, by setting), in coarse
//      bins so the neighborhood-precision cases can be used.
//   2. Distance by time missing: the model's distance at t vs real cases that report both.
//   3. Find-type mix: model vs real.
//   4. Where the deceased were found vs what the hazard layer flags.
//
// READ WITH THE DATA'S BIASES IN MIND (docs/research/REPORT.md): news reports long, dramatic and
// fatal searches (43% of these cases are deceased), and the quick "found safe nearby" finds are
// mostly missing because their articles give no place. So real distances and times here lean
// long, and woods and water are over-represented.
//
// Writes bench/real-cases-results.json.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HAZARD_REACH_M, HAZARD_MIN_CHANCE } from '../engine/grid.js';
import { simulate } from '../engine/sim.js';
import { distanceCdf, farther, ISRID } from '../engine/prior.js';
import { SURFACE_CELL_M } from '../engine/surface.js';
import { PARAMS } from '../engine/params.js';
import { loadWideArea, heldOutStarts, setupStart, quantile } from './eval-lib.js';

const CASE_FILES = ['../docs/research/cases/cases-public.csv', '../docs/research/cases-public.csv'].map((p) => new URL(p, import.meta.url));
const OUT = new URL('./real-cases-results.json', import.meta.url);
const MAPS = new URL('./real-cases-maps.json', import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

function loadCases() {
  const file = CASE_FILES.find((f) => fs.existsSync(f));
  if (!file) throw new Error('docs/research/cases-public.csv not found. Make it with: node tools/make-public-cases.js');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const head = rows[0];
  if (head.includes('source_urls')) throw new Error('This is the private file (it has source_urls). Use cases-public.csv.');
  return rows.slice(1).map((r) => {
    const c = Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']));
    const num = (v) => (v === '' || v === undefined ? null : Number(v));
    return { ...c, distanceKm: num(c.distance_km), minutes: num(c.minutes_missing), lastSeen: c.last_seen_lat ? { lat: Number(c.last_seen_lat), lng: Number(c.last_seen_lng) } : null,
      found: c.found_lat ? { lat: Number(c.found_lat), lng: Number(c.found_lng) } : null };
  });
}

const round = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);
const share = (list, test) => (list.length ? list.filter(test).length / list.length : null); // callers round to 4 decimals
const quartiles = (xs) => ({ n: xs.length, q25: round(quantile(xs, 0.25), 2), q50: round(quantile(xs, 0.5), 2), q75: round(quantile(xs, 0.75), 2) });

// Coarse distance bins, at the ISRID urban quartile distances: ISRID urban puts 25% of people
// in each of the four. For cases located only to a neighborhood (±1–2 km) the two near bins
// are merged ("within 1.1 km").
const BINS = [['within 0.3 km', 0, 0.3], ['0.3 to 1.1 km', 0.3, 1.1], ['1.1 to 3.2 km', 1.1, 3.2], ['beyond 3.2 km', 3.2, Infinity]];
const binShares = (km) => BINS.map(([, lo, hi]) => round(share(km, (d) => d > lo && d <= hi || (lo === 0 && d === 0))));

function main() {
  const cases = loadCases();
  const withDistance = cases.filter((c) => c.distanceKm !== null);
  const precise = (c) => /geocoded \((exact|street)\)/.test(c.distance_basis);
  const reported = (c) => c.distance_basis === 'reported in source';
  const approx = (c) => /neighborhood/.test(c.distance_basis);

  // ---- The model's side ---------------------------------------------------------------------
  // (a) The ISRID curve the statistics map uses (95% of the prior); (b) the calibrated walkers
  // on the held-out Fremont starts, "found" the way calibration measures them.
  const evalResults = JSON.parse(fs.readFileSync(new URL('./prior-results.json', import.meta.url), 'utf8'));
  const walkers = evalResults.calibrationCheck.heldOut;
  const curveBins = (profile) => BINS.map(([, lo, hi]) => round(distanceCdf(hi === Infinity ? 1e9 : hi * 1000, profile) - distanceCdf(lo * 1000, profile)));
  const modelDistance = [
    { label: 'ISRID urban curve (what the statistics map uses)', bins: curveBins('urban') },
    { label: 'ISRID temperate curve (the alternative for open country)', bins: curveBins('temperate') },
    { label: 'Calibrated walkers, held-out Fremont starts', bins: [walkers.within300m, walkers.within1100m - walkers.within300m, walkers.within3200m - walkers.within1100m, 100 - walkers.within3200m].map((v) => round(v / 100)) },
  ];

  // ---- 1. Distance --------------------------------------------------------------------------
  const subsets = [
    ['All cases with a distance', withDistance],
    ['Strict cases', withDistance.filter((c) => c.strict === 'yes')],
    ['Both points known to street level', withDistance.filter(precise)],
    ['Distance stated in the article', withDistance.filter(reported)],
    ['Located to a neighborhood only (±1–2 km)', withDistance.filter(approx)],
    ['Setting: urban', withDistance.filter((c) => c.setting === 'urban')],
    ['Setting: suburban', withDistance.filter((c) => c.setting === 'suburban')],
    ['Setting: rural', withDistance.filter((c) => c.setting === 'rural')],
    ['Found alive', withDistance.filter((c) => c.outcome !== 'deceased')],
    ['Found deceased', withDistance.filter((c) => c.outcome === 'deceased')],
  ];
  const distance = subsets.map(([label, list]) => {
    const km = list.map((c) => c.distanceKm);
    return { label, ...quartiles(km), bins: binShares(km), coarseOnly: label.startsWith('Located to a neighborhood') };
  });

  // ---- 2. Distance by time missing ----------------------------------------------------------
  // The model's distance t minutes after last seen. Two versions:
  //   - the statistics map's rule: the smaller of the ISRID end distance and pace × t;
  //   - the calibrated walkers themselves (as the app runs them: nobody has noticed them), on
  //     held-out Fremont starts. Walkers are simulated for at most 12 hours.
  const both = cases.filter((c) => c.distanceKm !== null && c.minutes !== null);
  const TIME_BINS = [['up to 3 hours', 0, 180], ['3 to 12 hours', 180, 720], ['12 to 24 hours', 720, 1440], ['more than a day', 1440, Infinity]];
  const curveQuantile = (p, minutes) => {
    // The distance d with P(farther than d at t) = 1 − p, by bisection on a log scale.
    let lo = 1; let hi = 40000;
    for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (farther(mid, minutes, 'normal') > 1 - p) lo = mid; else hi = mid; }
    return Math.sqrt(lo * hi) / 1000;
  };
  const osm = loadWideArea();
  const setups = heldOutStarts(osm).slice(0, 12).map((s) => setupStart(osm, s));
  const walkerDistancesAt = (minutes) => {
    const t = Math.min(PARAMS.MAX_SIM_MINUTES, Math.round(minutes));
    const out = [];
    setups.forEach((setup, k) => {
      const walks = simulate(setup.surface, { startCell: setup.startCell, minutes: t, seed: 4100 + k, n: 400 });
      const n = setup.surface.n;
      const r0 = Math.floor(setup.startCell / n);
      const c0 = setup.startCell % n;
      for (let w = 0; w < walks.n; w++) {
        const cell = walks.endCell[w];
        out.push(cell < 0 ? 4.5 : (Math.hypot(Math.floor(cell / n) - r0, (cell % n) - c0) * SURFACE_CELL_M) / 1000); // off the map: at least the map's reach
      }
    });
    return out;
  };
  const byTime = TIME_BINS.map(([label, lo, hi]) => {
    const list = both.filter((c) => c.minutes > lo && c.minutes <= hi);
    if (!list.length) return { label, n: 0 };
    const minutes = quantile(list.map((c) => c.minutes), 0.5);
    const km = list.map((c) => c.distanceKm);
    const walk = walkerDistancesAt(minutes);
    return {
      label, n: list.length, medianMinutes: minutes, real: quartiles(km),
      curve: { q25: round(curveQuantile(0.25, minutes), 2), q50: round(curveQuantile(0.5, minutes), 2), q75: round(curveQuantile(0.75, minutes), 2) },
      walkers: { q25: round(quantile(walk, 0.25), 2), q50: round(quantile(walk, 0.5), 2), q75: round(quantile(walk, 0.75), 2), atMinutes: Math.min(PARAMS.MAX_SIM_MINUTES, minutes) },
    };
  });
  const minutesAll = cases.filter((c) => c.minutes !== null).map((c) => c.minutes);

  // ---- 3. Find-type mix ---------------------------------------------------------------------
  const TYPES = ['structure', 'road', 'linear', 'field', 'water', 'drainage', 'woods', 'brush'];
  const typed = cases.filter((c) => TYPES.includes(c.found_type));
  const mix = (list) => Object.fromEntries(TYPES.map((t) => [t, round(share(list, (c) => c.found_type === t))]));
  const findType = {
    model: [
      { label: 'ISRID urban (the calibration target)', n: 223, mix: Object.fromEntries(TYPES.map((t) => [t, ISRID.urban.find[t] / 100])) },
      { label: 'ISRID temperate', n: 207, mix: Object.fromEntries(TYPES.map((t) => [t, ISRID.temperate.find[t] / 100])) },
      { label: 'Calibrated walkers, held-out Fremont starts', n: walkers.walkers, mix: Object.fromEntries(TYPES.map((t) => [t, round(walkers[t] / 100)])) },
    ],
    real: [
      ['All real cases', typed], ['Found alive', typed.filter((c) => c.outcome !== 'deceased')], ['Found deceased', typed.filter((c) => c.outcome === 'deceased')],
      ['Setting: urban', typed.filter((c) => c.setting === 'urban')], ['Setting: suburban', typed.filter((c) => c.setting === 'suburban')], ['Setting: rural', typed.filter((c) => c.setting === 'rural')],
    ].map(([label, list]) => ({ label, n: list.length, mix: mix(list) })),
  };

  // ---- 4. The deceased and the hazard layer --------------------------------------------------
  // The hazard layer flags water, creeks / drainage channels and wetland near the likely area.
  const deceased = cases.filter((c) => c.outcome === 'deceased');
  const deceasedTyped = deceased.filter((c) => TYPES.includes(c.found_type));
  const HAZARD_TYPES = ['water', 'drainage'];
  const deceasedKm = deceased.filter((c) => c.distanceKm !== null).map((c) => c.distanceKm);
  const aliveKm = cases.filter((c) => c.outcome !== 'deceased' && c.distanceKm !== null).map((c) => c.distanceKm);
  const hazard = {
    deceased: deceased.length, deceasedShareOfAll: round(deceased.length / cases.length, 4),
    typed: deceasedTyped.length, mix: mix(deceasedTyped),
    inHazardTypes: round(share(deceasedTyped, (c) => HAZARD_TYPES.includes(c.found_type))),
    aliveInHazardTypes: round(share(typed.filter((c) => c.outcome !== 'deceased'), (c) => HAZARD_TYPES.includes(c.found_type))),
    notCovered: Object.fromEntries(TYPES.filter((t) => !HAZARD_TYPES.includes(t)).map((t) => [t, round(share(deceasedTyped, (c) => c.found_type === t))])),
    distance: { deceased: quartiles(deceasedKm), alive: quartiles(aliveKm), deceasedWithin800m: round(share(deceasedKm, (d) => d <= 0.8)), aliveWithin800m: round(share(aliveKm, (d) => d <= 0.8)) },
    // Of all the water and drainage finds, how many were deaths.
    waterFindsDeceased: round(share(typed.filter((c) => HAZARD_TYPES.includes(c.found_type)), (c) => c.outcome === 'deceased')),
    otherFindsDeceased: round(share(typed.filter((c) => !HAZARD_TYPES.includes(c.found_type)), (c) => c.outcome === 'deceased')),
    reachM: HAZARD_REACH_M, minChance: HAZARD_MIN_CHANCE,
  };

  const results = {
    date: new Date().toISOString(), cases: cases.length, withDistance: withDistance.length, withMinutes: minutesAll.length, withBoth: both.length,
    strict: cases.filter((c) => c.strict === 'yes').length,
    settings: Object.fromEntries(['urban', 'suburban', 'rural'].map((s) => [s, cases.filter((c) => c.setting === s).length])),
    bins: BINS.map(([label]) => label), modelDistance, distance,
    minutes: { n: minutesAll.length, q25: quantile(minutesAll, 0.25), q50: quantile(minutesAll, 0.5), q75: quantile(minutesAll, 0.75) },
    byTime, findType, hazard, maps: null,
  };

  // ---- Optional: the prior on the real places (made by bench/real-cases-maps.js) -------------
  try { results.maps = JSON.parse(fs.readFileSync(MAPS, 'utf8')); } catch { /* not run */ }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');

  // Terminal summary.
  console.log(`${cases.length} real cases: ${withDistance.length} with a distance, ${minutesAll.length} with minutes missing, ${both.length} with both, ${deceased.length} deceased\n`);
  console.log('1. Distance from last seen, share in each bin'.padEnd(64) + BINS.map(([l]) => l.padStart(15)).join(''));
  for (const m of modelDistance) console.log(('   MODEL  ' + m.label).padEnd(64) + m.bins.map((v) => `${Math.round(100 * v)}%`.padStart(15)).join(''));
  for (const d of distance) console.log((`   REAL   ${d.label} (n = ${d.n})`).padEnd(64) + d.bins.map((v) => `${Math.round(100 * v)}%`.padStart(15)).join('') + `   median ${d.q50} km`);
  console.log('\n2. Distance by time missing (km: 25% / 50% / 75%)');
  for (const b of byTime) if (b.n) console.log(`   ${b.label.padEnd(16)} n = ${String(b.n).padStart(2)}, median ${Math.round(b.medianMinutes / 60)} h   real ${b.real.q25} / ${b.real.q50} / ${b.real.q75}   model curve ${b.curve.q25} / ${b.curve.q50} / ${b.curve.q75}   walkers (at ${Math.round(b.walkers.atMinutes / 60)} h) ${b.walkers.q25} / ${b.walkers.q50} / ${b.walkers.q75}`);
  console.log('\n3. Find type'.padEnd(52) + TYPES.map((t) => t.padStart(10)).join(''));
  for (const m of [...findType.model.map((x) => ({ ...x, label: 'MODEL  ' + x.label })), ...findType.real.map((x) => ({ ...x, label: `REAL   ${x.label} (n = ${x.n})` }))]) console.log(('   ' + m.label).padEnd(52) + TYPES.map((t) => `${Math.round(100 * m.mix[t])}%`.padStart(10)).join(''));
  console.log(`\n4. Deceased: ${Math.round(100 * hazard.inHazardTypes)}% of the ${hazard.typed} with a find type were in water or a drainage (the hazard layer's kinds of place); woods ${Math.round(100 * hazard.notCovered.woods)}%. Alive cases: ${Math.round(100 * hazard.aliveInHazardTypes)}% in water or drainage.`);
  console.log(`   Of water / drainage finds, ${Math.round(100 * hazard.waterFindsDeceased)}% were deaths; of all other finds, ${Math.round(100 * hazard.otherFindsDeceased)}%.`);
  console.log(`   Distance, deceased: median ${hazard.distance.deceased.q50} km (n = ${hazard.distance.deceased.n}), ${Math.round(100 * hazard.distance.deceasedWithin800m)}% within 0.8 km; alive: median ${hazard.distance.alive.q50} km (n = ${hazard.distance.alive.n}).`);
  if (results.maps) {
    console.log(`\n5. The prior on real places: ${results.maps.cases.length} cases scored (${results.maps.skipped.length} skipped)`);
    for (const c of results.maps.cases) console.log(`   ${c.case_id.padEnd(7)} ${c.setting.padEnd(9)} ${String(c.found_type || '-').padEnd(9)} ${c.outcome.padEnd(16)} ${String(c.distanceKm).padStart(5)} km  area searched: prior ${c.newKm2} km², rings ${c.ringsKm2} km²${c.hazardNearM !== null ? `; nearest flagged water ${c.hazardNearM} m from the found place` : ''}`);
  }
  console.log('\nWrote bench/real-cases-results.json');
}

export { loadCases, parseCsv };

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
