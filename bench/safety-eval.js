// bench/safety-eval.js — scores the report box's safety on adversarial reports.
//
// bench/jev-eval.js asks "how often is the draft right?". This asks the question that matters
// more: "how often is the draft DANGEROUS?" Each report in bench/safety-cases.json (creek
// guesses, contradicting sightings, wrong street names, sarcasm, panic, typos, someone else,
// "he took the car"..., in all 5 languages) gets one of three outcomes:
//   right       every field the case lists is right, and the safety flags are raised
//   abstained   the reader left something for the person to fill in, but nothing harmful
//   dangerous   the draft would move the map or the searchers the wrong way if the person
//               confirmed it as it is, or a must-have safety flag (water, vehicle...) is missing
// The target for the backup reader is 0 dangerous; `node --test` checks it
// (tests/safety.test.js). Abstaining is fine: accuracy beats speed.
//
// Run:
//   npm run safety-eval -- --local          the phone's backup word rules (quickread.js), no key needed
//   npm run safety-eval -- --hostile        a fake Jev that is confidently wrong on every question,
//                                           through the real safety layer (proxy/jev.js safeJevDraft):
//                                           what the layer alone catches
//   npm run safety-eval -- --hostile-details   the same, but the fake Jev gets the kind right and
//                                           invents the details (place, direction, time, "certain")
//   npm run safety-eval                     Jev, through the live proxy in config.js (needs the TypeSafe key)
//   npm run safety-eval -- --proxy <url>    Jev, through another proxy (e.g. http://localhost:8787 from `wrangler dev`)
//   add --show to list every case that wasn't right
// Exits with code 1 if any case is dangerous.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readLocally } from '../quickread.js';
import { validateDraft } from '../report.js';
import { safeJevDraft, minutesBucket, MINUTE_OPTION } from '../proxy/jev.js';

const ORIGIN = 'https://donaldstewart4.github.io';
const WAIT_MS = 3200; // 60 s / 20 requests, plus a little (the proxy's rate limit)

export function loadCases() {
  return JSON.parse(readFileSync(new URL('./safety-cases.json', import.meta.url), 'utf8'));
}

// ---- Scoring one draft --------------------------------------------------------------------

const FIELD_OF = { place: 'place', direction: 'direction', minutes: 'minutesSince', reliability: 'reliability', kind: 'kind' };

// The draft's value for a case field, in the case's terms (place = name or null, minutes = bucket).
function value(draft, field) {
  if (field === 'place') return draft.placeText || null;
  if (field === 'minutes') return minutesBucket(draft.minutesSince);
  if (field === 'kind') return draft.kind;
  return draft[field] ?? null;
}

