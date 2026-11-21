// bench/benchmark.js — does FindThem help volunteers find someone sooner? A simulation.
//
// For many made-up cases on the real Fremont map, we place a "true" missing person, then let a
// team of volunteers search 200 m areas in 20-minute turns using four strategies:
//
//   1. On their own          each volunteer picks nearby areas at random (closer is likelier),
//                            with no shared record, so areas get searched twice.
//   2. Ring sweep            coordinated: areas in order of distance from the last-seen point,
//                            each searched once (a shared record, no probability map).
//   3. FindThem              the app's plan: the area with the most chance gained per minute,
//                            updated with Bayes after every empty search.
//   4. FindThem + sighting   the same, plus one neighbor's sighting reported after the first
//                            turn: seen somewhere on the way (between the last-seen point and
//                            where they end up), ~100 m off, with the direction they were going
//                            and how long ago, marked "probably".
//
// A search of an area finds the person, if they're there, with probability POD = 1 − e^(−coverage)
// (the same detection model the app uses). We count the share of cases found after 500, 1,500
// and 3,000 searcher-minutes.
//
// Honest limits: the "true" people come from our own walker model, run with DIFFERENT settings
// (straighter or twistier walking, giving up sooner, stopping at dead ends more often) so the
// app isn't graded on exactly its own assumptions. Real people are messier; this shows how much
// coordination and the map could help, not how searches go in real life.
//
// Run:   node bench/benchmark.js          (prints the table and writes bench/results.md)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareArea, toXY } from '../engine/graph.js';
import { simulate, makeRandom } from '../engine/sim.js';
import { replay, podForMinutes, GRID_RADIUS_M, SECTOR_CELLS, CELL_SIZE_M } from '../engine/grid.js';

// ---- Settings ----------------------------------------------------------------------------------

export const VOLUNTEERS = 6;               // searchers working at the same time
export const TURN_MINUTES = 20;            // each searcher searches one area per turn
export const CHECKPOINTS = [500, 1500, 3000]; // searcher-minutes at which we report
export const ON_THEIR_OWN_RADIUS_M = 1609; // "on their own" volunteers stay within a mile...
export const ON_THEIR_OWN_SCALE_M = 800;   // ...and prefer closer areas (weight e^(−distance/800))
export const SIGHTING_NOISE_M = 100;       // how far off the neighbor's sighting is
export const SIGHTING_RELIABILITY = 0.6;   // "probably"

// The five start points used for calibration, each with a heading for the "direction known" cases.
const STARTS = [
  { lat: 37.5405, lng: -121.9795, heading: 'NE' },
  { lat: 37.5530, lng: -121.9700, heading: 'S' },
  { lat: 37.5480, lng: -121.9850, heading: 'E' },
  { lat: 37.5600, lng: -121.9750, heading: 'W' },
  { lat: 37.5450, lng: -121.9600, heading: 'N' },
];
const CASE_MINUTES = 60;   // how long ago they were last seen
const CASE_MOBILITY = 'normal';

// How the "true" missing people walk: not quite what the app assumes (see sim.js for defaults:
// give-up 2,500 m, turn scale 30°, heading scale 90°, dead-end stop 0.3, trap 0.6).
const TRUTH_TUNINGS = [
  { GIVE_UP_MEDIAN_M: 2000, TURN_SCALE_DEG: 45, HEADING_SCALE_DEG: 120, DEAD_END_STOP_PROB: 0.45, TRAP_PROB: 0.5 },
  { GIVE_UP_MEDIAN_M: 3000, TURN_SCALE_DEG: 20, HEADING_SCALE_DEG: 60, DEAD_END_STOP_PROB: 0.2, TRAP_PROB: 0.7 },
];

const COLS = Math.round((2 * GRID_RADIUS_M) / CELL_SIZE_M);
const SECTOR_SIZE = SECTOR_CELLS * CELL_SIZE_M;
const SECTOR_COLS = COLS / SECTOR_CELLS;

function sectorIdAt(x, y) {
  const sc = Math.floor((x + GRID_RADIUS_M) / SECTOR_SIZE);
  const sr = Math.floor((y + GRID_RADIUS_M) / SECTOR_SIZE);
  if (sc < 0 || sr < 0 || sc >= SECTOR_COLS || sr >= SECTOR_COLS) return null;
  return `r${sr}c${sc}`;
}

// ---- The four strategies --------------------------------------------------------------------------
// Each one is called once per turn and returns the VOLUNTEERS area ids to search this turn.

function onTheirOwn(ctx, random) {
  const picks = [];
  for (let v = 0; v < VOLUNTEERS; v++) {
    let r = random() * ctx.nearbyTotal;
    let pick = ctx.nearby[ctx.nearby.length - 1].id;
    for (const s of ctx.nearby) { r -= s.weight; if (r <= 0) { pick = s.id; break; } }
    picks.push(pick);
  }
  return picks;
}

