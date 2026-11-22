// tools/make-public-cases.js — makes the PUBLIC copy of the real-case research data.
//
// The research file (docs/research/cases2.csv, or docs/research/cases/cases.csv) cites each
// case's sources as URLs. News URLs often spell out the missing person's name, and this repo
// is public, so that file is git-ignored and must never be committed. This script writes
//
//   docs/research/cases-public.csv     the same rows with `source_urls` replaced by `sources`:
//                                      "<publisher> <case month> [<source id>]", e.g.
//                                      "wfmj.com 2023-07 [S0042]". Safe to commit.
//   docs/research/sources-private.csv  source id → URL. Git-ignored. Whoever holds the research
//                                      file can look a citation up; nobody else can.
//
// It then checks the public file for anything that looks like a URL or a street address with a
// house number, and refuses to finish if it finds any.
//
// Run from the project folder:   node tools/make-public-cases.js [path/to/private.csv]

import fs from 'node:fs';

const CANDIDATES = [process.argv[2], 'docs/research/cases/cases.csv', 'docs/research/cases2.csv'].filter(Boolean);
const input = CANDIDATES.find((p) => fs.existsSync(p) && fs.readFileSync(p, 'utf8').startsWith('case_id,'));
if (!input) throw new Error('No research file found (looked for: ' + CANDIDATES.join(', ') + ')');
const dir = input.includes('/cases/') ? 'docs/research/cases' : 'docs/research';
const OUT_PUBLIC = `${dir}/cases-public.csv`;
const OUT_PRIVATE = `${dir}/sources-private.csv`;

// A small CSV reader and writer (quoted fields, doubled quotes, commas and line breaks inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const toCsv = (rows) => rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';

const rows = parseCsv(fs.readFileSync(input, 'utf8'));
const head = rows[0];
const urlCol = head.indexOf('source_urls');
const monthCol = head.indexOf('year_month');
if (urlCol < 0) throw new Error('No source_urls column in ' + input);

const idOfUrl = new Map(); // URL → source id, in order of first appearance
const publicRows = [head.map((h) => (h === 'source_urls' ? 'sources' : h))];
for (const row of rows.slice(1)) {
  const urls = row[urlCol].split('|').map((u) => u.trim()).filter(Boolean);
  const cited = urls.map((url) => {
    if (!idOfUrl.has(url)) idOfUrl.set(url, 'S' + String(idOfUrl.size + 1).padStart(4, '0'));
    let publisher = 'unknown publisher';
    try { publisher = new URL(url).hostname.replace(/^www\./, ''); } catch { /* not a URL: keep "unknown" */ }
    return `${publisher} ${row[monthCol] || 'undated'} [${idOfUrl.get(url)}]`;
  });
  const out = [...row];
  out[urlCol] = cited.join(' | ');
  publicRows.push(out);
}

// Safety check on what is about to be written.
const publicText = toCsv(publicRows);
const problems = [];
if (/https?:|www\.|\.html?\b|%[0-9A-Fa-f]{2}/.test(publicText)) problems.push('something that looks like a URL');
if (/\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Pl|Place)\b/.test(publicText)) problems.push('something that looks like a house number and street');
for (const url of idOfUrl.keys()) {
  // No piece of a URL's path (where names live) may appear in the public file.
  let path = '';
  try { path = new URL(url).pathname; } catch { path = url; }
  for (const piece of path.split('/').filter((p) => p.length >= 12)) if (publicText.includes(piece)) problems.push('a piece of a source URL');
}
if (problems.length) throw new Error('NOT written: the public file would contain ' + [...new Set(problems)].join(', '));

fs.writeFileSync(OUT_PUBLIC, publicText);
fs.writeFileSync(OUT_PRIVATE, toCsv([['source_id', 'url'], ...[...idOfUrl].map(([url, id]) => [id, url])]));
console.log(`Read ${rows.length - 1} cases from ${input} (${idOfUrl.size} distinct sources)`);
console.log(`Wrote ${OUT_PUBLIC} (public: publisher + month + source id)`);
console.log(`Wrote ${OUT_PRIVATE} (PRIVATE, git-ignored: source id -> URL)`);
