// Two volunteers on one shared search (mock database), each a tab with its own GPS position and
// searcher id. Checks, in order:
//   1. both show the same top spots, and each gets its own ranked routes
//   2. a route taken in tab A is not handed to tab B (no pile-ups)
//   3. a correction in tab A ("actually 90 minutes, heading east") reaches tab B (caseUpdate)
//   4. "They've been found" in tab B ends the search in tab A, with a pin
//   5. a search started on another engine version shows the warning
// Run:  node tools/browser/twotab.mjs [mock database port, default 9000]
import { Tab, sleep, closeAllTabs } from './cdp.mjs';
const CHROME = 9333;
const DB = `http://localhost:${process.argv[2] || 9000}`;
const BASE = `http://localhost:8000/?db=${DB}`;
await closeAllTabs(CHROME);

// A tab that believes it stands at (lat, lng) and is the searcher `id`.
async function volunteer(id, lat, lng) {
  const tab = await Tab.open(CHROME);
  await tab.send('Network.enable');
  await tab.send('Network.setCacheDisabled', { cacheDisabled: true });
  await tab.send('Network.setBypassServiceWorker', { bypass: true });
  await tab.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: 'http://localhost:8000' }).catch(() => {});
  await tab.send('Emulation.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 8 });
  // Both tabs share one browser profile, so give each its own searcher id; and answer "OK" to
  // the "tell everyone they were found?" question.
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('searcherId', '${id}'); window.confirm = () => true;` });
  return tab;
}
const text = (tab, sel) => tab.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => el.textContent.trim().replace(/\\s+/g, ' ')).join(' | ')`);
const tasks = (tab) => tab.eval(`[...document.querySelectorAll('#areas > li[data-task]')].map((li) => li.dataset.task + (li.querySelector('.held') ? ' (mine)' : ''))`);
const cards = (tab) => tab.eval(`[...document.querySelectorAll('#areas > li[data-task]')].map((li) => li.textContent.trim().replace(/\\s+/g, ' ').slice(0, 140))`);
const setName = (tab, name) => tab.eval(`document.getElementById('my-name').value = ${JSON.stringify(name)}; document.getElementById('my-name').dispatchEvent(new Event('change'));`);

// ---- 1. Ana starts the Demo and shares it; Ben joins from the link -------------------------
const a = await volunteer('aaaaaaaaaaaaaaaa', 37.5405, -121.9795);   // at the last-seen point
await a.go(BASE);
await a.waitFor('!!document.getElementById("demo")'); await sleep(500);
await a.eval('document.getElementById("demo").click()');
await a.waitFor('document.querySelectorAll("#spots li").length > 0', 60000, 'Demo in tab A');
await setName(a, 'Ana');
await a.eval('document.getElementById("share").click()');
await a.waitFor('location.hash.includes("s=")', 20000, 'share link in tab A');
const link = await a.eval('location.href');
const searchId = new URLSearchParams(link.split('#')[1]).get('s');
const caseDoc = await (await fetch(`${DB}/searches/${searchId}/case.json`)).json();
console.log('1. shared case keys:', Object.keys(caseDoc).join(','), '| engineVersion', caseDoc.engineVersion);

const b = await volunteer('bbbbbbbbbbbbbbbb', 37.5440, -121.9760);   // about 500 m north-east
await b.go(link);
await b.waitFor('document.querySelectorAll("#spots li").length > 0', 60000, 'joined search in tab B');
await setName(b, 'Ben');
await a.waitFor('document.querySelectorAll(".searcher-label").length > 0', 30000, 'Ana sees Ben on the map');
await b.waitFor('document.querySelectorAll(".searcher-label").length > 0', 30000, 'Ben sees Ana on the map');
await a.waitFor('document.querySelectorAll("#areas > li[data-task]").length > 0', 30000, 'routes in tab A');
await b.waitFor('document.querySelectorAll("#areas > li[data-task]").length > 0', 30000, 'routes in tab B');
await sleep(6500); // one more plan, now that each knows where the other stands
console.log('   same top spots in both tabs:', (await text(a, '#spots li')) === (await text(b, '#spots li')));
console.log('   Ana\'s routes:', JSON.stringify(await cards(a), null, 1));
console.log('   Ben\'s routes:', JSON.stringify(await cards(b), null, 1));
console.log('   Ana:', await tasks(a), '| Ben:', await tasks(b));
// (A danger spot that needs two people is offered to both, each with the other as partner: that
// is the one case where both are meant to see the same first choice.)

// ---- 2. Ana takes her first route: Ben must not be sent there -------------------------------
const taken = await a.eval(`(() => { const li = document.querySelector('#areas > li.selected[data-task]'); li.querySelector('.area-body button').click(); return li.dataset.task; })()`);
await a.waitFor('!!document.querySelector("#areas .area-letter.held")', 15000, 'Ana holds her task');
await sleep(3000);
const benAfter = await tasks(b);
console.log(`\n2. Ana took ${taken}. Ana: ${await tasks(a)} | Ben, 3 s later: ${benAfter}`);
console.log('   Ben\'s first choice is not Ana\'s task:', benAfter[0] !== taken);
await b.eval('document.querySelector("#areas > li[data-task] .area-body button").click()');
await b.waitFor('!!document.querySelector("#areas .area-letter.held")', 15000, 'Ben holds his task');
await sleep(2500);
const held = [(await tasks(a)).find((x) => x.endsWith('(mine)')), (await tasks(b)).find((x) => x.endsWith('(mine)'))];
console.log('   both hold a task:', held, '| different ground:', held[0] !== held[1]);
const events = Object.values(await (await fetch(`${DB}/searches/${searchId}/events.json`)).json() || {});
console.log('   database events:', events.map((e) => `${e.type}${e.taskId ? ':' + e.taskId : ''}`).join(', '));

