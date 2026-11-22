// bench/phone-budget.js — how much time and memory one search costs.
//
// Run:   node --expose-gc bench/phone-budget.js
//
// Time here is this laptop's, unslowed. For the phone target ("a cold replay under 2 s with the
// processor slowed four times") run tools/browser/budget.mjs, which measures inside Chrome
// with the slowdown switched on.
// Memory is counted two ways: the exact size of the engine's big arrays, and how much the
// whole process grew (which also includes the map data itself, the biggest item by far).

import fs from 'node:fs';
import * as engine from '../engine/index.js';
import { simulate, costToGoal } from '../engine/sim.js';
import { buildSurface, cellAt, snapToNetwork } from '../engine/surface.js';
import { gridOriginFor, sectorIdAt } from '../engine/grid.js';

const MB = (bytes) => (bytes / 1e6).toFixed(2).padStart(7) + ' MB';
const gc = () => { if (globalThis.gc) globalThis.gc(); };
const used = () => { gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };

const before = used();
const text = fs.readFileSync(new URL('../tests/fixtures/demo-area.json', import.meta.url), 'utf8');
const osm = JSON.parse(text);
const afterParse = used();
const area = engine.prepareArea(osm);
const afterPrepare = used();

console.log('== Memory ==');
console.log(`map data file                        ${MB(text.length)}   (the Demo's area: ${osm.ways.length} ways, ${osm.layers.buildings.length} buildings)`);
console.log(`map data once read into memory       ${MB(afterParse - before)}`);
console.log(`street network + trap lookup         ${MB(afterPrepare - afterParse)}`);

const CASE = { lastSeen: { lat: 37.5405, lng: -121.9795 }, minutes: 45, direction: 'NE', mobility: 'slow',
  familiarPlaces: [{ lat: 37.5485, lng: -121.963, label: 'Lake Elizabeth' }], seed: 20261121 };
const surface = buildSurface(osm, gridOriginFor(CASE));
const start = snapToNetwork(surface, cellAt(surface, CASE.lastSeen.lat, CASE.lastSeen.lng));
const mapBytes = surface.cls.byteLength + surface.exposure.byteLength + surface.nearBuilding.byteLength + surface.region.byteLength;
console.log(`ground map (640 x 640, 4 layers)     ${MB(mapBytes)}`);
const goal = snapToNetwork(surface, cellAt(surface, 37.5485, -121.963));
console.log(`one familiar place's cost field      ${MB(costToGoal(surface, goal, start).byteLength)}`);
const walkBytes = (w) => w.pos.byteLength + w.seen.byteLength + w.leftMin.byteLength + w.endCell.byteLength + w.reason.byteLength
  + w.stopMin.byteLength + w.kind.byteLength + w.follower.byteLength + w.speed.byteLength + w.mobileMin.byteLength + w.course.byteLength + w.cell100.byteLength + w.visits.byteLength;
for (const minutes of [45, 120, 720]) {
  const w = simulate(surface, { startCell: start, minutes: Math.ceil(minutes / 30) * 30, seed: 1 });
  console.log(`5,000 walkers, case at ${String(minutes).padStart(3)} min       ${MB(walkBytes(w))}   (${w.T + 1} minutes x 5,000 x 4 bytes = ${MB((w.T + 1) * 5000 * 4).trim()}, plus per-walker facts and the street-use counts)`);
}
const s = simulate(surface, { startCell: start, minutes: 60, seed: 1, n: 2500 });
console.log(`2,500 walkers per sighting (60 min)  ${MB(walkBytes(s))}`);
console.log(`the result sent to the page          ${MB(8 * 65536 + 4 * 65536 + 65536)}   (probability map, hazard layer, hazard types) + 1,024 sector records`);

console.log('\n== Whole process, a cold replay ==');
const T0 = 1_700_000_000_000;
for (const [label, lastSeen, nSearch, nSight, minutes] of [
  ['Demo case, no events', CASE.lastSeen, 0, 0, 45],
  ['new case at 75 min, 7 searches + 3 sightings', { lat: 37.5461, lng: -121.9762 }, 7, 3, 75],
  ['new case at 12 h, 7 searches + 3 sightings', { lat: 37.5381, lng: -121.9842 }, 7, 3, 720],
]) {
  const fresh = engine.prepareArea(osm);
  const c = { ...CASE, lastSeen, minutes, minutesAt: T0 + minutes * 60000, seed: 5 };
  const origin = gridOriginFor(c);
  const events = [];
  for (let k = 0; k < nSearch; k++) events.push({ id: 's' + k, type: 'searched', sectorId: sectorIdAt(origin, lastSeen.lat + 0.002 * (k % 3 - 1), lastSeen.lng + 0.0025 * (k % 4 - 1)), minutes: 20, at: T0 + (30 + 5 * k) * 60000 });
  for (let k = 0; k < nSight; k++) events.push({ id: 'w' + k, type: 'sighting', lat: lastSeen.lat + 0.001 + 0.003 * k, lng: lastSeen.lng + 0.002 - 0.002 * k, direction: 'N', minutesSince: 10, reliability: 0.6, at: T0 + (40 + 10 * k) * 60000 });
  const m0 = used();
  const t0 = performance.now();
  const pred = engine.replay(fresh, c, events);
  const ms = performance.now() - t0;
  const grew = used() - m0;
  const t1 = performance.now();
  engine.replay(fresh, { ...c, minutes: minutes + 5, minutesAt: T0 + (minutes + 5) * 60000 }, events);
  const tick = performance.now() - t1;
  console.log(`${label.padEnd(46)} ${ms.toFixed(0).padStart(4)} ms cold | ${tick.toFixed(0).padStart(3)} ms clock tick | memory kept ${MB(grew).trim()} | total ${(pred.grid.p.reduce((a, b) => a + b, 0) + pred.restOfWorld).toFixed(9)}`);
}
console.log(`\nwhole process now: ${MB(process.memoryUsage().rss).trim()} resident`);
