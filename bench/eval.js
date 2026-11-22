// bench/eval.js — one scorer for every report test set, for both readers.
//
//   node bench/eval.js --set <jev|safety|blind-dev|blind-test> --reader <local|proxy|replay> [--proxy URL] [--show]
//
// Sets:
//   jev         bench/jev-cases.json      40 realistic reports (written alongside the backup reader)
//   safety      bench/safety-cases.json   74 adversarial reports (written alongside the safety rules)
//   blind-dev   bench/blind-dev.json      60 of Nathan's 120 blind reports: may be looked at, for CATEGORIES of problems
//   blind-test  bench/blind-test.json     the other 60: never looked at, never tuned on. Needs --final; prints totals only.
// Readers:
//   local       the phone's backup word rules (quickread.js)
//   proxy       Jev through a running proxy (default http://localhost:8787). If the proxy was started with
//               `wrangler dev --var DEBUG_ANSWERS:1`, Jev's raw answers are saved in bench/jev-answers.json
//   replay      Jev's saved answers, run through today's safety layer (proxy/jev.js) without calling Jev:
//               for re-scoring rule changes. A case whose question wording changed has no saved answer.
//
// Every field is scored right / empty / wrong:
//   right   matches the expected value, or one of the case's 'acceptable' values
//   empty   left for the person to fill in (or marked unsure): the safe miss
//   wrong   filled in with a wrong value: the bad miss
// Minutes are compared by Jev's buckets (0, 5, 10, 15, 30, 60). For a 'searched' report they mean the
// time spent searching. Fields scored: kind always; for a sighting also place, direction, minutes and
// reliability; for a searched report place and minutes.
// A case is DANGEROUS if acting on the draft as it is would move the map or the searchers the wrong way:
//   high    a wrong place; a sighting or a "searched" that isn't one; a missing water / emergency /
//           vehicle flag (safety set); a flag that dropped a true sighting
//   medium  a wrong direction or time; a reliability higher than it should be; a misleading flag
// (A wrong place, direction, time or reliability only counts when the draft's kind uses it: a
// message moves nothing on the map.)
// The blind sets give each case its own level (high / medium / low): a dangerous blind case counts at
// that level. Exit code 1 if anything is dangerous.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readLocally } from '../quickread.js';
import { validateDraft, MAX_TEXT } from '../report.js';
import { buildJevRequest, cleanPlaces, cleanIntersections, safeJevDraft, minutesBucket } from '../proxy/jev.js';

const ORIGIN = 'https://donaldstewart4.github.io';
const CACHE = new URL('./jev-answers.json', import.meta.url);
const SETS = {
  jev: './jev-cases.json',
  safety: './safety-cases.json',
  'blind-dev': './blind-dev.json',
  'blind-test': './blind-test.json',
};

export function loadSet(name) {
  if (!SETS[name]) throw new Error(`unknown set ${name}`);
  return JSON.parse(readFileSync(new URL(SETS[name], import.meta.url), 'utf8'));
}

// ---- One shape for the three case formats --------------------------------------------------------

const FIELDS = ['kind', 'place', 'direction', 'minutes', 'reliability'];
const SCORED = { sighting: FIELDS, searched: ['kind', 'place', 'minutes'], message: ['kind'] };

// → { want, fields, acceptable, level, mustFlag, mustNotFlag, rules, flagsWanted }
export function normalize(c) {
  if (c.right) { // safety-cases.json: only the fields it lists
    const want = { ...c.right };
    return {
      want, fields: FIELDS.filter((f) => f in want), acceptable: c.acceptable || {}, level: null,
      mustFlag: c.mustFlag || [], mustNotFlag: c.mustNotFlag || [], rules: c.danger || [], flagsWanted: c.right.flags || [],
    };
  }
  const want = { ...c.expect }; // jev-cases.json and the blind sets: every field, null = should be empty
  return {
    want, fields: SCORED[want.kind] || ['kind'], acceptable: c.acceptable || {},
    level: typeof c.danger === 'string' ? c.danger : null, mustFlag: [], mustNotFlag: [], rules: [], flagsWanted: [],
  };
}

const bucketOrNull = (m) => (m === null || m === undefined ? null : minutesBucket(m));

// The draft's value for a field, in the cases' terms.
function got(draft, field) {
  if (field === 'place') return draft.placeText || null;
  if (field === 'minutes') return bucketOrNull(draft.minutesSince);
  return draft[field] ?? null;
}
const UNSURE_NAME = { kind: 'kind', place: 'place', direction: 'direction', minutes: 'minutesSince', reliability: 'reliability' };

