// The Demo end to end in one tab (not shared): the ranked routes with their warnings, take a
// route, mark it done, a report with no time in it (flags, "not sure" marks, the empty time is
// refused), "They've been found" with its pin, and the hand-off sheet's new lines.
// Run:  node tools/browser/release-check.mjs [mock database port, default 9000]
import { Tab, sleep, closeAllTabs } from './cdp.mjs';
await closeAllTabs(9333);
const tab = await Tab.open(9333);
await tab.send('Network.enable');
await tab.send('Network.setCacheDisabled', { cacheDisabled: true });
await tab.send('Network.setBypassServiceWorker', { bypass: true });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.confirm = () => true;' });
await tab.go(`http://localhost:8000/?db=http://localhost:${process.argv[2] || 9000}`);
await tab.waitFor('!!document.getElementById("demo")');
await sleep(800);
const cards = () => tab.eval(`[...document.querySelectorAll('#areas > li')].map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 330))`);
const t0 = Date.now();
await tab.eval('document.getElementById("demo").click()');
await tab.waitFor('document.querySelectorAll("#spots li").length > 0', 120000, 'Demo results');
console.log('Demo results after', Date.now() - t0, 'ms');
await tab.waitFor('document.querySelectorAll("#areas .area-head").length > 0', 30000, 'task cards');
console.log('task cards after', Date.now() - t0, 'ms');
console.log('SPOTS', JSON.stringify(await tab.eval(`[...document.querySelectorAll('#spots li')].slice(0,3).map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120))`), null, 1));
console.log('CARDS', JSON.stringify(await cards(), null, 1));
console.log('note:', await tab.eval('document.getElementById("task-note").hidden ? "" : document.getElementById("task-note").textContent'));
console.log('unfilled:', await tab.eval('document.getElementById("unfilled").textContent'), '| measures:', await tab.eval('document.getElementById("plan-measures").textContent'));
console.log('route lines on map:', await tab.eval('document.querySelectorAll(".map-letter").length'), 'numbered markers');
// Take the first task.
await tab.eval('document.querySelector("#areas .area-body button").click()');
await tab.waitFor('!!document.querySelector("#areas .area-letter.held")', 15000, 'held task');
console.log('\nAFTER TAKE', JSON.stringify(await cards(), null, 1));
console.log('buttons:', await tab.eval(`[...document.querySelectorAll('#areas .area-body button')].map((b) => b.textContent)`));
// Done.
await tab.eval('document.querySelector("#areas .area-body button.primary").click()');
await tab.waitFor('!document.querySelector("#areas .area-letter.held") && document.querySelectorAll("#areas .area-head").length > 0', 15000, 'new cards after done');
await sleep(500);
console.log('\nAFTER DONE', JSON.stringify(await cards(), null, 1));
console.log('measures:', await tab.eval('document.getElementById("plan-measures").textContent'));
console.log('leader:', await tab.eval('document.getElementById("leader").hidden ? "(hidden)" : document.getElementById("leader-line").textContent'));
// A report with no time, near water (the backup reader fills it in when Jev can't be reached from localhost).
await tab.eval('document.getElementById("report-open").click()');
await tab.eval('document.getElementById("report-text").value = "I think I saw him by the lake, he was heading north"; document.getElementById("report-read").click()');
await tab.waitFor('!document.getElementById("sighting-form").hidden || document.getElementById("report-status").textContent.length > 0 && !document.getElementById("report-read").disabled', 30000, 'report read');
await sleep(800);
console.log('\nREPORT -> form open:', await tab.eval('!document.getElementById("sighting-form").hidden'),
  '| minutes box: "' + await tab.eval('document.getElementById("sighting-minutes").value') + '"',
  '| direction:', await tab.eval('document.getElementById("sighting-direction").value'),
  '| flags:', await tab.eval(`[...document.querySelectorAll('#sighting-flags .flag')].map((p) => p.textContent)`),
  '| unsure:', await tab.eval(`[...document.querySelectorAll('#sighting-form .unsure')].map((e) => e.id || e.tagName)`),
  '| marks:', await tab.eval(`document.querySelectorAll('#sighting-form .unsure-mark').length`),
  '| check line:', await tab.eval('document.getElementById("sighting-check").textContent'),
  '| leader:', await tab.eval('document.getElementById("leader").hidden ? "(hidden)" : document.getElementById("leader-line").textContent + " // " + document.getElementById("leader-warnings").textContent'),
  '| status:', await tab.eval('document.getElementById("status").textContent'));