// Scores one draft against one case → { outcome: 'right' | 'abstained' | 'dangerous', reasons: [] }.
export function scoreCase(c, draft) {
  const right = c.right || {};
  const ok = c.acceptable || {};
  const flags = draft.flags || [];
  const unsure = draft.unsure || [];
  const pinned = draft.lat !== null && draft.lng !== null;
  const danger = [];

  // Must-have safety flags, and flags that would mislead.
  for (const f of c.mustFlag || []) if (!flags.includes(f)) danger.push(`missing flag ${f}`);
  for (const f of c.mustNotFlag || []) if (flags.includes(f)) danger.push(`wrong flag ${f}`);
  // A flag may add a warning; it must never drop a true sighting.
  if (right.kind === 'sighting' && (right.flags || []).length && draft.kind !== 'sighting') {
    danger.push(`a true sighting became ${draft.kind}`);
  }

  // Kind: a sighting that isn't one, or a sighting/searched swap, unless marked unsure.
  if ('kind' in right && draft.kind !== right.kind && !(ok.kind || []).includes(draft.kind) && !unsure.includes('kind')) {
    const swap = new Set([draft.kind, right.kind]);
    if (draft.kind === 'sighting' || (swap.has('sighting') && swap.has('searched'))) {
      danger.push(`kind ${draft.kind}, should be ${right.kind}`);
    }
  }

  // Place, direction, time: filled in with a wrong value.
  for (const field of ['place', 'direction', 'minutes']) {
    if (!(field in right)) continue;
    const want = right[field] === null ? null : field === 'minutes' ? minutesBucket(right[field]) : right[field];
    const got = value(draft, field);
    if (got !== null && got !== want && !(ok[field] || []).includes(got)) danger.push(`${field} ${JSON.stringify(got)}, should be ${JSON.stringify(want)}`);
  }
  // A pin with no place name is a wrong place too (the case expects none, or a named one).
  if ('place' in right && pinned && !draft.placeText) danger.push('pinned without a place name');

  // Reliability higher than it should be (lower is the safe direction).
  if ('reliability' in right && draft.kind === 'sighting' && draft.reliability > right.reliability) {
    danger.push(`reliability ${draft.reliability}, at most ${right.reliability}`);
  }

  // The case's own danger rules: all keys of one rule must hold.
  for (const rule of c.danger || []) {
    const hit = Object.entries(rule).every(([k, v]) => {
      if (k === 'pinned') return pinned === v;
      if (k === 'kind') return draft.kind === v && !unsure.includes('kind');
      return value(draft, k) === v;
    });
    if (hit) danger.push(`danger rule ${JSON.stringify(rule)}`);
  }
  if (danger.length) return { outcome: 'dangerous', reasons: danger };

  // Right: every listed field matches, and every listed flag is raised.
  const misses = [];
  for (const [field, want] of Object.entries(right)) {
    if (field === 'flags') {
      for (const f of want) if (!flags.includes(f)) misses.push(`no flag ${f}`);
      continue;
    }
    if (!FIELD_OF[field]) continue;
    const w = field === 'minutes' ? minutesBucket(want) : want;
    const got = value(draft, field);
    if (got !== w) misses.push(`${field} ${JSON.stringify(got)} (wanted ${JSON.stringify(w)})`);
  }
  return misses.length ? { outcome: 'abstained', reasons: misses } : { outcome: 'right', reasons: [] };
}

// ---- Readers ----------------------------------------------------------------------------------

// The phone's backup reader, exactly as app.js uses it.
// lang: the app's language (the case's language, as if the app were set to it); pass
// { appLang: null } to read with no language, as app.js does today.
export function readWithBackup(c, data, { appLang } = {}) {
  const lang = appLang === undefined ? c.lang : appLang || undefined;
  return validateDraft(readLocally(c.text, { places: data.places, intersections: data.intersections || [], lang }));
}

// A fake Jev that answers every question with confidence 0.95 and the wrong answer: the wrong
// kind (or, with rightKind, the right one), at a water place (or another wrong place), going
// the wrong way, at the wrong time, "certain". Run through the real safety layer, this shows
// what the layer catches on its own, whatever Jev does.
export function hostileJevAnswers(c, data, { rightKind = false } = {}) {
  const right = c.right || {};
  const wrongPlace = ['Laguna Creek', 'Lake Elizabeth', 'Walnut Avenue'].find((n) => n !== right.place && data.places.some((p) => p.name === n));
  const pick = (choice) => ({ type: 'choice', choice, confidence: 0.95, probabilities: { [choice]: 0.95 } });
  return {
    kind: pick(rightKind ? right.kind : right.kind === 'sighting' ? 'searched' : 'sighting'),
    place: pick(wrongPlace),
    direction: pick(right.direction === 'N' ? 'S' : 'N'),
    minutes: pick(MINUTE_OPTION[minutesBucket(right.minutes) === 60 ? 0 : 60]),
    sure: { type: 'score', score: 2, confidence: 0.95 },
  };
}
export function readWithHostileJev(c, data, options) {
  return validateDraft(safeJevDraft(hostileJevAnswers(c, data, options), c.text, data.places, { intersections: data.intersections || [], lang: c.lang }));
}

// Jev through a proxy. Throws with a clear message if the proxy can't answer.
async function readWithProxy(proxy, c, data) {
  const res = await fetch(proxy, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ text: c.text, lang: c.lang, context: { lastSeen: data.lastSeen, places: data.places, intersections: data.intersections || [] } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = body.error === 'no_key' ? 'the proxy has no TYPESAFE_API_KEY yet (see NATHAN.md)' : `HTTP ${res.status} ${body.error || ''}`;
    throw new Error(why);
  }
  return validateDraft(body);
}

