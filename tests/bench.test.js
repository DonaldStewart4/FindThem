// Smoke test for the benchmark (bench/benchmark.js): a tiny run must finish and make sense.
// The full run is `node bench/benchmark.js` (about a minute). Written with Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark, resultsTable, CHECKPOINTS } from '../bench/benchmark.js';

test('benchmark: a tiny run gives shares between 0 and 1 that never go down over time', () => {
  const result = runBenchmark({ casesPerSetup: 2 });
  assert.equal(result.cases, 20);
  for (const shares of Object.values(result.share)) {
    assert.equal(shares.length, CHECKPOINTS.length);
    shares.forEach((p, i) => {
      assert.ok(p >= 0 && p <= 1);
      if (i > 0) assert.ok(p >= shares[i - 1], 'more searching can only find more');
    });
  }
  assert.match(resultsTable(result), /FindThem allocation/);
});

test('benchmark: the same run gives the same numbers (seeded)', () => {
  assert.deepEqual(runBenchmark({ casesPerSetup: 1 }).found, runBenchmark({ casesPerSetup: 1 }).found);
});
