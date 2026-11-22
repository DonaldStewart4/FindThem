// Smoke test for the planner benchmark (bench/planner-eval.js): a tiny run must finish, make
// sense and be repeatable. The full run is `npm run planner-eval` (a few minutes).
// Written with Claude Code for Nathan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEval, summarize, reportMarkdown, CHECKPOINTS, HORIZON_MIN } from '../bench/planner-eval.js';

const strategies = ['ring', 'old', 'planner', 'planner-no-hazard-first'];
const run = runEval({ setups: 1, peoplePerSetup: 60, strategies });

test('planner benchmark: one small setup runs every strategy on the same people', () => {
  assert.equal(run.results.length, 1);
  const result = run.results[0];
  assert.equal(result.people.length, 60);
  for (const s of strategies) {
    assert.equal(result.times[s].length, 60);
    for (const t of result.times[s]) assert.ok(t === Infinity || (t >= 0 && t <= HORIZON_MIN));
    assert.ok(result.notes[s].jobs > 5, `${s} gave out tasks`);
  }
  // People bound for somewhere off the map exist, and nobody who has left it is found there.
  assert.ok(result.people.some((p) => p.offMap));
  assert.ok(result.people.some((p) => p.moving) && result.people.some((p) => !p.moving));
  assert.ok(Object.keys(result.notes.planner.types).length >= 2, 'the planner used more than one kind of task');
  assert.deepEqual(Object.keys(result.notes.ring.types), ['area']);
});

test('planner benchmark: shares never go down over time, and the intervals bracket the values', () => {
  const { stats, versus } = summarize(run, { boots: 200 });
  for (const s of strategies) {
    assert.equal(stats[s].share.length, CHECKPOINTS.length);
    stats[s].share.forEach((x, k) => {
      assert.ok(x.value >= 0 && x.value <= 1);
      if (k > 0) assert.ok(x.value >= stats[s].share[k - 1].value, 'more time can only find more');
      assert.ok(x.ci[0] <= x.value + 1e-9 && x.ci[1] >= x.value - 1e-9);
    });
    assert.ok(stats[s].meanMin.value > 0 && stats[s].meanMin.value <= HORIZON_MIN);
  }
  const same = versus('planner', 'planner');
  assert.equal(same.meanMin.value, 0);
  assert.deepEqual(same.meanMin.ci, [0, 0], 'a strategy against itself differs by exactly nothing in every resample');
  const md = reportMarkdown(run);
  assert.match(md, /Everything here is simulated/);
  assert.match(md, /hazard-first rule/);
});

test('planner benchmark: the same run gives the same numbers (seeded)', () => {
  const again = runEval({ setups: 1, peoplePerSetup: 60, strategies: ['ring', 'planner'] });
  assert.deepEqual(again.results[0].times.planner, run.results[0].times.planner);
  assert.deepEqual(again.results[0].times.ring, run.results[0].times.ring);
});
