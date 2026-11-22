// A brand-new area: a live Overpass download in two phases. The map must appear from the
// streets alone, then sharpen when the buildings arrive.
import { Tab, sleep } from './cdp.mjs';
const tab = await Tab.open(9333);
await tab.send('Network.enable'); await tab.send('Network.setBypassServiceWorker', { bypass: true });
const requests = [];
const orig = tab.ws.onmessage;
tab.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent' && /interpreter/.test(m.params.request.url)) requests.push({ at: Date.now(), url: m.params.request.url, kind: /building/.test(m.params.request.postData || '') ? 'layers' : 'streets' }); orig(e); };
await tab.go('http://localhost:8000/?db=http://localhost:9000');
await tab.waitFor('!!document.getElementById("demo")'); await sleep(1500);
// Tap the middle of the map: that sets the last-seen point (the map opens on central Fremont).
const box = await tab.eval('(() => { const r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
for (const type of ['mousePressed', 'mouseReleased']) await tab.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
await sleep(800);
await tab.eval('(() => { const m = document.getElementById("minutes"); m.value = "40"; m.dispatchEvent(new Event("input", { bubbles: true })); m.dispatchEvent(new Event("change", { bubbles: true })); })()');
const t0 = Date.now();
await tab.eval('document.getElementById("run").click()');
console.log('tapped the map and pressed Find; waiting for the first map (streets only)...');
const first = await tab.waitFor('document.querySelectorAll("#spots li").length > 0', 420000, 'first map');
const status1 = await tab.eval('document.getElementById("status").textContent.trim()');
const spots1 = await tab.eval(`[...document.querySelectorAll('#spots li')].slice(0,3).map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80)).join(' | ')`);
console.log(`FIRST MAP after ${(first / 1000).toFixed(1)} s. Status: "${status1}"`);
console.log('  spots:', spots1);
console.log('waiting for the buildings (second download)...');
let refined = null;
try {
  await tab.waitFor('/sharpened|afinado|affinée/.test(document.getElementById("status").textContent)', 420000, 'refined map');
  refined = Date.now() - t0;
} catch (err) { console.log('  ' + err.message); }
if (refined) {
  const spots2 = await tab.eval(`[...document.querySelectorAll('#spots li')].slice(0,3).map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80)).join(' | ')`);
  console.log(`REFINED MAP after ${(refined / 1000).toFixed(1)} s. Status: "${await tab.eval('document.getElementById("status").textContent.trim()')}"`);
  console.log('  spots:', spots2);
}
console.log('Overpass requests:', requests.map((r) => `${r.kind} +${((r.at - t0) / 1000).toFixed(1)}s ${new URL(r.url).hostname}`).join(', '));
const saved = await tab.eval(`new Promise((ok) => { const q = indexedDB.open('findthem', 1); q.onsuccess = () => { const g = q.result.transaction('areas').objectStore('areas').getAll(); g.onsuccess = () => ok(g.result.map((a) => ({ center: a.osm.center, half: a.osm.radiusM, bounds: !!a.osm.bounds, buildings: a.osm.layers ? a.osm.layers.buildings.length : 0, ways: a.osm.ways.length }))); }; })`);
console.log('saved on the "phone":', JSON.stringify(saved));
console.log('page errors:', tab.errors.filter((e) => !/voice|favicon/.test(e)));
process.exit(0);
