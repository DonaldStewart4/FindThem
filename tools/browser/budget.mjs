// Times a COLD engine replay inside Chrome with the CPU slowed down, and reports memory.
import { Tab, sleep } from './cdp.mjs';
const tab = await Tab.open(9333);
await tab.send('Network.enable'); await tab.send('Network.setBypassServiceWorker', { bypass: true });
await tab.go('http://localhost:8000/tools/browser/blank.html');
const run = (rate) => tab.eval(`(async () => {
  const engine = await import('/engine/index.js');
  const { sectorIdAt, gridOriginFor } = await import('/engine/grid.js');
  const osm = await (await fetch('/tests/fixtures/demo-area.json')).json();
  const T0 = 1700000000000;
  const out = [];
  const mem = () => (performance.memory ? performance.memory.usedJSHeapSize / 1e6 : NaN);
  const cases = [
    ['Demo case (1 familiar place, no events)', { lat: 37.5405, lng: -121.9795 }, 0, 0],
    ['new case, 7 searches + 3 sightings', { lat: 37.5461, lng: -121.9762 }, 7, 3],
    ['another new case, 7 searches + 3 sightings', { lat: 37.5381, lng: -121.9842 }, 7, 3],
  ];
  for (const [label, lastSeen, nSearch, nSight] of cases) {
    const area = engine.prepareArea(osm);                 // a fresh area: nothing cached
    const c = { lastSeen, minutes: 75, minutesAt: T0 + 75 * 60000, direction: 'NE', mobility: 'slow', seed: 7,
      familiarPlaces: [{ lat: 37.5485, lng: -121.963, label: 'Lake Elizabeth' }] };
    const origin = gridOriginFor(c);
    const events = [];
    for (let k = 0; k < nSearch; k++) events.push({ id: 's' + k, type: 'searched', sectorId: sectorIdAt(origin, lastSeen.lat + 0.002 * (k % 3 - 1), lastSeen.lng + 0.0025 * (k % 4 - 1)), minutes: 20, at: T0 + (30 + 5 * k) * 60000 });
    for (let k = 0; k < nSight; k++) events.push({ id: 'w' + k, type: 'sighting', lat: lastSeen.lat + 0.001 + 0.003 * k, lng: lastSeen.lng + 0.002 - 0.002 * k, direction: 'N', minutesSince: 10, reliability: 0.6, at: T0 + (40 + 10 * k) * 60000 });
    const m0 = mem();
    const t0 = performance.now();
    const pred = engine.replay(area, c, events);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    engine.topSpots(area, pred, 8);
    const spots = performance.now() - t1;
    const t2 = performance.now();
    engine.replay(area, { ...c, minutes: 80, minutesAt: T0 + 80 * 60000 }, events);
    const tick = performance.now() - t2;
    out.push(label.padEnd(44) + ' cold replay ' + cold.toFixed(0).padStart(5) + ' ms | topSpots ' + spots.toFixed(0).padStart(3) + ' ms | 5-min clock tick ' + tick.toFixed(0).padStart(4) + ' ms | JS heap +' + (mem() - m0).toFixed(1) + ' MB');
  }
  return out.join('\\n');
})()`);
for (const rate of [1, 4]) {
  await tab.send('Emulation.setCPUThrottlingRate', { rate });
  console.log(`--- Chrome, CPU slowed ${rate}x (engine on the page's main thread, so the slowdown applies to it) ---`);
  console.log(await run(rate));
  await tab.go('http://localhost:8000/tools/browser/blank.html'); // fresh page: nothing compiled or cached
}
await tab.send('Emulation.setCPUThrottlingRate', { rate: 1 });
console.log('errors:', tab.errors.length ? tab.errors : 'none');
process.exit(0);
