// Tests for the search planner (engine/planner/). Written with Claude Code for Nathan; see
// docs/PLANNER.md section 10 for what each group is meant to prove.
// Run just these with:   node --test tests/planner.test.js
//
// Two kinds of map are used:
//   - a tiny hand-made town (4 identical blocks, 9 corners, 12 streets), small enough to list
//     EVERY possible assignment and score each one from first principles;
//   - the real Fremont fixture, for the safety rules, stability and speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { prepareArea } from '../engine/graph.js';
import { replay } from '../engine/grid.js';
import { C } from '../engine/surface.js';
import { makeRandom } from '../engine/sim.js';
import * as planner from '../engine/planner/index.js';
import { G, V, DEFAULTS, withParams, mobileShare } from '../engine/planner/params.js';
import { buildWorld, FOOT, CAR, PRIVATE, RAIL_X, shortestFrom, trackOfEdges, cellAtXY } from '../engine/planner/world.js';
import { buildSegments } from '../engine/planner/segments.js';
import { postmanTour, orienteer, localGraph, matchOdd } from '../engine/planner/routes.js';
import {
  lookProbability, sweepWidths, trackCoverage, canvassCoverage, postCoverage, gainOn, isNight, sunElevationDeg,
} from '../engine/planner/detect.js';
import { planSearch as planOnWorld, posterior, readEvents, assignedEvent } from '../engine/planner/plan.js';

const NOON = Date.UTC(2026, 10, 22, 20, 0, 0);   // 12:00 in Fremont (PST)
const LATE = Date.UTC(2026, 10, 23, 6, 0, 0);    // 22:00 in Fremont
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// ---- The tiny town ---------------------------------------------------------------------------------
// 40 × 40 squares of 10 m. Streets along rows and columns 2, 20 and 38; four blocks of yards
// with 16 houses each between them. Everything outside the outer streets is "no data".
const LINES = [2, 20, 38];
function tinyTown(params, { lastSeen = { x: 5, y: 5 } } = {}) {
  const n = 40;
  const cls = new Uint8Array(n * n).fill(G.NODATA);
  for (let r = 2; r <= 38; r++) {
    for (let c = 2; c <= 38; c++) {
      const road = LINES.includes(r) || LINES.includes(c);
      const house = !road && ((r - 3) % 18) % 4 === 2 && ((c - 3) % 18) % 4 === 2;
      cls[r * n + c] = road ? G.ROAD : house ? G.BUILDING : G.YARD;
    }
  }
  const at = (k) => (k + 0.5) * 10 - 200; // meters of the middle of square k
  const x = []; const y = [];
  for (const r of LINES) for (const c of LINES) { x.push(at(c)); y.push(at(r)); }
  const a = []; const b = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (c < 2) { a.push(r * 3 + c); b.push(r * 3 + c + 1); }
    if (r < 2) { a.push(r * 3 + c); b.push((r + 1) * 3 + c); }
  }
  const P = withParams(params);
  const world = buildWorld({
    n, cellM: 10, origin: { lat: 37.55, lng: -121.97 }, cls,
    nodes: { x, y }, edges: { a, b, highway: a.map(() => 'residential') }, lastSeen,
  }, P);
  return { world, segs: buildSegments(world, P), n, corner: (r, c) => ({ x: at(LINES[c]), y: at(LINES[r]) }) };
}
// A probability map on the tiny town: random weight on every block square, summing to `total`.
function randomMap(town, seed, total = 1, tilt = null) {
  const random = makeRandom(seed);
  const p = new Float64Array(town.n * town.n);
  const blocks = town.segs.areas;
  const weight = blocks.map((_, k) => (tilt ? tilt[k] : 0.2 + random() * random() * 3));
  let sum = 0;
  blocks.forEach((task, k) => { for (const c of task.cells) { p[c] = weight[k] * (0.2 + random()); sum += p[c]; } });
  for (let i = 0; i < p.length; i++) p[i] *= total / sum;
  return p;
}
const ONLY_BLOCKS = { CONTAINMENT: false, HASTY_CANDIDATES: 0, PARK_CANDIDATES: 0, HAZARD_CANDIDATES: 0, HAZARD_FIRST: false, OPTIONS: 8 };
const clock = (nowMs = NOON, minutes = 60) => ({ nowMs, minutesSinceLastSeen: minutes, night: false });

// First-principles scoring of an assignment on the tiny town, written separately from the
// planner. assignment[i] = index of the block searcher i goes to. The detectors on a square are
// independent: each searcher's own look from the street, and ONE door-knocking per block that
// has anybody (knocking twice gets the same answers). The chance of finding the person is the
// sum over squares of p × P(at least one detector fires), and P(at least one fires) is found by
// listing every fire / no-fire outcome and adding up the ones with a fire.
function jointBruteForce(p, looks, knocks, assignment, knockers = null) {
  // knockers: which blocks have their doors knocked. Default: every block with a searcher.
  const used = knockers || [...new Set(assignment)];
  let found = 0;
  for (let c = 0; c < p.length; c++) {
    if (p[c] === 0) continue;
    const detectors = [];
    for (const k of assignment) if (looks[k][c] > 0) detectors.push(looks[k][c]);
    for (const k of used) if (knocks[k][c] > 0) detectors.push(knocks[k][c]);
    let any = 0;
    for (let outcome = 1; outcome < 1 << detectors.length; outcome++) {
      let chance = 1;
      for (let d = 0; d < detectors.length; d++) chance *= outcome & (1 << d) ? detectors[d] : 1 - detectors[d];
      any += chance;
    }
    found += p[c] * any;
  }
  return found;
}
function detectorsOf(town, P) {
  const dense = (cov) => { const out = new Float64Array(town.n * town.n); cov.cells.forEach((c, i) => { out[c] = cov.det[i]; }); return out; };
  const looks = town.segs.areas.map((task) => {
    const tour = postmanTour(town.world, task);
    return dense(trackCoverage(town.world, trackOfEdges(town.world, tour.edges, tour.nodes[0]), 'search', false, P));
  });
  const knocks = town.segs.areas.map((task) => dense(canvassCoverage(town.world, task, false, P)));
  return { looks, knocks };
}
const blockIndex = (town, taskId) => town.segs.areas.findIndex((t) => t.id === taskId);

// ---- Brute force ------------------------------------------------------------------------------------

test('tiny town: 4 identical blocks, each a 720 m loop of 4 streets with 8 doors', () => {
  const town = tinyTown();
  assert.equal(town.segs.areas.length, 4);
  for (const task of town.segs.areas) {
    assert.equal(task.type, 'yards');
    assert.equal(task.edges.length, 4);
    assert.equal(task.doors, 8);
    assert.ok(near(postmanTour(town.world, task).length, 720));
  }
});