// Save with the time empty: must be refused (an unknown time is not "0 minutes ago").
const mapMiddle = await tab.eval('(() => { const b = document.getElementById("map").getBoundingClientRect(); return { x: b.left + b.width / 2 + 40, y: b.top + b.height / 2 + 40 }; })()');
for (const type of ['mousePressed', 'mouseReleased']) await tab.send('Input.dispatchMouseEvent', { type, x: mapMiddle.x, y: mapMiddle.y, button: 'left', clickCount: 1 });
await sleep(300);
await tab.eval('document.getElementById("sighting-save").click()');
await sleep(300);
console.log('save with a pin but an empty time ->', await tab.eval('document.getElementById("status").textContent'), '| form still open:', await tab.eval('!document.getElementById("sighting-form").hidden'));
await tab.eval('document.getElementById("sighting-minutes").value = "10"; document.getElementById("sighting-minutes").dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("sighting-save").click()');
await sleep(1500);
console.log('with 10 minutes typed -> form closed:', await tab.eval('document.getElementById("sighting-form").hidden'), '| status:', await tab.eval('document.getElementById("status").textContent'), '| sighting pins on the map:', await tab.eval('document.querySelectorAll(".map-sighting").length'));
// Found.
await tab.eval('document.getElementById("found-button").click()');
await sleep(300);
const mode = await tab.eval('document.getElementById("tap-banner").hidden ? "" : document.getElementById("tap-banner-text").textContent');
console.log('\nFOUND: tap banner:', mode);
if (mode) {
  // Tap the map near its middle (a status message may be lying over the exact middle).
  await sleep(700);
  const spot = await tab.eval(`(() => {
    const b = document.getElementById('map').getBoundingClientRect();
    const tried = [];
    for (const [dx, dy] of [[0, 0], [60, -60], [-80, 50], [100, 80], [-120, -90]]) {
      const x = b.left + b.width / 2 + dx; const y = b.top + b.height / 2 + dy;
      const el = document.elementFromPoint(x, y);
      const name = el ? el.tagName + '.' + String(el.className).slice(0, 40) + (el.id ? '#' + el.id : '') : 'nothing';
      tried.push(name);
      // Anything that belongs to the map will do, a numbered marker included: a tap on a marker
      // must count too (people are often found right at a numbered spot).
      if (el && document.getElementById('map').contains(el)) return { x, y, tried };
    }
    return { x: null, y: null, tried };
  })()`);
  console.log('  what lies over the map at the points tried:', spot.tried.join(' | '));
  for (const type of ['mousePressed', 'mouseReleased']) await tab.send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
}
await tab.waitFor('!document.getElementById("found-banner").hidden', 10000, 'found banner');
console.log('banner:', await tab.eval('document.getElementById("found-banner").textContent'), '| pin:', await tab.eval('document.querySelectorAll(".map-found-person").length'), '| cards left:', await tab.eval('document.querySelectorAll("#areas .area-head").length'), '| found button hidden:', await tab.eval('document.getElementById("found-button").hidden'));
// Hand-off sheet.
await tab.eval('document.getElementById("handoff").click()');
await sleep(400);
console.log('\nHAND-OFF timeline:\n' + (await tab.eval('document.getElementById("handoff-text").value || document.getElementById("handoff-text").textContent')).split('\n').filter((l) => /finished a task|FOUND|searched/.test(l)).join('\n'));
console.log('\npage errors:', tab.errors.length ? tab.errors : 'none');
console.log('console warnings/errors:', tab.console.filter((l) => /^(warning|error)/.test(l)).slice(0, 12));
process.exit(0);