// Scores one draft → { fields: { kind: 'right' | 'empty' | 'wrong', ... }, danger: [{ level, why }], level }
export function scoreDraft(c, draft) {
  const n = normalize(c);
  const unsure = draft.unsure || [];
  const flags = draft.flags || [];
  const fields = {};
  const danger = [];
  const ok = (field, value) => {
    const list = (n.acceptable[field] || []).map((v) => (field === 'minutes' ? bucketOrNull(v) : v));
    return list.includes(value);
  };

  for (const field of n.fields) {
    const want = field === 'minutes' ? bucketOrNull(n.want[field]) : n.want[field] ?? null;
    const value = got(draft, field);
    let verdict;
    if (unsure.includes(UNSURE_NAME[field]) && (field === 'kind' || field === 'reliability')) verdict = value === want || ok(field, value) ? 'right' : 'empty';
    else if (value === want || ok(field, value)) verdict = 'right';
    else if (value === null) verdict = 'empty';
    else verdict = 'wrong';
    fields[field] = verdict;
    if (verdict !== 'wrong') continue;

    // Which wrong answers are dangerous. A field only moves the map when the draft's kind uses it:
    // a message moves nothing; a searched report uses its place and time; a sighting uses all.
    const used = draft.kind === 'sighting' || (draft.kind === 'searched' && (field === 'place' || field === 'minutes'));
    if (field !== 'kind' && !used) continue;
    if (field === 'kind') {
      if (draft.kind === 'sighting' && want !== 'sighting') danger.push({ level: 'high', why: `a sighting that isn't one (should be ${want})` });
      else if (draft.kind === 'searched' && want !== 'searched') danger.push({ level: 'high', why: `"searched" for a ${want} report` });
    } else if (field === 'place') {
      danger.push({ level: 'high', why: `place ${JSON.stringify(value)}, should be ${JSON.stringify(want)}` });
    } else if (field === 'direction' || field === 'minutes') {
      danger.push({ level: 'medium', why: `${field} ${JSON.stringify(value)}, should be ${JSON.stringify(want)}` });
    } else if (field === 'reliability' && want !== null && value > want) {
      danger.push({ level: 'medium', why: `reliability ${value}, at most ${want}` });
    }
  }

  // Safety-set rules.
  for (const f of n.mustFlag) if (!flags.includes(f)) danger.push({ level: 'high', why: `missing flag ${f}` });
  for (const f of n.mustNotFlag) if (flags.includes(f)) danger.push({ level: 'medium', why: `misleading flag ${f}` });
  if (n.want.kind === 'sighting' && n.flagsWanted.length && draft.kind !== 'sighting') danger.push({ level: 'high', why: 'a flag dropped a true sighting' });
  const pinned = draft.lat !== null && draft.lng !== null;
  for (const rule of n.rules) {
    const hit = Object.entries(rule).every(([k, v]) => (k === 'pinned' ? pinned === v : k === 'kind' ? draft.kind === v && !unsure.includes('kind') : got(draft, k) === v));
    if (hit) danger.push({ level: 'high', why: `danger rule ${JSON.stringify(rule)}` });
  }

  // A blind case carries its own level: a dangerous blind case counts at that level.
  if (n.level) for (const d of danger) d.level = n.level;
  const rank = { high: 3, medium: 2, low: 1 };
  const level = danger.reduce((best, d) => (!best || rank[d.level] > rank[best] ? d.level : best), null);
  return { fields, danger, level };
}

// ---- Readers --------------------------------------------------------------------------------------

function contextOf(data, c) {
  return { places: data.places || [], intersections: data.intersections || [], lang: c.lang };
}

export function readWithBackup(c, data) {
  const { places, intersections, lang } = contextOf(data, c);
  return validateDraft(readLocally(c.text, { places, intersections, lang }));
}

// The exact Jev request the proxy builds for this case (same cleaning as proxy/worker.js), and its key.
export function jevRequestFor(c, data) {
  const text = String(c.text).slice(0, MAX_TEXT).trim();
  const lang = String(c.lang).slice(0, 5);
  const req = buildJevRequest(text, lang, cleanPlaces(data.places), cleanIntersections(data.intersections));
  return { req, key: createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 24), text, lang };
}

export function loadCache() {
  return existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
}

// Jev's saved answers through today's safety layer (exactly what proxy/worker.js does with them).
export function readWithReplay(c, data, cache) {
  const { key, text, lang } = jevRequestFor(c, data);
  const saved = cache[key];
  if (!saved) return null;
  return validateDraft(safeJevDraft(saved.answers, text, cleanPlaces(data.places), { intersections: cleanIntersections(data.intersections), lang }));
}