test('brute force, equal times: the planner\'s assignment against EVERY assignment (2 and 3 searchers)', (t) => {
  // Doors take no time here and everyone starts at the middle corner, so every (searcher, block)
  // pair costs the same minutes and "most gain per minute" means "highest joint chance".
  const params = { ...ONLY_BLOCKS, DOUBLE_UP_FACTOR: 1, KNOCK_MIN: 0 };
  const P = withParams(params);
  const town = tinyTown(params);
  const { looks, knocks } = detectorsOf(town, P);
  let worst = 1; let exact = 0; let cases = 0;
  for (const count of [2, 3]) {
    for (let seed = 1; seed <= 40; seed++) {
      const p = randomMap(town, seed * 31 + count);
      const searchers = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 }));
      const plan = planOnWorld(town.world, town.segs, { p, restOfWorld: 0, searchers, events: [], clock: clock() }, params);
      const minutes = plan.searchers.map((s) => s.primary.travelMin + s.primary.searchMin);
      assert.ok(minutes.every((m) => near(m, minutes[0], 1e-6)), 'equal minutes for everyone');
      const mine = jointBruteForce(p, looks, knocks, plan.searchers.map((s) => blockIndex(town, s.primary.taskId)));
      let best = 0;
      for (let code = 0; code < 4 ** count; code++) {
        const assignment = Array.from({ length: count }, (_, i) => Math.floor(code / 4 ** i) % 4);
        best = Math.max(best, jointBruteForce(p, looks, knocks, assignment));
      }
      assert.ok(mine <= best + 1e-12);
      worst = Math.min(worst, mine / best);
      if (near(mine, best, 1e-9)) exact += 1;
      cases += 1;
      // The plan's own numbers must add up to the brute-force value of its assignment.
      const claimed = plan.searchers.reduce((sum, s) => sum + s.primary.posGain, 0);
      assert.ok(near(claimed, mine, 1e-6), `plan says ${claimed}, brute force says ${mine}`);
    }
  }
  t.diagnostic(`planner = brute-force optimum in ${exact} of ${cases} cases; worst ratio ${worst.toFixed(4)}`);
  assert.equal(exact, cases, 'on these small cases the planner should find the best assignment every time');
});

test('brute force, unequal times: no searcher could do better by changing task alone', (t) => {
  // Real door times and searchers at different corners. The check: for the planner's assignment,
  // move ONE searcher to each other block and recompute that searcher's gain per minute from
  // first principles. Nobody may have a better move.
  const params = { ...ONLY_BLOCKS, DOUBLE_UP_FACTOR: 1 };
  const P = withParams(params);
  const town = tinyTown(params);
  const { looks, knocks } = detectorsOf(town, P);
  const corners = [[0, 0], [2, 2], [1, 1], [0, 2]];
  let checked = 0; let unstable = 0; let worst = 1;
  for (const count of [2, 3, 4]) {
    for (let seed = 1; seed <= 25; seed++) {
      const p = randomMap(town, seed * 17 + count);
      const searchers = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, ...town.corner(...corners[i]), mode: 'foot', updatedAgoMin: 0 }));
      const plan = planOnWorld(town.world, town.segs, { p, restOfWorld: 0, searchers, events: [], clock: clock() }, params);
      const chosen = plan.searchers.map((s) => blockIndex(town, s.primary.taskId));
      // Who knocks where is part of the plan (one searcher per block; a second one only walks).
      const knocking = plan.searchers.map((s) => s.primary.canvass);
      plan.searchers.forEach((s, i) => {
        const others = chosen.filter((_, j) => j !== i);
        const othersKnock = [...new Set(chosen.filter((_, j) => j !== i && knocking[j]))];
        const without = jointBruteForce(p, looks, knocks, others, othersKnock);
        const rateOf = (block, option) => (jointBruteForce(p, looks, knocks, [...others, block], option.canvass ? [...new Set([...othersKnock, block])] : othersKnock) - without) / (option.travelMin + option.searchMin);
        const mine = rateOf(chosen[i], s.primary);
        for (const option of s.options.slice(1)) {
          const other = rateOf(blockIndex(town, option.taskId), option);
          checked += 1;
          if (other > mine * (1 + 1e-6)) { unstable += 1; worst = Math.min(worst, mine / other); }
        }
      });
    }
  }
  t.diagnostic(`${checked} single moves checked; ${unstable} would have been better${unstable ? ` (worst ratio ${worst.toFixed(3)})` : ''}`);
  assert.equal(unstable, 0);
});

// ---- No pile-ups -------------------------------------------------------------------------------------

test('no pile-up: N searchers get N different blocks whenever there are N comparable ones', () => {
  const town = tinyTown(ONLY_BLOCKS);
  for (let seed = 1; seed <= 30; seed++) {
    const random = makeRandom(seed);
    for (const count of [2, 3, 4]) {
      // Four blocks whose chances differ by at most 2×: no reason to share one.
      const p = randomMap(town, seed + 100 * count, 1, [1 + random(), 1 + random(), 1 + random(), 1 + random()]);
      const searchers = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 }));
      const plan = planOnWorld(town.world, town.segs, { p, restOfWorld: 0, searchers, events: [], clock: clock() }, ONLY_BLOCKS);
      const tasks = plan.searchers.map((s) => s.primary.taskId);
      assert.equal(new Set(tasks).size, count, `seed ${seed}: ${tasks.join(' ')}`);
    }
  }
});

test('no pile-up: a task someone holds is worth less to the next searcher, and its doors are not knocked twice', () => {
  const town = tinyTown(ONLY_BLOCKS);
  const p = randomMap(town, 5, 1, [3, 1, 1, 1]); // the first block is the likeliest
  const input = (searchers, events) => ({ p, restOfWorld: 0, searchers, events, clock: clock() });
  const one = { id: 'ana', ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 };
  const two = { id: 'ben', ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 };
  const alone = planOnWorld(town.world, town.segs, input([two], []), ONLY_BLOCKS).searchers[0].primary;
  const hot = town.segs.areas[0].id;
  assert.equal(alone.taskId, hot);
  assert.equal(alone.permission, 'ask');
  const taken = { id: 'e1', ...assignedEvent(alone, 'ana', NOON) };
  const plan = planOnWorld(town.world, town.segs, input([one, two], [taken]), ONLY_BLOCKS);
  const ana = plan.searchers.find((s) => s.searcherId === 'ana');
  const ben = plan.searchers.find((s) => s.searcherId === 'ben');
  assert.ok(ana.keep);
  assert.equal(ana.primary.taskId, hot);
  assert.notEqual(ben.primary.taskId, hot, 'Ben is sent elsewhere');
  const again = ben.options.find((o) => o.taskId === hot);
  assert.ok(again.posGain < alone.posGain * 0.5, 'the held block is worth much less to Ben');
  assert.equal(again.canvass, false, 'Ben would only walk past: Ana is doing the doors');
  assert.equal(again.permission, 'none');
});

test('doubling up happens only when it clearly beats the next-best task (DOUBLE_UP_FACTOR)', () => {
  // Two searchers, one very likely block. Everything else is made almost empty, so a second
  // look at the likely block is worth far more than anything else: they double up. Then the
  // other blocks get a fair share and they split.
  const town = tinyTown(ONLY_BLOCKS);
  const searchers = ['a', 'b'].map((id) => ({ id, ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 }));
  const tasksFor = (tilt) => planOnWorld(town.world, town.segs, { p: randomMap(town, 9, 1, tilt), restOfWorld: 0, searchers, events: [], clock: clock() }, ONLY_BLOCKS)
    .searchers.map((s) => s.primary.taskId);
  const lopsided = tasksFor([1, 1e-5, 1e-5, 1e-5]);
  assert.equal(lopsided[0], lopsided[1], 'both on the only block that matters');
  const fair = tasksFor([1, 0.5, 0.5, 0.5]);
  assert.notEqual(fair[0], fair[1]);
  // Exactly at the rule: with no mark-down (factor 1) and a huge one (factor 1000).
  const p = randomMap(town, 9, 1, [1, 0.04, 0.04, 0.04]);
  const at = (factor) => planOnWorld(town.world, town.segs, { p, restOfWorld: 0, searchers, events: [], clock: clock() }, { ...ONLY_BLOCKS, DOUBLE_UP_FACTOR: factor })
    .searchers.map((s) => s.primary.taskId);
  assert.equal(new Set(at(1)).size, 1, 'with no mark-down a second walk past the likely block wins');
  assert.equal(new Set(at(1000)).size, 2, 'with a huge mark-down they never share');
});

// ---- Events, Bayes and sums ---------------------------------------------------------------------------

