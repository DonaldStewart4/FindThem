// bench/jev-eval.js — scores how well the report box reads real-sounding reports.
//
// It sends each report in bench/jev-cases.json (40 reports, all 5 languages) to a reader
// and compares the draft with the expected answers, field by field:
//   right        the answer matches (minutes compared by bucket: 0, 5, 10, 15, 30, 60)
//   left empty   no answer where one was expected: the person fills it in (the safe miss)
//   wrong        a wrong answer: the person has to notice and fix it (the bad miss)
// For Jev, a "wrong" should become "left empty" by raising MIN_CONFIDENCE in proxy/jev.js;
// that's the tuning this script is for.
//
// Run:
//   npm run jev-eval -- --local          the phone's backup word rules (quickread.js), no key needed
//   npm run jev-eval                     Jev, through the live proxy in config.js (needs the TypeSafe key)
//   npm run jev-eval -- --proxy <url>    Jev, through another proxy (e.g. http://localhost:8787 from `wrangler dev`)
//   add --show to list every miss
//
// The proxy only answers requests from the live site, so this sends that site's Origin
// header. It waits between requests to stay under the proxy's rate limit (20 a minute).

import { readFileSync } from 'node:fs';
import { readLocally } from '../quickread.js';
import { validateDraft } from '../report.js';
import { PROXY_URL } from '../config.js';

const ORIGIN = 'https://donaldstewart4.github.io';
const WAIT_MS = 3200; // 60 s / 20 requests, plus a little

const args = process.argv.slice(2);
const local = args.includes('--local');
const show = args.includes('--show');
const proxyArg = args.indexOf('--proxy');
const proxy = (proxyArg >= 0 ? args[proxyArg + 1] : PROXY_URL).replace(/\/$/, '');

const data = JSON.parse(readFileSync(new URL('./jev-cases.json', import.meta.url), 'utf8'));
const context = { lastSeen: data.lastSeen, places: data.places };

// Minutes → the same buckets Jev answers with.
function bucket(m) {
  if (m === null || m === undefined) return null;
  if (m < 3) return 0;
  if (m < 8) return 5;
  if (m < 13) return 10;
  if (m < 23) return 15;
  if (m < 45) return 30;
  return 60;
}

// Asks the reader for a draft. Throws with a clear message if the proxy can't answer.
async function read(text, lang) {
  if (local) return validateDraft(readLocally(text, context));
  const res = await fetch(proxy, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ text, lang, context }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = body.error === 'no_key' ? 'the proxy has no TYPESAFE_API_KEY yet (see NATHAN.md)' : `HTTP ${res.status} ${body.error || ''}`;
    throw new Error(why);
  }
  return validateDraft(body);
}

// Compares one field: 'right', 'empty' or 'wrong'.
function judge(expected, got) {
  if (expected === got) return 'right';
  if (got === null || got === undefined || got === '') return 'empty';
  return 'wrong';
}

const FIELDS = ['kind', 'direction', 'minutes', 'place', 'reliability'];
const totals = Object.fromEntries(FIELDS.map((f) => [f, { right: 0, empty: 0, wrong: 0 }]));
const byLang = {};
const misses = [];

console.log(`Reading ${data.cases.length} reports with ${local ? 'the phone\'s backup word rules (quickread.js)' : `Jev via ${proxy}`}...`);
for (const [i, c] of data.cases.entries()) {
  if (!local && i > 0) await new Promise((r) => setTimeout(r, WAIT_MS));
  let draft;
  try {
    draft = await read(c.text, c.lang);
  } catch (err) {
    console.error(`\nStopped: ${err.message}`);
    process.exit(1);
  }
  if (!local) process.stdout.write('.');
  const e = c.expect;
  const got = {
    kind: draft.kind,
    direction: draft.direction,
    minutes: bucket(draft.minutesSince),
    place: draft.placeText || null,
    reliability: draft.reliability,
  };
  const want = { ...e, minutes: bucket(e.minutes) };
  // Which fields count: all for a sighting, the place for a searched report, the kind always.
  const scored = e.kind === 'sighting' ? FIELDS : e.kind === 'searched' ? ['kind', 'place'] : ['kind'];
  const lang = (byLang[c.lang] ||= { right: 0, total: 0 });
  for (const f of scored) {
    const verdict = judge(want[f] ?? null, got[f] ?? null);
    totals[f][verdict] += 1;
    lang.total += 1;
    if (verdict === 'right') lang.right += 1;
    else misses.push({ lang: c.lang, text: c.text, field: f, want: want[f] ?? null, got: got[f] ?? null, verdict });
  }
}
if (!local) console.log('');

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
console.log('\n| Field | Right | Left empty | Wrong |');
console.log('|---|---|---|---|');
let allRight = 0;
let all = 0;
for (const f of FIELDS) {
  const t = totals[f];
  const n = t.right + t.empty + t.wrong;
  allRight += t.right;
  all += n;
  console.log(`| ${f} | ${t.right}/${n} (${pct(t.right, n)}) | ${t.empty} | ${t.wrong} |`);
}
console.log(`| **all** | **${allRight}/${all} (${pct(allRight, all)})** | ${all - allRight - misses.filter((m) => m.verdict === 'wrong').length} | ${misses.filter((m) => m.verdict === 'wrong').length} |`);
console.log(`\nBy language: ${Object.entries(byLang).map(([l, v]) => `${l} ${pct(v.right, v.total)}`).join(', ')}`);

if (show && misses.length) {
  console.log('\nMisses:');
  for (const m of misses) console.log(`  [${m.lang}] ${m.field}: wanted ${JSON.stringify(m.want)}, got ${JSON.stringify(m.got)} (${m.verdict})  "${m.text}"`);
} else if (misses.length) {
  console.log('Add --show to list the misses.');
}
