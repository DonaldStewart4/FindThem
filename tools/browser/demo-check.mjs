import { Tab, sleep } from './cdp.mjs';
const PORT = 9333;
const throttle = Number(process.argv[2] || 1);
const tab = await Tab.open(PORT);
await tab.send('Network.enable');
await tab.send('Network.setCacheDisabled', { cacheDisabled: true });
// No service worker, so every run is a genuinely fresh load.
await tab.send('Network.setBypassServiceWorker', { bypass: true });
await tab.go('http://localhost:8000/?db=http://localhost:9000');
await tab.waitFor('!!document.getElementById("demo")');
await sleep(800);
if (throttle > 1) await tab.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const before = await tab.send('Performance.getMetrics').catch(() => null);
const t0 = Date.now();
await tab.eval('document.getElementById("demo").click()');
const ms = await tab.waitFor('document.querySelectorAll("#spots li").length > 0', 120000, 'Demo results');
const info = await tab.eval(`(() => ({
  spots: [...document.querySelectorAll('#spots li')].slice(0, 4).map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 90)),
  areas: [...document.querySelectorAll('#areas li')].map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 70)),
  status: document.getElementById('status').textContent.trim(),
  legendShown: !document.getElementById('legend').hidden,
  heat: !!document.querySelector('.leaflet-likely-pane img, .leaflet-pane img.leaflet-image-layer'),
  minutes: document.getElementById('minutes').value,
}))()`);
console.log(`Demo, CPU slowed ${throttle}x: results on screen ${ms} ms after the tap`);
console.log(JSON.stringify(info, null, 1));
await tab.send('Emulation.setCPUThrottlingRate', { rate: 1 });
console.log('page errors:', tab.errors.length ? tab.errors : 'none');
console.log('console warnings/errors:', tab.console.filter((l) => /^(warning|error)/.test(l)).slice(0, 8));
process.exit(0);