test('events: latest assignment holds; released, completed and expired ones do not', () => {
  const ev = (id, type, at, extra) => ({ id, type, searcherId: 'ana', taskId: 'y1', at, expiresAt: at + 3600000, ...extra });
  assert.equal(readEvents([ev('a', 'assigned', 1000)], 2000).active.get('ana').id, 'a');
  assert.equal(readEvents([ev('a', 'assigned', 1000), ev('b', 'released', 1500)], 2000).active.size, 0);
  assert.equal(readEvents([ev('b', 'released', 1500), ev('a', 'assigned', 1000)], 2000).active.size, 0, 'order of arrival does not matter');
  const done = readEvents([ev('a', 'assigned', 1000, { track: [1, 2, 3] }), ev('c', 'completed', 1800)], 2000);
  assert.equal(done.active.size, 0);
  assert.deepEqual(done.done[0].track, [1, 2, 3], 'a completed task with no trail of its own is credited with the planned route');
  assert.deepEqual(readEvents([ev('a', 'assigned', 1000, { track: [1, 2, 3] }), ev('c', 'completed', 1800, { track: [7, 8] })], 2000).done[0].track, [7, 8], 'a GPS trail replaces it');
  assert.equal(readEvents([ev('a', 'assigned', 1000, { expiresAt: 1900 })], 2000).active.size, 0, 'expired');
  assert.equal(readEvents([ev('a', 'assigned', 1000), ev('m', 'message', 1200), null], 2000).active.size, 1, 'other event types are ignored');
});

test('sums: an option\'s POS gain is exactly the drop in probability when it is completed; the team\'s gains add up', () => {
  const town = tinyTown(ONLY_BLOCKS);
  const p = randomMap(town, 3, 0.9); // 10% "not on this map"
  const searchers = ['a', 'b', 'c'].map((id, i) => ({ id, ...town.corner(i, i), mode: 'foot', updatedAgoMin: 0 }));
  const base = { p, restOfWorld: 0.1, searchers, clock: clock() };
  const plan = planOnWorld(town.world, town.segs, { ...base, events: [] }, ONLY_BLOCKS);
  assert.equal(plan.measures.cumulativePOS, 0);
  assert.ok(near(plan.measures.restOfWorld, 0.1));
  let events = [];
  let total = 0;
  let lastPOS = 0;
  let lastROW = 0.1;
  plan.searchers.forEach((s, i) => {
    events = events.concat([{ id: `a${i}`, ...assignedEvent(s.primary, s.searcherId, NOON) }, { id: `c${i}`, type: 'completed', searcherId: s.searcherId, taskId: s.primary.taskId, at: NOON }]);
    total += s.primary.posGain;
    const after = posterior(town.world, town.segs, { ...base, events }, DEFAULTS);
    let sum = 0;
    for (const v of after.post) sum += v;
    assert.ok(near(sum + after.restOfWorld, 1, 1e-12), 'map + rest of world = 1 after every completed task');
    assert.ok(after.cumulativePOS > lastPOS, 'cumulative POS only goes up');
    assert.ok(after.restOfWorld > lastROW, 'an empty search raises "not on this map"');
    lastPOS = after.cumulativePOS; lastROW = after.restOfWorld;
  });
  assert.ok(near(lastPOS, total, 1e-9), `completed POS ${lastPOS} = sum of the options' gains ${total}`);
  assert.ok(near(lastROW, 0.1 / (1 - total), 1e-9), 'rest of world follows Bayes: 0.1 ÷ (1 − POS)');
  const later = planOnWorld(town.world, town.segs, { ...base, events }, ONLY_BLOCKS);
  assert.equal(later.measures.rowTrend.history.length, 3);
  assert.ok(near(later.measures.remaining + later.measures.restOfWorld, 1));
});

test('a pair is one look: two "completed" events for the same hazard task count once', () => {
  const town = tinyTown(ONLY_BLOCKS);
  const p = randomMap(town, 4);
  const track = trackOfEdges(town.world, [0, 1], 0);
  const pairEvents = [
    { id: 'a1', type: 'assigned', searcherId: 'a', taskId: 'hX', at: NOON, expiresAt: NOON + 1e7, track, partnerId: 'b' },
    { id: 'a2', type: 'assigned', searcherId: 'b', taskId: 'hX', at: NOON, expiresAt: NOON + 1e7, track, partnerId: 'a' },
    { id: 'c1', type: 'completed', searcherId: 'a', taskId: 'hX', at: NOON + 1 },
    { id: 'c2', type: 'completed', searcherId: 'b', taskId: 'hX', at: NOON + 2 },
  ];
  const input = (events) => ({ p, restOfWorld: 0, searchers: [], events, clock: clock(NOON + 3) });
  const both = posterior(town.world, town.segs, input(pairEvents), DEFAULTS).cumulativePOS;
  const single = posterior(town.world, town.segs, input(pairEvents.slice(0, 3)), DEFAULTS).cumulativePOS;
  assert.ok(single > 0);
  assert.ok(near(both, single, 1e-12));
});

test('knocking on the same doors again within two hours adds only the walk past', () => {
  const town = tinyTown(ONLY_BLOCKS);
  const p = randomMap(town, 6);
  const task = town.segs.areas[0];
  const done = (id, who, at) => ({ id, type: 'completed', searcherId: who, taskId: task.id, at });
  const pos = (events, now) => posterior(town.world, town.segs, { p, restOfWorld: 0, searchers: [], events, clock: clock(now) }, withParams({ AGE_TAU_MIN: 0 })).cumulativePOS;
  const once = pos([done('c1', 'a', NOON)], NOON);
  const soon = pos([done('c1', 'a', NOON), done('c2', 'b', NOON + 30 * 60000)], NOON + 30 * 60000);
  const later = pos([done('c1', 'a', NOON), done('c2', 'b', NOON + 121 * 60000)], NOON + 121 * 60000);
  assert.ok(soon > once && later > soon, `${once} < ${soon} < ${later}`);
});

test('measures: the "expand the search" signal', () => {
  const town = tinyTown(ONLY_BLOCKS);
  const searchers = [{ id: 'a', ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 }];
  const signal = (p, row) => planOnWorld(town.world, town.segs, { p, restOfWorld: row, searchers, events: [], clock: clock() }, ONLY_BLOCKS).measures.expand;
  assert.deepEqual(signal(randomMap(town, 1, 0.9), 0.1), { signal: false, reasons: [] });
  assert.deepEqual(signal(randomMap(town, 1, 0.4), 0.6).reasons, ['rest_of_world_high']);
  // A map with almost nothing left on it: rest of world high AND nothing worth doing.
  assert.deepEqual(signal(randomMap(town, 1, 0.001), 0.999).reasons, ['rest_of_world_high', 'map_exhausted']);
});

// ---- Detection ----------------------------------------------------------------------------------------

test('detection: the area under the look curve is the sweep width (its definition), and night is lower', () => {
  for (const w of [4, 16, 30, 40]) {
    let area = 0;
    for (let d = -500; d < 500; d += 0.01) area += lookProbability(Math.abs(d + 0.005), w) * 0.01;
    assert.ok(Math.abs(area - w) < 0.01 * w, `W = ${w}: area ${area}`);
  }
  assert.equal(lookProbability(0, 30), DEFAULTS.P0);
  assert.equal(lookProbability(10, 0), 0, 'a wall: nothing is seen inside a building');
  const day = sweepWidths('search', false); const night = sweepWidths('search', true);
  for (const k of [V.STREET, V.OPEN, V.YARD, V.COVER]) assert.ok(night[k] < day[k]);
  assert.equal(day[V.BUILDING], 0);
  assert.ok(sweepWidths('hasty', false)[V.STREET] < day[V.STREET]);
  assert.ok(sweepWidths('drive', false)[V.STREET] < sweepWidths('hasty', false)[V.STREET]);
});

