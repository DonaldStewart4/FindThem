// The engine host (engine/host.js) as the app's worker uses it: replay a case, then ask for
// the search plan. Checks the release wiring: the plan still works after the worker has
// handed the map's big arrays to the page, a taken route is not handed to someone else, and
// a 'found' event ends the search for everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHost } from '../engine/host.js';
import * as engine from '../engine/index.js';

const osm = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-area.json', import.meta.url), 'utf8'));
const NOW = 1795370000000;
const CASE = { lastSeen: { lat: 37.5405, lng: -121.9795 }, minutes: 45, direction: 'NE', mobility: 'slow', familiarPlaces: [], seed: 20261121, minutesAt: NOW };
const ANA = 'a'.repeat(16);
const BEN = 'b'.repeat(16);
const at = (id, lat, lng) => ({ id, lat, lng, at: NOW, mode: 'foot' });
const TEAM = [at(ANA, 37.5405, -121.9795), at(BEN, 37.5440, -121.9760)];

test('host.plan: needs a map first, survives the hand-over of the arrays, and gives ranked routes with warnings', () => {
  const host = createHost();
  host.setArea('demo', osm);
  assert.throws(() => host.plan('demo', CASE, [], TEAM, NOW), /run the engine first/);

  const out = host.run('demo', CASE, []);
  // What engine/worker.js does: the two big arrays are handed to the page, which empties them here.
  structuredClone(out.prediction.grid.p, { transfer: [out.prediction.grid.p.buffer] });
  structuredClone(out.prediction.grid.hazard, { transfer: [out.prediction.grid.hazard.buffer] });
  assert.equal(out.prediction.grid.p.length, 0, 'the page now owns the array');

  const plan = host.plan('demo', CASE, [], TEAM, NOW);
  assert.equal(plan.over, false);
  assert.equal(plan.searchers.length, 2);
  for (const s of plan.searchers) {
    assert.ok(s.options.length >= 1 && s.options.length <= 3, 'one to three options each');
    for (const o of s.options) {
      assert.ok(o.posGain > 0 && o.posGain <= 1);
      assert.ok(Array.isArray(o.danger.warnings));
      assert.ok(o.route.points.length >= 1);
      // The screen turns these codes into text: none may be a sentence.
      for (const code of o.danger.warnings) assert.match(code, /^[a-z_]+$/);
    }
    // Ranked: no later option beats the first one on chance per minute.
    for (const o of s.options.slice(1)) assert.ok(o.ratePerMin <= s.options[0].ratePerMin + 1e-12 || s.options[0].urgent);
  }
});

test('host.plan: a route one searcher took is not the other\'s first choice; "found" ends the search', () => {
  const host = createHost();
  host.setArea('demo', osm);
  host.run('demo', CASE, []);
  const first = host.plan('demo', CASE, [], TEAM, NOW);
  const ana = first.searchers.find((s) => s.searcherId === ANA);
  const mine = ana.options.find((o) => !o.needsPair) || ana.options[0];
  const taken = { ...engine.assignedEvent(mine, ANA, NOW + 1000), id: 'e1' };

  const second = host.plan('demo', CASE, [taken], TEAM, NOW + 2000);
  const anaNow = second.searchers.find((s) => s.searcherId === ANA);
  const benNow = second.searchers.find((s) => s.searcherId === BEN);
  if (!mine.needsPair) {
    assert.equal(anaNow.primary.taskId, mine.taskId, 'Ana keeps what she took');
    assert.equal(anaNow.keep, true);
    assert.notEqual(benNow.primary && benNow.primary.taskId, mine.taskId, 'Ben is sent somewhere else');
  }

  const found = { id: 'e2', type: 'found', lat: 37.541, lng: -121.979, by: 'Ben', at: NOW + 3000 };
  const over = host.plan('demo', CASE, [taken, found], TEAM, NOW + 4000);
  assert.equal(over.over, true);
  assert.equal(over.found.lat, 37.541);
  for (const s of over.searchers) assert.equal(s.options.length, 0, 'nobody is sent anywhere once the person is found');
});