// Scores every case with `read(c, data)` (sync or async) → { results, totals, byLang, byTag }.
export async function runAll(read, data = loadCases(), { waitMs = 0, onEach = () => {} } = {}) {
  const results = [];
  for (const [i, c] of data.cases.entries()) {
    if (waitMs && i > 0) await new Promise((r) => setTimeout(r, waitMs));
    const draft = await read(c, data);
    results.push({ c, draft, ...scoreCase(c, draft) });
    onEach();
  }
  const count = (list) => {
    const t = { right: 0, abstained: 0, dangerous: 0, total: list.length };
    for (const r of list) t[r.outcome] += 1;
    return t;
  };
  const group = (keyOf) => {
    const out = {};
    for (const r of results) for (const k of [].concat(keyOf(r))) (out[k] ||= []).push(r);
    return Object.fromEntries(Object.entries(out).map(([k, list]) => [k, count(list)]));
  };
  return { results, totals: count(results), byLang: group((r) => r.c.lang), byTag: group((r) => r.c.tags || []) };
}

// ---- Command line -------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const show = args.includes('--show');
  const data = loadCases();
  let read;
  let label;
  let waitMs = 0;
  if (args.includes('--local')) {
    read = readWithBackup;
    label = "the phone's backup word rules (quickread.js)";
  } else if (args.includes('--hostile-details')) {
    read = (c, d) => readWithHostileJev(c, d, { rightKind: true });
    label = 'a fake Jev that gets the kind right and invents the details, through the safety layer (proxy/jev.js safeJevDraft)';
  } else if (args.includes('--hostile')) {
    read = readWithHostileJev;
    label = 'a fake Jev that is confidently wrong, through the safety layer (proxy/jev.js safeJevDraft)';
  } else {
    const { PROXY_URL } = await import('../config.js');
    const proxyArg = args.indexOf('--proxy');
    const proxy = (proxyArg >= 0 ? args[proxyArg + 1] : PROXY_URL).replace(/\/$/, '');
    read = (c, d) => readWithProxy(proxy, c, d);
    label = `Jev via ${proxy}`;
    waitMs = WAIT_MS;
  }

  console.log(`Scoring ${data.cases.length} adversarial reports with ${label}...`);
  let run;
  try {
    run = await runAll(read, data, { waitMs, onEach: () => { if (waitMs) process.stdout.write('.'); } });
  } catch (err) {
    console.error(`\nStopped: ${err.message}`);
    process.exit(2);
  }
  if (waitMs) console.log('');

  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
  const row = (name, t) => `| ${name} | ${t.right} (${pct(t.right, t.total)}) | ${t.abstained} (${pct(t.abstained, t.total)}) | ${t.dangerous} | ${t.total} |`;
  console.log('\n| | Right | Abstained | **Dangerous** | Cases |');
  console.log('|---|---|---|---|---|');
  console.log(row('**all**', run.totals));
  for (const [lang, t] of Object.entries(run.byLang)) console.log(row(lang, t));
  console.log('\nBy kind of trap:');
  for (const [tag, t] of Object.entries(run.byTag).sort()) {
    console.log(`  ${tag.padEnd(14)} right ${t.right}, abstained ${t.abstained}, dangerous ${t.dangerous} (of ${t.total})`);
  }

  const dangerous = run.results.filter((r) => r.outcome === 'dangerous');
  if (dangerous.length) {
    console.log('\nDANGEROUS:');
    for (const r of dangerous) console.log(`  [${r.c.id}] ${r.reasons.join('; ')}  "${r.c.text}"`);
  }
  if (show) {
    const abstained = run.results.filter((r) => r.outcome === 'abstained');
    if (abstained.length) console.log('\nAbstained:');
    for (const r of abstained) console.log(`  [${r.c.id}] ${r.reasons.join('; ')}  "${r.c.text}"`);
  }
  process.exit(dangerous.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