test('detection: walking a street sees the street and front yards; houses and back yards need the door-knock', () => {
  const town = tinyTown();
  const task = town.segs.areas[0];
  const tour = postmanTour(town.world, task);
  const walk = trackCoverage(town.world, trackOfEdges(town.world, tour.edges, tour.nodes[0]), 'search', false);
  const seen = new Map(Array.from(walk.cells, (c, i) => [c, walk.det[i]]));
  const { world } = town;
  const onStreet = 2 * 40 + 10; const frontYard = 3 * 40 + 10; const backYard = 8 * 40 + 8; const house = 5 * 40 + 5;
  assert.equal(world.vis[onStreet], V.STREET); assert.equal(world.vis[frontYard], V.STREET);
  assert.equal(world.vis[backYard], V.YARD); assert.equal(world.vis[house], V.BUILDING);
  assert.ok(near(seen.get(onStreet), 0.9, 1e-6));
  assert.ok(near(seen.get(frontYard), 0.9 * Math.exp((-2 * 0.9 * 10) / 30), 1e-6));
  assert.ok(!seen.has(house), 'nothing through walls');
  assert.ok((seen.get(backYard) || 0) < 0.01, 'almost nothing of a back yard from the street');
  const knock = canvassCoverage(world, task, false);
  const asked = new Map(Array.from(knock.cells, (c, i) => [c, knock.det[i]]));
  assert.ok(near(asked.get(house), DEFAULTS.POD_CANVASS_BUILDING, 1e-6));
  assert.ok(near(asked.get(backYard), DEFAULTS.POD_CANVASS_YARD, 1e-6));
  assert.ok(!asked.has(onStreet));
  const atNight = trackCoverage(world, trackOfEdges(world, tour.edges, tour.nodes[0]), 'search', true);
  const nightSeen = new Map(Array.from(atNight.cells, (c, i) => [c, atNight.det[i]]));
  assert.ok(nightSeen.get(frontYard) < seen.get(frontYard));
});

test('day and night come from the sun: Fremont at noon and at 10 pm', () => {
  assert.ok(sunElevationDeg(NOON, 37.55, -121.97) > 25);
  assert.ok(sunElevationDeg(LATE, 37.55, -121.97) < -30);
  assert.equal(isNight(NOON, 37.55, -121.97), false);
  assert.equal(isNight(LATE, 37.55, -121.97), true);
});

test('share of people still walking follows the ISRID mobility quartiles', () => {
  assert.equal(mobileShare(0), 0.75);
  assert.ok(near(mobileShare(15), 0.5));
  assert.ok(near(mobileShare(3.8 * 60), 0.25));
  assert.ok(near(mobileShare(18 * 60), 0.05));
  assert.ok(mobileShare(60) < 0.5 && mobileShare(60) > 0.25);
  assert.equal(mobileShare(48 * 60), 0.05);
});

// ---- Routes ---------------------------------------------------------------------------------------------

// A small graph world: nodes on a grid of `cols` × `rows` corners 100 m apart, with the given
// streets (pairs of corner numbers).
function graphWorld(cols, rows, pairs) {
  const n = 60;
  const cls = new Uint8Array(n * n).fill(G.DEVELOPED);
  const x = []; const y = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { x.push(c * 100 - 150); y.push(r * 100 - 150); }
  return buildWorld({ n, cellM: 10, origin: { lat: 37.55, lng: -121.97 }, cls, nodes: { x, y },
    edges: { a: pairs.map((q) => q[0]), b: pairs.map((q) => q[1]), highway: pairs.map(() => 'residential') }, lastSeen: { x: 0, y: 0 } });
}
// The shortest closed walk covering every street, by trying everything: breadth-first over
// (corner, set of streets covered so far).
function shortestCoverWalk(world) {
  const { E, ea, eb, elen, N } = world.g;
  const full = (1 << E) - 1;
  let best = Infinity;
  for (let start = 0; start < N; start++) {
    const dist = new Map([[start * (full + 1), 0]]);
    const queue = [[0, start, 0]]; // length, corner, covered
    while (queue.length) {
      queue.sort((p, q) => p[0] - q[0]);
      const [d, at, mask] = queue.shift();
      if (d > (dist.get(at * (full + 1) + mask) ?? Infinity)) continue;
      if (mask === full && at === start) { best = Math.min(best, d); break; }
      for (let e = 0; e < E; e++) {
        if (ea[e] !== at && eb[e] !== at) continue;
        const to = ea[e] === at ? eb[e] : ea[e];
        const key = to * (full + 1) + (mask | (1 << e));
        if (d + elen[e] < (dist.get(key) ?? Infinity)) { dist.set(key, d + elen[e]); queue.push([d + elen[e], to, mask | (1 << e)]); }
      }
    }
  }
  return best;
}

test('rural postman: the tour covers every street, joins up, and is as short as brute force', () => {
  const shapes = {
    square: [3, 2, [[0, 1], [1, 4], [4, 3], [3, 0]]],
    'two squares': [3, 2, [[0, 1], [1, 2], [2, 5], [5, 4], [4, 3], [3, 0], [1, 4]]],
    tree: [3, 3, [[0, 1], [1, 2], [1, 4], [4, 7], [4, 3]]],
    'grid with a spur': [3, 3, [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [1, 4], [2, 5], [4, 7]]],
  };
  for (const [name, [cols, rows, pairs]] of Object.entries(shapes)) {
    const world = graphWorld(cols, rows, pairs);
    const task = { edges: Int32Array.from(pairs.map((_, i) => i)) };
    const tour = postmanTour(world, task);
    assert.equal(tour.nodes[0], tour.nodes[tour.nodes.length - 1], `${name}: closed`);
    assert.equal(new Set(tour.edges).size, pairs.length, `${name}: every street covered`);
    tour.edges.forEach((e, i) => {
      const ends = [world.g.ea[e], world.g.eb[e]];
      assert.ok(ends.includes(tour.nodes[i]) && ends.includes(tour.nodes[i + 1]), `${name}: step ${i} follows its street`);
    });
    assert.ok(near(tour.length, shortestCoverWalk(world), 1e-9), `${name}: ${tour.length} m vs brute force ${shortestCoverWalk(world)} m`);
  }
});

test('rural postman: pairing odd corners is exact up to 12, and the greedy pairing above that is close', (t) => {
  const random = makeRandom(11);
  let worst = 1;
  for (let round = 0; round < 20; round++) {
    const pts = Array.from({ length: 14 }, () => [random() * 1000, random() * 1000]);
    const D = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
    const cost = (pairs) => pairs.reduce((sum, [i, j]) => sum + D[i][j], 0);
    const greedy = matchOdd(D); // 14 corners: the greedy path
    assert.equal(new Set(greedy.flat()).size, 14);
    // Exact for comparison: the first 12 corners by the exact method, plus the best way to add the last two.
    const sub = D.slice(0, 12).map((row) => row.slice(0, 12));
    const exact12 = cost(matchOdd(sub).map(([i, j]) => [i, j]));
    assert.ok(cost(greedy) <= exact12 + D[12][13] + 1e-9 || cost(greedy) / (exact12 + D[12][13]) < 1.25);
    worst = Math.min(worst, (exact12 + D[12][13]) / cost(greedy));
  }
  t.diagnostic(`greedy pairing of 14 corners vs (exact 12 + last pair): worst ratio ${worst.toFixed(3)} (below 1 means greedy was longer)`);
  // And the exact method really is exact on 6 corners: compare with listing every pairing.
  const pts = Array.from({ length: 6 }, () => [random() * 100, random() * 100]);
  const D = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
  const all = (free) => {
    if (free.length === 0) return 0;
    const [first, ...rest] = free;
    return Math.min(...rest.map((j) => D[first][j] + all(rest.filter((k) => k !== j))));
  };
  assert.ok(near(matchOdd(D).reduce((sum, [i, j]) => sum + D[i][j], 0), all([0, 1, 2, 3, 4, 5]), 1e-9));
});