function ringSweep(ctx) {
  const picks = ctx.byDistance.slice(ctx.ringNext, ctx.ringNext + VOLUNTEERS).map((s) => s.id);
  ctx.ringNext += VOLUNTEERS;
  return picks;
}

// Greedy: give each volunteer the area where one more search adds the most chance of success.
// A second searcher in the same area adds less (they only find what the first one missed).
function findThem(ctx) {
  const pod = podForMinutes(TURN_MINUTES);
  const assigned = new Map();
  const picks = [];
  for (let v = 0; v < VOLUNTEERS; v++) {
    let best = null;
    let bestGain = -1;
    for (const [id, p] of ctx.belief) {
      const gain = p * Math.pow(1 - pod, assigned.get(id) || 0) * pod;
      if (gain > bestGain) { bestGain = gain; best = id; }
    }
    assigned.set(best, (assigned.get(best) || 0) + 1);
    picks.push(best);
  }
  return picks;
}

// After an empty turn: Bayes update on the area beliefs.
function updateBelief(belief, picks) {
  const pod = podForMinutes(TURN_MINUTES);
  for (const id of picks) belief.set(id, belief.get(id) * (1 - pod));
  let total = 0;
  for (const p of belief.values()) total += p;
  for (const [id, p] of belief) belief.set(id, p / total);
}

// ---- One case ---------------------------------------------------------------------------------------

// Plays one strategy until the person is found or the time runs out. Returns the
// searcher-minutes it took (Infinity if not found).
function play(strategy, setup, truth, random, area) {
  const maxTurns = Math.ceil(CHECKPOINTS[CHECKPOINTS.length - 1] / (VOLUNTEERS * TURN_MINUTES));
  const pod = podForMinutes(TURN_MINUTES);
  const ctx = {
    nearby: setup.nearby, nearbyTotal: setup.nearbyTotal, byDistance: setup.byDistance, ringNext: 0,
    belief: new Map(setup.prior),
  };
  const searchedEvents = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (strategy === 'sighting' && turn === 1) {
      // A neighbor saw them on the way: a point between the last-seen spot and where they end up,
      // a bit off, with the direction they were heading and how long ago it was.
      const f = 0.4 + 0.6 * random();
      const ang = random() * 2 * Math.PI;
      const dist = Math.abs(normalish(random)) * SIGHTING_NOISE_M;
      const sight = {
        x: setup.startXY.x + (truth.x - setup.startXY.x) * f + dist * Math.sin(ang),
        y: setup.startXY.y + (truth.y - setup.startXY.y) * f + dist * Math.cos(ang),
      };
      const heading = compass(setup.startXY, truth);
      const minutesSince = Math.round((1 - f) * CASE_MINUTES);
      const lat = area.origin.lat + sight.y / 111320;
      const lng = area.origin.lng + sight.x / (111320 * Math.cos((area.origin.lat * Math.PI) / 180));
      const events = [...searchedEvents, { id: 'sight', type: 'sighting', lat, lng, direction: heading, minutesSince, reliability: SIGHTING_RELIABILITY, at: 1e9 }];
      const pred = replay(area, setup.caseInput, events);
      ctx.belief = new Map(pred.grid.sectors.map((s) => [s.id, s.probability]));
    }

    let picks;
    if (strategy === 'own') picks = onTheirOwn(ctx, random);
    else if (strategy === 'ring') picks = ringSweep(ctx);
    else picks = findThem(ctx);

    for (let v = 0; v < picks.length; v++) {
      if (picks[v] === truth.sector && random() < pod) return (turn * VOLUNTEERS + v + 1) * TURN_MINUTES;
    }
    if (strategy === 'findthem' || strategy === 'sighting') {
      updateBelief(ctx.belief, picks);
      picks.forEach((id, v) => searchedEvents.push({ id: `t${turn}v${v}`, type: 'searched', sectorId: id, minutes: TURN_MINUTES, at: turn * 100 + v }));
    }
  }
  return Infinity;
}

