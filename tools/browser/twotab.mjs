// Two tabs on one shared search (mock database): do they show the same map, and does a
// search marked in one reach the other?
import { Tab, sleep } from './cdp.mjs';
const BASE = 'http://localhost:8000/?db=http://localhost:9000';
const spotsOf = (tab) => tab.eval(`[...document.querySelectorAll('#spots li')].map((li) => li.textContent.trim().replace(/\\s+/g, ' ')).join(' | ')`);
const areasOf = (tab) => tab.eval(`[...document.querySelectorAll('#areas li .area-head')].map((li) => li.textContent.trim().replace(/\\s+/g, ' ')).join(' | ')`);

const a = await Tab.open(9333);
await a.send('Network.enable'); await a.send('Network.setBypassServiceWorker', { bypass: true });
await a.go(BASE);
await a.waitFor('!!document.getElementById("demo")'); await sleep(500);
await a.eval('document.getElementById("demo").click()');
await a.waitFor('document.querySelectorAll("#spots li").length > 0', 60000, 'Demo in tab A');
await a.eval('document.getElementById("my-name").value = "Ana"; document.getElementById("my-name").dispatchEvent(new Event("change")); document.getElementById("share").click()');
await a.waitFor('location.hash.includes("s=")', 20000, 'share link in tab A');
const link = await a.eval('location.href');
const params = new URLSearchParams(link.split('#')[1]);
const packed = JSON.parse(Buffer.from(params.get('c').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
console.log('share link carries: search id', !!params.get('s'), '| area', params.get('a'), '| minutesAt (t)', packed.t, '| last seen', packed.la, packed.ln);
const caseDoc = await (await fetch(`http://localhost:9000/searches/${params.get('s')}/case.json`)).json();
console.log('database case carries minutesAt:', caseDoc.minutesAt, '| same as the link:', caseDoc.minutesAt === packed.t, '| keys:', Object.keys(caseDoc).join(','));

const b = await Tab.open(9333);
await b.send('Network.enable'); await b.send('Network.setBypassServiceWorker', { bypass: true });
await b.go(link);
await b.waitFor('document.querySelectorAll("#spots li").length > 0', 60000, 'joined search in tab B');
await sleep(1500);
let sa = await spotsOf(a); let sb = await spotsOf(b);
console.log('\nsame top spots in both tabs after joining:', sa === sb);
console.log('  A:', sa.slice(0, 150));
console.log('  B:', sb.slice(0, 150));

// Tab A marks its first area searched.
await a.eval('document.querySelector("#areas li .area-head").click()');
await a.waitFor('!!document.querySelector("#areas li .area-body button")', 5000, 'area body');
const before = await areasOf(b);
await a.eval('document.querySelector("#areas li .area-body button").click()');
const ms = await b.waitFor(`[...document.querySelectorAll('#areas li .area-head')].map((li) => li.textContent.trim().replace(/\\s+/g, ' ')).join(' | ') !== ${JSON.stringify(before)}`, 15000, 'tab B to update');
await sleep(1500);
sa = await spotsOf(a); sb = await spotsOf(b);
const aa = await areasOf(a); const ab = await areasOf(b);
console.log(`\ntab A marked area A searched; tab B changed ${ms} ms later`);
console.log('same top spots after the search:', sa === sb, '| same next areas:', aa === ab);
console.log('  A areas:', aa.slice(0, 170));
console.log('  B areas:', ab.slice(0, 170));
const events = await (await fetch(`http://localhost:9000/searches/${params.get('s')}/events.json`)).json();
console.log('events in the database:', Object.values(events || {}).map((e) => `${e.type}${e.sectorId ? ' ' + e.sectorId : ''}${e.minutes ? ' ' + e.minutes + ' min' : ''}`).join(', '));
const errs = [...a.errors, ...b.errors].filter((e) => !/voice|favicon/.test(e));
console.log('page errors (other than the proxy CORS notice on localhost):', errs.length ? errs : 'none');
process.exit(0);