test('orienteering: stays inside its time budget and is close to brute force on a small street grid', (t) => {
  // 4 × 4 corners, 24 streets of 100 m. Budget: 800 m of walking from a corner.
  const pairs = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (c < 3) pairs.push([r * 4 + c, r * 4 + c + 1]);
    if (r < 3) pairs.push([r * 4 + c, (r + 1) * 4 + c]);
  }
  const world = graphWorld(4, 4, pairs);
  const lg = localGraph(world, pairs.map((_, i) => i));
  const budgetM = 800;
  let worst = 1; let sum = 0; const rounds = 30;
  for (let round = 0; round < rounds; round++) {
    const random = makeRandom(500 + round);
    const prize = Float64Array.from(pairs, () => (random() < 0.5 ? random() : 0.02 * random()));
    const start = Math.floor(random() * 16);
    const run = shortestFrom(world, start, FOOT);
    const found = orienteer(world, lg, prize, run, { budgetM, travelFactor: 1, offsetM: 0 });
    assert.ok(found.travelM + found.searchM <= budgetM + 1e-6, 'inside the budget');
    found.edges.forEach((e, i) => assert.ok([world.g.ea[e], world.g.eb[e]].includes(found.nodes[i]) && [world.g.ea[e], world.g.eb[e]].includes(found.nodes[i + 1])));
    const mine = [...new Set(found.edges)].reduce((s, e) => s + prize[e], 0);
    // Brute force: every walk of up to 8 streets from the start.
    let best = 0;
    const walk = (at, left, mask, got) => {
      if (got > best) best = got;
      if (left === 0) return;
      for (let e = 0; e < pairs.length; e++) {
        if (pairs[e][0] !== at && pairs[e][1] !== at) continue;
        const bit = 1 << e;
        walk(pairs[e][0] === at ? pairs[e][1] : pairs[e][0], left - 1, mask | bit, got + (mask & bit ? 0 : prize[e]));
      }
    };
    walk(start, 8, 0, 0);
    assert.ok(mine <= best + 1e-9);
    worst = Math.min(worst, mine / best); sum += mine / best;
  }
  t.diagnostic(`orienteering vs brute force over ${rounds} grids: mean ${(sum / rounds).toFixed(3)}, worst ${worst.toFixed(3)} of the best possible prize`);
  // A tiny square grid is this method's worst case: it chooses and orders targets by straight
  // lines, and here every walk is around corners. On real Fremont streets it collects a median
  // 97% of what a slow reference method does (docs/PLANNER.md). The floors below only catch a
  // regression; the measured numbers are in the diagnostic line.
  assert.ok(sum / rounds > 0.7, `mean ${sum / rounds}`);
  assert.ok(worst > 0.4, `worst ${worst}`);
});

// ---- The real map: safety rules, stability, determinism, speed ------------------------------------------

const osm = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-area.json', import.meta.url)));
const area = prepareArea(osm);
const CASES = [
  { lastSeen: { lat: 37.5405, lng: -121.9795 }, minutes: 60, direction: null, mobility: 'normal', familiarPlaces: [], seed: 20261121 },
  { lastSeen: { lat: 37.5530, lng: -121.9700 }, minutes: 120, direction: 'S', mobility: 'normal', familiarPlaces: [], seed: 7 },
];
const predictions = CASES.map((c) => replay(area, c, []));
function people(caseInput, count, seed, cars = 1) {
  const random = makeRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `s${String(i).padStart(2, '0')}`, mode: i >= count - cars ? 'car' : 'foot', at: NOON,
    lat: caseInput.lastSeen.lat + (random() - 0.5) * 0.012, lng: caseInput.lastSeen.lng + (random() - 0.5) * 0.015,
  }));
}
const planReal = (k, searchers, events = [], nowMs = NOON, params) => planner.planSearch(area, CASES[k], predictions[k], { searchers, events, nowMs, params });
const acceptAll = (plan, nowMs, tag = 'e') => plan.searchers.filter((s) => s.primary && !s.keep)
  .map((s, i) => ({ id: `${tag}${i}`, ...assignedEvent(s.primary, s.searcherId, nowMs) }));

test('adapter: ground classes match the engine, the 10 m map keeps the total, hazard scores sit on water only', () => {
  assert.deepEqual(G, C);
  const { world, segs } = planner.plannerWorld(area, CASES[0]);
  const map = planner.plannerMap(world, predictions[0]);
  let sum = 0;
  for (const v of map.p) sum += v;
  assert.ok(near(sum + map.restOfWorld, 1, 1e-9), `10 m map + rest of world = ${sum + map.restOfWorld}`);
  let onWater = 0;
  for (let i = 0; i < map.hazard.length; i++) {
    if (map.hazard[i] > 0) { assert.ok(world.hazardCell[i], 'hazard score only on water, creek or wetland'); onWater += 1; }
  }
  assert.ok(onWater > 100);
  assert.ok(segs.areas.length > 500 && segs.hazards.length > 20 && segs.posts.length > 20);
  for (const task of segs.areas) if (task.type === 'yards') assert.ok(task.baseMin <= DEFAULTS.TASK_MAX_MIN + 1e-9 || task.cells.length < 2 * DEFAULTS.MIN_SEGMENT_CELLS, `${task.id}: ${task.baseMin} min`);
});