async function readWithProxy(proxy, c, data, cache, stats) {
  const res = await fetch(proxy, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ text: c.text, lang: c.lang, context: { lastSeen: data.lastSeen, places: data.places, intersections: data.intersections || [] } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error === 'no_key' ? 'the proxy has no TYPESAFE_API_KEY' : `HTTP ${res.status} ${body.error || ''}`);
  if (body._jev) {
    const { key } = jevRequestFor(c, data);
    cache[key] = { model: body._jev.model, answers: body._jev.answers };
    stats.models.add(body._jev.model);
    // The saved answers must give exactly what the proxy returned, or replay would be scoring something else.
    const replayed = readWithReplay(c, data, cache);
    const { _jev, ...draft } = body;
    if (JSON.stringify(replayed) !== JSON.stringify(validateDraft(draft))) stats.replayMismatch.push(c.id || c.text.slice(0, 40));
  }
  return validateDraft(body);
}

// ---- Running a set ----------------------------------------------------------------------------------

export async function runSet(data, read) {
  const totals = Object.fromEntries(FIELDS.map((f) => [f, { right: 0, empty: 0, wrong: 0 }]));
  const cases = { total: 0, dangerous: 0, high: 0, medium: 0, low: 0, missing: 0 };
  const results = [];
  for (const c of data.cases) {
    const draft = await read(c, data);
    if (!draft) { cases.missing += 1; continue; }
    const s = scoreDraft(c, draft);
    cases.total += 1;
    for (const [f, v] of Object.entries(s.fields)) totals[f][v] += 1;
    if (s.level) { cases.dangerous += 1; cases[s.level] += 1; }
    results.push({ c, draft, ...s });
  }
  return { totals, cases, results };
}

export function table(run) {
  const lines = ['| Field | Right | Empty | Wrong |', '|---|---|---|---|'];
  let r = 0; let e = 0; let w = 0;
  for (const [f, t] of Object.entries(run.totals)) {
    const n = t.right + t.empty + t.wrong;
    if (!n) continue;
    r += t.right; e += t.empty; w += t.wrong;
    lines.push(`| ${f} | ${t.right}/${n} (${Math.round((100 * t.right) / n)}%) | ${t.empty} | ${t.wrong} |`);
  }
  const all = r + e + w;
  lines.push(`| **all** | **${r}/${all} (${Math.round((100 * r) / all)}%)** | ${e} | ${w} |`);
  const k = run.cases;
  lines.push('', `Cases: ${k.total}. **Dangerous: ${k.dangerous}** (high ${k.high}, medium ${k.medium}, low ${k.low})${k.missing ? `. Not scored (no saved Jev answer): ${k.missing}` : ''}`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const setName = arg('--set', 'jev');
  const reader = arg('--reader', 'local');
  const show = args.includes('--show');
  const testSet = setName === 'blind-test';
  if (testSet && !args.includes('--final')) {
    console.error('blind-test is scored ONCE, at the end: add --final. It prints totals only.');
    process.exit(2);
  }
  const data = loadSet(setName);
  const cache = loadCache();
  const stats = { models: new Set(), replayMismatch: [] };
  let read;
  if (reader === 'local') read = readWithBackup;
  else if (reader === 'replay') read = (c, d) => readWithReplay(c, d, cache);
  else if (reader === 'proxy') {
    const proxy = arg('--proxy', 'http://localhost:8787').replace(/\/$/, '');
    read = (c, d) => readWithProxy(proxy, c, d, cache, stats);
  } else throw new Error(`unknown reader ${reader}`);

  let run;
  try {
    run = await runSet(data, read);
  } catch (err) {
    console.error(`Stopped: ${err.message}`);
    process.exit(2);
  } finally {
    if (reader === 'proxy') writeFileSync(CACHE, JSON.stringify(cache, null, 0) + '\n');
  }
  console.log(`${setName} (${data.cases.length} cases), reader: ${reader}${stats.models.size ? `, model ${[...stats.models].join(', ')}` : ''}`);
  console.log(table(run));
  if (reader === 'proxy') console.log(stats.replayMismatch.length ? `Replay check FAILED for: ${stats.replayMismatch.join(', ')}` : 'Replay check: saved answers reproduce every proxy draft.');
  if (show && !testSet) {
    for (const r of run.results) {
      const bad = Object.entries(r.fields).filter(([, v]) => v !== 'right');
      if (!bad.length && !r.level) continue;
      const what = bad.map(([f, v]) => `${f} ${v} (want ${JSON.stringify(normalize(r.c).want[f] ?? null)}, got ${JSON.stringify(got(r.draft, f))})`).join('; ');
      console.log(`  ${r.level ? `DANGEROUS-${r.level.toUpperCase()} ` : ''}[${r.c.id || r.c.lang}] ${what}${r.danger.length ? ` | ${r.danger.map((d) => d.why).join('; ')}` : ''}  "${r.c.text}"`);
    }
  }
  process.exit(run.cases.dangerous ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