// ---- 3. Ana corrects the case: Ben's phone follows -------------------------------------------
await a.eval(`document.getElementById('case-inputs').open = true; document.getElementById('minutes').value = '90'; document.getElementById('direction').value = 'E'; document.getElementById('run').click();`);
try {
  await b.waitFor('document.getElementById("direction").value === "E"', 20000, 'Ben gets the correction');
} catch (err) {
  // Say where it stopped: was the correction sent, stored, received?
  const stored = Object.values(await (await fetch(`${DB}/searches/${searchId}/events.json`)).json() || {});
  console.log('\n3. FAILED:', err.message);
  console.log('   Ana: status "' + await a.eval('document.getElementById("status").textContent') + '" | minutes', await a.eval('document.getElementById("minutes").value'), '| direction', await a.eval('document.getElementById("direction").value'), '| live:', await a.eval('document.getElementById("live-status").textContent'), '| busy:', await a.eval('document.getElementById("run").disabled'));
  console.log('   database events:', stored.map((e) => e.type + (e.field ? ':' + e.field : '')).join(', '));
  console.log('   Ben: minutes', await b.eval('document.getElementById("minutes").value'), '| direction "' + await b.eval('document.getElementById("direction").value') + '" | live:', await b.eval('document.getElementById("live-status").textContent'));
  for (const [name, tab] of [['Ana', a], ['Ben', b]]) console.log(`   ${name} console:`, tab.console.filter((l) => /^(warning|error)/.test(l)).slice(0, 6), tab.errors.filter((e) => !/findthem-proxy|ERR_FAILED/.test(e)).slice(0, 4));
  console.log('   Ben, asking the database again:', await b.eval(`(async () => { const sync = await import('/sync.js'); const r = await sync.loadSearch(${JSON.stringify(searchId)}); return JSON.stringify({ direction: r.caseDoc && r.caseDoc.direction, minutes: r.caseDoc && r.caseDoc.minutes, info: r.info, queued: sync.queuedEvents(${JSON.stringify(searchId)}).map((e) => e.type) }); })()`));
  process.exit(1);
}
// Ana's tab is in the background here, where the browser slows its timers: give it time to finish.
await a.waitFor('!document.getElementById("run").disabled', 30000, 'Ana\'s map after her correction');
await sleep(2500);
console.log('\n3. Ben after Ana\'s correction: minutes', await b.eval('document.getElementById("minutes").value'), '| direction', await b.eval('document.getElementById("direction").value'),
  '| recap:', await b.eval('document.getElementById("case-recap").textContent'));
console.log('   Ana\'s status:', await a.eval('document.getElementById("status").textContent'));
const updates = Object.values(await (await fetch(`${DB}/searches/${searchId}/events.json`)).json() || {}).filter((e) => e.type === 'caseUpdate');
console.log('   caseUpdate events:', updates.map((e) => `${e.field}=${JSON.stringify(e.value)}`).join(', '));
console.log('   same top spots after the correction:', (await text(a, '#spots li')) === (await text(b, '#spots li')));

// ---- 4. Ben reports the person found ------------------------------------------------------------
await b.eval('document.getElementById("found-button").click()');
await a.waitFor('!document.getElementById("found-banner").hidden', 20000, 'Ana sees "found"');
await sleep(500);
console.log('\n4. Ana\'s banner:', await a.eval('document.getElementById("found-banner").textContent'));
console.log('   pin on Ana\'s map:', await a.eval('document.querySelectorAll(".map-found-person").length'), '| Ana\'s routes left:', (await tasks(a)).length, '| Ben\'s routes left:', (await tasks(b)).length);

// ---- 5. A search started on another engine version --------------------------------------------
const otherId = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''); // a new id each run: a case can be written only once
const made = await fetch(`${DB}/searches/${otherId}/case.json`, { method: 'PUT', body: JSON.stringify({ ...caseDoc, engineVersion: '2020-01-01.1' }) });
const c = await volunteer('cccccccccccccccc', 37.5405, -121.9795);
await c.go(`${BASE}#s=${otherId}&a=demo`);
await c.waitFor('document.querySelectorAll("#spots li").length > 0', 60000, 'joined the other-version search');
await sleep(1500);
console.log('\n5. other-version case stored:', made.status, '| warning shown:', await c.eval('!document.getElementById("version-warning").hidden'), '|', await c.eval('document.getElementById("version-warning").textContent'));

for (const [name, tab] of [['A', a], ['B', b], ['C', c]]) {
  const errors = tab.errors.filter((e) => !/findthem-proxy|ERR_FAILED/.test(e));
  console.log(`page errors in tab ${name}:`, errors.length ? errors : 'none (apart from the proxy\'s CORS notice on localhost)');
  const warnings = tab.console.filter((l) => /^(warning|error)/.test(l));
  if (warnings.length) console.log(`  console in tab ${name}:`, warnings.slice(0, 6));
}
process.exit(0);