test('safety rules on the real map: no water, yards, buildings, rail or driveways; pairs for hazards; cars on roads', (t) => {
  let routes = 0; let hazardPairs = 0; let railCrossings = 0; let crossings = 0;
  const seenTypes = new Set();
  for (const k of [0, 1]) {
    const { world, segs } = planner.plannerWorld(area, CASES[k]);
    const { g } = world;
    for (const [count, seed, nowMs] of [[10, 1, NOON], [6, 2, LATE], [3, 3, NOON], [1, 4, NOON], [10, 5, NOON + 3600000]]) {
      const searchers = people(CASES[k], count, seed * 13 + k, count >= 6 ? 2 : 0);
      const plan = planReal(k, searchers, [], nowMs);
      assert.equal(plan.night, nowMs === LATE);
      for (const s of plan.searchers) {
        for (const option of s.options) {
          routes += 1; seenTypes.add(option.type);
          const task = segs.tasks.get(option.taskId);
          // Every square of the route is a road, path or public service way: never water, a yard,
          // a building or a fence.
          for (const cell of option.route.track) {
            const v = world.cls[cell];
            assert.ok(v === G.ROAD || v === G.PATH || v === G.SERVICE, `${option.taskId}: route square of class ${v}`);
            if (world.special[cell]) { assert.ok(option.danger.warnings.includes('rail_crossing'), 'a rail crossing is always flagged'); }
          }
          for (let i = 1; i < option.route.track.length; i++) {
            const a = option.route.track[i - 1]; const b = option.route.track[i];
            assert.ok(Math.abs((a % world.n) - (b % world.n)) <= 1 && Math.abs(Math.floor(a / world.n) - Math.floor(b / world.n)) <= 1, 'the route is one continuous line');
          }
          if (option.danger.warnings.includes('rail_crossing')) railCrossings += 1;
          if (option.danger.warnings.includes('high_traffic_crossing')) crossings += 1;
          assert.ok(option.danger.level >= 0 && option.danger.level <= 3);
          assert.ok(Number.isFinite(option.posGain) && option.posGain >= 0 && option.posGain <= 1);
          assert.ok(option.travelMin >= 0 && option.searchMin > 0);
          if (s.mode === 'car') assert.ok(option.type === 'drive' || option.type === 'containment', `a car got ${option.type}`);
          if (option.type === 'drive') assert.equal(s.mode, 'car');
          if (option.type === 'park') for (const c of task.cells) assert.ok([G.PARK, G.GRASS, G.WOODS, G.BRUSH, G.PATH].includes(world.cls[c]));
          if (option.type === 'hazard_check') {
            assert.equal(option.danger.level, 3);
            assert.ok(option.needsPair && option.danger.warnings.includes('do_not_enter_water'));
          }
          assert.equal(option.permission === 'ask', option.type === 'yards' && option.canvass, 'private ground is only credited with the ask-permission task');
          if (plan.night) assert.ok(option.danger.warnings.includes('night') && option.danger.level >= 1);
        }
        if (s.primary && s.primary.type === 'hazard_check') {
          hazardPairs += 1;
          const mate = plan.searchers.find((o) => o.searcherId === s.primary.partnerId);
          assert.ok(mate && mate.primary.taskId === s.primary.taskId && mate.primary.partnerId === s.searcherId, 'hazard tasks go to pairs');
          assert.ok(count >= 2);
        }
      }
    }
    // The street graph itself: no private driveway is walkable, and cars only get drivable roads.
    for (let e = 0; e < g.E; e++) if (g.eflags[e] & PRIVATE) assert.equal(g.eflags[e] & FOOT, 0);
    for (const task of segs.drive) for (const e of task.edges) assert.ok(g.eflags[e] & CAR);
    for (const task of [...segs.areas, ...segs.hazards, ...segs.hasty]) for (const e of task.edges) assert.ok(g.eflags[e] & FOOT);
  }
  t.diagnostic(`${routes} routes checked; types seen: ${[...seenTypes].sort().join(', ')}; ${hazardPairs / 2} hazard pairs; ${crossings} routes with a high-traffic crossing, ${railCrossings} with a rail crossing`);
  assert.ok(hazardPairs > 0, 'the hazard-first rule sent at least one pair');
  for (const type of ['yards', 'containment', 'drive', 'hazard_check', 'hasty']) assert.ok(seenTypes.has(type), `${type} appeared`);
});

test('a lone searcher is never sent to water; the unchecked hazard is reported instead', () => {
  const plan = planReal(0, people(CASES[0], 1, 99, 0));
  assert.notEqual(plan.searchers[0].primary.type, 'hazard_check');
  assert.ok(plan.unfilled.some((u) => u.reason === 'needs_partner'));
  assert.ok(plan.measures.expand.reasons.includes('hazard_unchecked'));
});

test('no pile-up on the real map: nobody knocks on the same doors or stands on the same post; sharing is rare', (t) => {
  let shared = 0; let people10 = 0;
  for (const k of [0, 1]) {
    for (const seed of [21, 22, 23]) {
      const plan = planReal(k, people(CASES[k], 10, seed + k));
      const teams = new Map(); // taskId → the searchers (or pairs) given it
      for (const s of plan.searchers) {
        if (!s.primary) continue;
        people10 += 1;
        const team = s.primary.partnerId ? [s.searcherId, s.primary.partnerId].sort().join('+') : s.searcherId;
        if (!teams.has(s.primary.taskId)) teams.set(s.primary.taskId, new Map());
        teams.get(s.primary.taskId).set(team, s.primary);
      }
      for (const [taskId, byTeam] of teams) {
        const options = [...byTeam.values()];
        assert.ok(options.filter((o) => o.canvass).length <= 1, `${taskId}: doors knocked by one searcher only`);
        if (options[0].type === 'containment' || options[0].type === 'hazard_check') assert.equal(byTeam.size, 1, `${taskId} went to ${[...byTeam.keys()].join(' and ')}`);
        shared += byTeam.size - 1;
      }
    }
  }
  t.diagnostic(`${people10} assignments over 6 plans; ${shared} of them share a task with someone else (a walk past a block being canvassed, or the same hasty wedge by another route)`);
  assert.ok(shared <= people10 * 0.2, 'at most 1 in 5 share');
});

test('stability: everyone keeps their task after a small change; a far better task does prompt a switch', () => {
  const searchers = people(CASES[0], 8, 5);
  const first = planReal(0, searchers);
  const events = acceptAll(first, NOON);
  // Two minutes later: everyone has moved about 20 m, nothing else has changed.
  const moved = searchers.map((s, i) => ({ ...s, lat: s.lat + (i % 2 ? 0.00018 : -0.00018), at: NOON + 120000 }));
  const second = planReal(0, moved, events, NOON + 120000);
  for (const s of second.searchers) {
    const before = first.searchers.find((o) => o.searcherId === s.searcherId);
    if (!before.primary) continue;
    assert.ok(s.keep && !s.switchSuggested, `${s.searcherId} keeps their task`);
    assert.equal(s.primary.taskId, before.primary.taskId);
  }
  // On the tiny town: Ana holds a lukewarm block, then the map changes so another is 50× likelier.
  const town = tinyTown(ONLY_BLOCKS);
  const ana = [{ id: 'ana', ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 }];
  const calm = randomMap(town, 2, 1, [1, 1, 1, 1]);
  const held = planOnWorld(town.world, town.segs, { p: calm, restOfWorld: 0, searchers: ana, events: [], clock: clock() }, ONLY_BLOCKS).searchers[0].primary;
  const ev = [{ id: 'e', ...assignedEvent(held, 'ana', NOON) }];
  const same = planOnWorld(town.world, town.segs, { p: calm, restOfWorld: 0, searchers: ana, events: ev, clock: clock(NOON + 60000) }, ONLY_BLOCKS).searchers[0];
  assert.ok(same.keep);
  const tilt = town.segs.areas.map((task) => (task.id === held.taskId ? 1 : 50));
  const changed = planOnWorld(town.world, town.segs, { p: randomMap(town, 2, 1, tilt), restOfWorld: 0, searchers: ana, events: ev, clock: clock(NOON + 60000) }, ONLY_BLOCKS).searchers[0];
  assert.ok(changed.switchSuggested && !changed.keep);
  assert.notEqual(changed.primary.taskId, held.taskId);
});

test('determinism: same inputs give the same plan, whatever order searchers and events arrive in', () => {
  const searchers = people(CASES[1], 7, 8);
  const first = planReal(1, searchers);
  assert.deepEqual(JSON.parse(JSON.stringify(planReal(1, searchers))), JSON.parse(JSON.stringify(first)));
  const events = acceptAll(first, NOON).concat([{ id: 'zz', type: 'completed', searcherId: first.searchers[0].searcherId, taskId: first.searchers[0].primary.taskId, at: NOON + 1800000 }]);
  const a = planReal(1, searchers, events, NOON + 1900000);
  const b = planReal(1, [...searchers].reverse(), [...events].reverse(), NOON + 1900000);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  assert.ok(a.measures.cumulativePOS > 0);
  // The planner changes nothing it is given.
  const frozen = JSON.stringify(events);
  const pBefore = Float64Array.from(predictions[1].grid.p);
  planReal(1, searchers, events, NOON + 1900000);
  assert.equal(JSON.stringify(events), frozen);
  assert.deepEqual(predictions[1].grid.p, pBefore);
});

