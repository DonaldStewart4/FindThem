// bench/split-blind.js — splits bench/blind-cases.json (Nathan's 120 blind reports) into
// bench/blind-dev.json (60) and bench/blind-test.json (60), with a fixed seed, balanced by
// language and kind. Run once: `node bench/split-blind.js`. Same seed → same split.
//
// Rules for the two halves:
//   blind-dev   may be looked at, to find whole CATEGORIES of problems (never to fix one case)
//   blind-test  is never looked at and never tuned on: it is scored once, at the end, as the
//               honest number. This script prints only counts and case ids, never report text.

import { readFileSync, writeFileSync } from 'node:fs';

const SEED = 20261122;

// mulberry32: a small seeded random number generator (same numbers on every computer).
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function splitBlind(data, seed = SEED) {
  const rand = random(seed);
  const groups = new Map(); // 'lang/kind' → cases, in file order
  for (const c of data.cases) {
    const key = `${c.lang}/${c.expect.kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const dev = [];
  const test = [];
  let extraToDev = true; // groups with an odd count give their extra case to dev and test in turn
  for (const key of [...groups.keys()].sort()) {
    const list = [...groups.get(key)];
    for (let i = list.length - 1; i > 0; i--) { // Fisher–Yates shuffle
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    let half = Math.floor(list.length / 2);
    if (list.length % 2) { if (extraToDev) half += 1; extraToDev = !extraToDev; }
    dev.push(...list.slice(0, half));
    test.push(...list.slice(half));
  }
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  return { dev: dev.sort(byId), test: test.sort(byId) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const data = JSON.parse(readFileSync(new URL('./blind-cases.json', import.meta.url), 'utf8'));
  const { dev, test } = splitBlind(data);
  const header = ({ cases, ...rest }) => rest;
  for (const [name, cases] of [['dev', dev], ['test', test]]) {
    const out = { ...header(data), split: { of: 'blind-cases.json', half: name, seed: SEED, balancedBy: 'lang × kind' }, cases };
    writeFileSync(new URL(`./blind-${name}.json`, import.meta.url), JSON.stringify(out, null, 1) + '\n');
    const count = (f) => Object.entries(cases.reduce((m, c) => ((m[f(c)] = (m[f(c)] || 0) + 1), m), {})).sort().map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`blind-${name}.json: ${cases.length} cases`);
    console.log(`  by language: ${count((c) => c.lang)}`);
    console.log(`  by kind:     ${count((c) => c.expect.kind)}`);
    console.log(`  by danger:   ${count((c) => c.danger)}`);
  }
}