// The 8-point compass direction from a to b, e.g. 'NE'.
function compass(a, b) {
  const deg = ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function normalish(random) {
  return Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
}

// ---- The whole benchmark --------------------------------------------------------------------------

export function runBenchmark({ casesPerSetup = 50, osm = null, log = () => {} } = {}) {
  const data = osm || JSON.parse(fs.readFileSync(new URL('../tests/fixtures/demo-area.json', import.meta.url)));
  const area = prepareArea(data);
  const strategies = ['own', 'ring', 'findthem', 'sighting'];
  const found = Object.fromEntries(strategies.map((s) => [s, CHECKPOINTS.map(() => 0)]));
  let cases = 0;
  let setupIndex = 0;

  for (const start of STARTS) {
    for (const knownDirection of [true, false]) {
      setupIndex += 1;
      const caseInput = {
        lastSeen: { lat: start.lat, lng: start.lng }, minutes: CASE_MINUTES,
        direction: knownDirection ? start.heading : null, mobility: CASE_MOBILITY,
        familiarPlaces: [], seed: 1000 + setupIndex,
      };
      // What the app believes before anyone searches.
      const pred = replay(area, caseInput, []);
      const s0 = toXY(area.origin, start.lat, start.lng);
      const sectors = pred.grid.sectors.map((s) => {
        const c = toXY(area.origin, s.center.lat, s.center.lng);
        return { id: s.id, probability: s.probability, distance: Math.hypot(c.x - s0.x, c.y - s0.y) };
      });
      const nearby = sectors.filter((s) => s.distance <= ON_THEIR_OWN_RADIUS_M)
        .map((s) => ({ id: s.id, weight: Math.exp(-s.distance / ON_THEIR_OWN_SCALE_M) }));
      const setup = {
        caseInput,
        startXY: s0,
        prior: sectors.map((s) => [s.id, s.probability]),
        byDistance: [...sectors].sort((a, b) => a.distance - b.distance),
        nearby,
        nearbyTotal: nearby.reduce((sum, s) => sum + s.weight, 0),
      };

      // The "true" people for this setup: walkers with different settings, a different seed.
      const truths = [];
      TRUTH_TUNINGS.forEach((tuning, k) => {
        const sim = simulate(area, {
          start: caseInput.lastSeen, minutes: CASE_MINUTES, direction: caseInput.direction,
          mobility: CASE_MOBILITY, familiarPlaces: [], seed: 50000 + setupIndex * 10 + k, tuning,
        });
        for (let i = 0; i < Math.ceil(casesPerSetup / TRUTH_TUNINGS.length); i++) truths.push(sim.endpoints[i * 37 % sim.endpoints.length]);
      });

      for (const t of truths.slice(0, casesPerSetup)) {
        const truth = { x: t.x, y: t.y, sector: sectorIdAt(t.x, t.y) };
        cases += 1;
        strategies.forEach((strategy, si) => {
          const random = makeRandom(cases * 7 + si * 100003);
          const minutes = play(strategy, setup, truth, random, area);
          CHECKPOINTS.forEach((c, ci) => { if (minutes <= c) found[strategy][ci] += 1; });
        });
      }
      log(`setup ${setupIndex}/10 done (${cases} cases)`);
    }
  }

  const share = Object.fromEntries(strategies.map((s) => [s, found[s].map((n) => n / cases)]));
  return { cases, checkpoints: CHECKPOINTS, share, found };
}

// 95% confidence interval half-width for a share p out of n (normal approximation).
export function margin(p, n) {
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}

export function resultsTable({ cases, checkpoints, share }) {
  const names = { own: 'Volunteers searching on their own', ring: 'Coordinated ring sweep', findthem: 'FindThem allocation', sighting: 'FindThem + one sighting' };
  const pct = (p) => `${Math.round(p * 100)}% ±${Math.round(margin(p, cases) * 100)}`;
  const head = `| Strategy | ${checkpoints.map((c) => `Found after ${c.toLocaleString('en-US')} searcher-min`).join(' | ')} |`;
  const sep = `|---|${checkpoints.map(() => '---').join('|')}|`;
  const rows = Object.keys(names).map((k) => `| ${names[k]} | ${share[k].map(pct).join(' | ')} |`);
  return [head, sep, ...rows].join('\n');
}

// ---- Command line ---------------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const result = runBenchmark({ casesPerSetup: 100, log: (m) => console.log(m) });
  const table = resultsTable(result);
  const seconds = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n${table}\n\n${result.cases} cases, ${seconds} s`);
  const md = `# FindThem benchmark results

Made by \`node bench/benchmark.js\` on ${new Date().toISOString().slice(0, 10)}: ${result.cases} simulated cases on the Fremont map (5 start points × direction known / unknown × ${result.cases / 10} people each), ${VOLUNTEERS} volunteers searching 200 m areas in ${TURN_MINUTES}-minute turns. ± is a 95% margin.

${table}

**How to read it:** "searcher-minutes" is people × minutes. 1,500 searcher-minutes is about 6 volunteers for 4 hours.

**Why the ring sweep levels off:** it searches each area once, nearest first. One 20-minute search spots a person who is there only about 38% of the time, so a single pass misses most people. FindThem goes back to the likeliest areas because its map says they're still worth it.

**Limits:** the "true" missing people come from our own walker model, run with different settings than the app assumes. Real searches are messier: volunteers don't search perfectly, people move, and the detection numbers are estimates. This shows how much coordination and the probability map could help, not a promise.
`;
  fs.writeFileSync(new URL('./results.md', import.meta.url), md);
  console.log('Wrote bench/results.md');
}