test('works in a Web Worker: the plan can be posted (structured clone), and the planner reads no clock, dice or page', () => {
  const plan = planReal(0, people(CASES[0], 4, 3));
  assert.deepEqual(structuredClone(plan), plan);
  for (const file of fs.readdirSync(new URL('../engine/planner/', import.meta.url))) {
    const code = fs.readFileSync(new URL(`../engine/planner/${file}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.now|new Date\(|\bdocument\b|\bwindow\b|localStorage/.test(code), `${file} must stay pure`);
  }
});

test('sums on the real map: the team\'s gains add up to the cumulative POS once everything is completed', () => {
  const searchers = people(CASES[0], 10, 12);
  const plan = planReal(0, searchers);
  const accepted = acceptAll(plan, NOON);
  // Completed one millisecond after being accepted (an event's "completed" always follows its "assigned").
  const done = plan.searchers.filter((s) => s.primary).map((s, i) => ({ id: `d${i}`, type: 'completed', searcherId: s.searcherId, taskId: s.primary.taskId, at: NOON + 1, ...(s.primary.partnerId ? { partnerId: s.primary.partnerId } : {}) }));
  const after = planReal(0, searchers, [...accepted, ...done], NOON + 1);
  const seen = new Set();
  let total = 0;
  for (const s of plan.searchers) {
    if (!s.primary) continue;
    const key = s.primary.partnerId ? [s.searcherId, s.primary.partnerId].sort().join('+') : s.searcherId;
    if (!seen.has(key)) { seen.add(key); total += s.primary.posGain; }
  }
  assert.ok(near(after.measures.cumulativePOS, total, 1e-6), `cumulative POS ${after.measures.cumulativePOS} vs sum of gains ${total}`);
  assert.ok(total > 0.05 && total < 0.95);
});

// ---- Decisions of Nov 22 (Nathan): GPS trails, buildings, the found event, the Web Worker ----------------

test('GPS trail: a completed event carrying the trail walked is scored from that trail, through the adapter', () => {
  const { world } = planner.plannerWorld(area, CASES[0]);
  const map = planner.plannerMap(world, predictions[0]);
  const searchers = people(CASES[0], 1, 41, 0);
  const plan = planReal(0, searchers, [], NOON, { HAZARD_FIRST: false });
  const hasty = plan.searchers[0].options.find((o) => o.type === 'hasty');
  assert.ok(hasty, 'a hasty option is offered');
  const searchPoints = hasty.route.points.slice(hasty.route.searchFrom);
  // The phone's trail: the planned search points, as lat/lng. It becomes the same squares as the plan's track.
  const fullTrail = planner.trackFromLatLngs(area, CASES[0], searchPoints);
  assert.deepEqual(fullTrail, Array.from(hasty.route.track));
  for (let i = 1; i < fullTrail.length; i++) {
    assert.ok(Math.abs((fullTrail[i] % world.n) - (fullTrail[i - 1] % world.n)) <= 1 && Math.abs(Math.floor(fullTrail[i] / world.n) - Math.floor(fullTrail[i - 1] / world.n)) <= 1, 'a trail is one continuous line of squares');
  }
  // The searcher only walked the first third. With no trail the whole planned route is credited;
  // with the trail only what was walked is.
  const partTrail = planner.trackFromLatLngs(area, CASES[0], searchPoints.slice(0, Math.max(2, Math.ceil(searchPoints.length / 3))));
  const accepted = { id: 'a1', ...assignedEvent(hasty, searchers[0].id, NOON) };
  const pos = (completed) => planReal(0, [], [accepted, { id: 'c1', type: 'completed', searcherId: searchers[0].id, taskId: hasty.taskId, at: NOON + 1, ...completed }], NOON + 1).measures.cumulativePOS;
  const planned = pos({});
  const walked = pos({ track: partTrail });
  assert.ok(near(planned, hasty.posGainAlone, 1e-6), 'no trail: the planned route is credited');
  assert.ok(walked > 0 && walked < planned, `trail of a third of the route: ${walked} < ${planned}`);
  const direct = gainOn(map.p, trackCoverage(world, partTrail, 'hasty', false)) / (1 - 0); // scored by hand
  assert.ok(near(walked, direct, 1e-6), `the trail's POS ${walked} equals a direct calculation ${direct}`);
});

test('buildings: probability inside a building is credited only by the ask-permission task, also on a 10 m map', () => {
  const { world, segs } = planner.plannerWorld(area, CASES[0]);
  // 1. No look from outside ever credits a building square: any track, any pace, day or night,
  //    and not the watcher at a containment point either.
  const block = segs.areas.filter((t) => t.type === 'yards' && t.edges.length && t.doors >= 10)
    .sort((a, b) => Math.hypot(a.x - world.lastSeen.x, a.y - world.lastSeen.y) - Math.hypot(b.x - world.lastSeen.x, b.y - world.lastSeen.y))[0];
  const tour = postmanTour(world, block);
  const track = trackOfEdges(world, tour.edges, tour.nodes[0]);
  for (const pace of ['search', 'hasty', 'drive']) {
    for (const night of [false, true]) {
      const cov = trackCoverage(world, track, pace, night);
      assert.ok(cov.cells.length > 50);
      for (const c of cov.cells) assert.notEqual(world.vis[c], V.BUILDING, `${pace}: a building square was credited from the street`);
    }
  }
  for (const post of segs.posts.slice(0, 20)) for (const c of postCoverage(world, post, false, 60).cells) assert.notEqual(world.vis[c], V.BUILDING);
  const knock = canvassCoverage(world, block, false);
  const inside = Array.from(knock.cells).filter((c) => world.vis[c] === V.BUILDING);
  assert.ok(inside.length >= 10, 'door-knocking is what reaches the buildings');

  // 2. A 10 m map straight from the engine (640 × 640 squares, what the prior will give): put
  //    ALL the probability inside the buildings of that block.
  const p10 = new Float64Array(world.n * world.n);
  for (const c of inside) p10[c] = 1 / inside.length;
  const prediction10 = { grid: { p: p10, cols: world.n, rows: world.n, cellSize: world.cellM }, restOfWorld: 0 };
  assert.deepEqual(planner.plannerMap(world, prediction10).p, p10, 'a 10 m map is passed through untouched');
  const at = planner.plannerWorld(area, CASES[0]).world;
  const here = { lat: CASES[0].lastSeen.lat, lng: CASES[0].lastSeen.lng };
  const searchers = [{ id: 'a', mode: 'foot', at: NOON, ...here }, { id: 'b', mode: 'foot', at: NOON, ...here }, { id: 'car', mode: 'car', at: NOON, ...here }];
  const plan = planner.planSearch(area, CASES[0], prediction10, { searchers, events: [], nowMs: NOON });
  let knocking = 0;
  for (const s of plan.searchers) {
    for (const option of s.options) {
      if (option.posGain > 1e-12) {
        assert.ok(option.type === 'yards' && option.canvass && option.permission === 'ask', `${option.type} claims ${option.posGain} of probability that is all inside buildings`);
        knocking += 1;
      }
    }
  }
  assert.ok(knocking >= 1);
  const canvasser = plan.searchers.find((s) => s.primary && s.primary.canvass);
  assert.equal(canvasser.primary.taskId, block.id);
  assert.ok(near(canvasser.primary.posGain, DEFAULTS.POD_CANVASS_BUILDING, 1e-6), 'its gain is the door-knock value, nothing more');
  // Walking, driving or standing guard there and finding nobody says nothing about the buildings.
  const outside = [
    { id: 'w', type: 'completed', searcherId: 'a', taskId: 'hasty:N', at: NOON + 1, track },
    { id: 'd', type: 'completed', searcherId: 'car', taskId: 'drive:NE', at: NOON + 2, track },
    { id: 'y', type: 'completed', searcherId: 'b', taskId: block.id, at: NOON + 3, track, canvass: false },
  ];
  assert.equal(planner.planSearch(area, CASES[0], prediction10, { searchers: [], events: outside, nowMs: NOON + 4 }).measures.cumulativePOS, 0);
  const knocked = [{ id: 'k', type: 'completed', searcherId: 'b', taskId: block.id, at: NOON + 3, track }];
  assert.ok(near(planner.planSearch(area, CASES[0], prediction10, { searchers: [], events: knocked, nowMs: NOON + 4 }).measures.cumulativePOS, DEFAULTS.POD_CANVASS_BUILDING, 1e-6));
  assert.equal(at, world);
});

test('found: the search is over, nobody is assigned anything, held tasks are released', () => {
  const searchers = people(CASES[0], 4, 51, 0);
  const first = planReal(0, searchers);
  const events = acceptAll(first, NOON);
  const found = { id: 'zz', type: 'found', lat: 37.5412, lng: -121.9781, by: 'Ana', at: NOON + 600000, note: 'at the bus stop, cold but fine' };
  const plan = planReal(0, searchers, [...events, found], NOON + 660000);
  assert.equal(plan.over, true);
  assert.deepEqual(plan.found, { lat: 37.5412, lng: -121.9781, by: 'Ana', at: NOON + 600000, note: 'at the bus stop, cold but fine' });
  for (const s of plan.searchers) {
    assert.equal(s.primary, null);
    assert.deepEqual(s.options, []);
    assert.equal(s.hold, 'found');
    const before = first.searchers.find((o) => o.searcherId === s.searcherId);
    assert.equal(s.released, before.primary ? before.primary.taskId : null, 'the task they held is released');
  }
  assert.equal(plan.measures.expand.signal, false);
  assert.equal(first.over, false);
  assert.equal(first.found, null);
  // Later events change nothing: it stays over.
  const later = planReal(0, searchers, [...events, found, { id: 'zzz', type: 'released', searcherId: searchers[0].id, taskId: 'x', at: NOON + 700000 }], NOON + 800000);
  assert.equal(later.over, true);
});

test('a searcher holding a task still sees hasty alternatives', () => {
  const town = tinyTown({ CONTAINMENT: false, PARK_CANDIDATES: 0, HAZARD_CANDIDATES: 0, HAZARD_FIRST: false, OPTIONS: 12 });
  const p = randomMap(town, 8);
  // Put some probability on the streets too, so a hasty walk has something to find.
  for (let i = 0; i < p.length; i++) if (town.world.cls[i] === G.ROAD) p[i] = 2e-4;
  const ana = [{ id: 'ana', ...town.corner(1, 1), mode: 'foot', updatedAgoMin: 0 }];
  const params = { CONTAINMENT: false, PARK_CANDIDATES: 0, HAZARD_CANDIDATES: 0, HAZARD_FIRST: false, OPTIONS: 12 };
  const free = planOnWorld(town.world, town.segs, { p, restOfWorld: 0, searchers: ana, events: [], clock: clock() }, params).searchers[0];
  const block = free.options.find((o) => o.type === 'yards');
  const held = planOnWorld(town.world, town.segs, { p, restOfWorld: 0, searchers: ana, events: [{ id: 'e', ...assignedEvent(block, 'ana', NOON) }], clock: clock(NOON + 60000) }, params).searchers[0];
  assert.ok(held.options.some((o) => o.type === 'hasty'), `options while holding: ${held.options.map((o) => o.type).join(', ')}`);
});

test('Web Worker: the planner runs in a real worker thread and gives the same plan; phone-budget times', async (t) => {
  const worker = new Worker(new URL('./helpers/planner-worker-node.js', import.meta.url));
  let nextId = 0;
  const waiting = new Map();
  worker.on('message', (m) => { const done = waiting.get(m.id); waiting.delete(m.id); done(m); });
  const ask = (message) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const t0 = performance.now();
    waiting.set(id, (m) => (m.ok ? resolve({ ...m, ms: performance.now() - t0 }) : reject(new Error(m.error))));
    worker.postMessage({ id, ...message });
  });
  try {
    const areaMs = (await ask({ type: 'area', key: 'k', osm })).ms;
    const searchers = people(CASES[0], 10, 31);
    const message = { type: 'plan', key: 'k', caseInput: CASES[0], events: [], searchers, nowMs: NOON };
    const first = await ask(message);          // engine replay + build the planner's world + first plan
    assert.equal(first.replayed, true);
    const { workMs: firstWork, ms: firstMs, plan: firstPlan } = first;
    assert.deepEqual(firstPlan, JSON.parse(JSON.stringify(structuredClone(planReal(0, searchers)))), 'same plan as on the page');
    const events = acceptAll(firstPlan, NOON);
    const done = events.concat([{ id: 'done', type: 'completed', searcherId: events[0].searcherId, taskId: events[0].taskId, at: NOON + 1500000 }]);
    const busy = []; const fresh = [];
    for (let i = 0; i < 25; i++) {
      const again = await ask({ ...message, events: done, nowMs: NOON + 1500000 + 1000 * i });
      assert.equal(again.replayed, false, 'the engine is not replayed for planner events');
      if (i >= 5) busy.push([again.workMs, again.ms]);
      const free = await ask({ ...message, nowMs: NOON + i });
      if (i >= 5) fresh.push([free.workMs, free.ms]);
    }
    const median = (xs, k) => xs.map((x) => x[k]).sort((a, b) => a - b)[xs.length >> 1];
    await assert.rejects(ask({ type: 'plan', key: 'other', caseInput: CASES[0], events: [], searchers, nowMs: NOON }), /unknown area/);
    t.diagnostic(`in the worker (work / with message copying): new area ${areaMs.toFixed(0)} ms; first plan of a case = engine replay + planner world + plan ${firstWork.toFixed(0)} / ${firstMs.toFixed(0)} ms; re-plan 1 free + 9 busy ${median(busy, 0).toFixed(0)} / ${median(busy, 1).toFixed(0)} ms; re-plan 10 free ${median(fresh, 0).toFixed(0)} / ${median(fresh, 1).toFixed(0)} ms`);
    t.diagnostic(`at 4x laptop slowdown, message copying included: first plan ${(4 * firstMs / 1000).toFixed(1)} s; re-plan ${(4 * median(busy, 1)).toFixed(0)} ms (1 free + 9 busy), ${(4 * median(fresh, 1)).toFixed(0)} ms (10 free); budget 300 ms per re-plan`);
    assert.ok(4 * median(busy, 1) < 300 && 4 * median(fresh, 1) < 300, 'a re-plan stays under 300 ms at 4× the laptop\'s time');
  } finally {
    await worker.terminate();
  }
});

test('fast enough: a re-plan with 10 searchers on the real map', (t) => {
  const searchers = people(CASES[0], 10, 31);
  const fresh = planReal(0, searchers); // builds routes for the first time
  const events = acceptAll(fresh, NOON);
  const time = (fn) => {
    const runs = [];
    for (let i = 0; i < 9; i++) { const t0 = performance.now(); fn(i); runs.push(performance.now() - t0); }
    return runs.sort((a, b) => a - b)[4];
  };
  const allFree = time(() => planReal(0, searchers));
  const allBusy = time((i) => planReal(0, searchers, events, NOON + 60000 * (i + 1)));
  // One searcher finishes and needs a new task while nine are busy: the usual re-plan.
  const oneDone = events.concat([{ id: 'done', type: 'completed', searcherId: events[0].searcherId, taskId: events[0].taskId, at: NOON + 1500000 }]);
  const usual = time((i) => planReal(0, searchers, oneDone, NOON + 1500000 + 1000 * i));
  t.diagnostic(`median of 9 runs: all 10 free ${allFree.toFixed(0)} ms; all 10 busy ${allBusy.toFixed(0)} ms; 1 free + 9 busy ${usual.toFixed(0)} ms (laptop; the phone budget is 300 ms)`);
  assert.ok(allFree < 300 && allBusy < 300 && usual < 300, 'under the phone budget even on the laptop');
});
