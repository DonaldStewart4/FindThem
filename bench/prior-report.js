// bench/prior-report.js — turns the numbers from bench/prior-eval.js, tools/calibrate.js and
// tools/browser/budget.mjs into the report: bench/prior-report.md and a self-contained
// bench/prior-report.html with charts (no outside files).
//
// Run:   node bench/prior-report.js
//
// Chart colors are the validated default categorical palette (four slots, checked for
// color-blind separation in light and dark): blue = new prior, orange = rings,
// aqua = ISRID statistics map, yellow = old engine (as its app drew it).

import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const R = read('./prior-results.json');
const CAL = read('../tools/calibration.json');
let PHONE = null;
try { PHONE = read('./phone-budget.json'); } catch { /* optional */ }
let REAL = null; // the real-world check (bench/real-cases.js), if it has been run
try { REAL = read('./real-cases-results.json'); } catch { /* optional */ }

const METHOD_NAMES = { rings: 'Distance rings', stats: 'ISRID statistics map (upper bound)', old: 'Old engine, raw map', oldSmooth: 'Old engine, as the app drew it', new: 'New prior' };
const ORDER = ['rings', 'old', 'oldSmooth', 'new', 'stats'];
const CHART_ORDER = ['rings', 'oldSmooth', 'new', 'stats']; // the raw old map is in the tables only
const TIME_LABEL = (t) => (t === 'end' ? 'where they end up' : `${t} min`);
const quantile = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const median = (xs) => quantile(xs, 0.5);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => `${Math.round(100 * x)}%`;
const f2 = (x) => (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3));
const BUDGETS = [0.25, 0.5, 1, 2];

// ---- Numbers ----------------------------------------------------------------------------------------

const onMap = R.cases.filter((c) => !c.offMap);
const rossmo = (area, extent) => (0.5 - area / extent) / 0.5;

function summary(time) {
  const rows = onMap.filter((c) => c.time === time);
  const all = R.cases.filter((c) => c.time === time);
  const off = all.filter((c) => c.offMap);
  const out = { time, cases: all.length, onMap: rows.length, offMap: off.length, methods: {} };
  for (const m of R.methods) {
    const a = rows.map((c) => c[m]);
    // On the 25 km extent Sava et al. used: a truth off our map is reached by searching the
    // whole map and then outward in rings, for every method alike.
    const r25 = [
      ...a.map((x) => rossmo(x, R.savaKm2)),
      ...off.map((c) => rossmo(Math.min(R.savaKm2, Math.max(R.gridKm2, Math.PI * (c.d / 1000) ** 2)), R.savaKm2)),
    ];
    out.methods[m] = {
      median: median(a), mean: mean(a), total: a.reduce((s, x) => s + x, 0),
      within: BUDGETS.map((b) => a.filter((x) => x <= b).length / a.length),
      R: mean(a.map((x) => rossmo(x, R.gridKm2))), R25: mean(r25),
    };
  }
  return out;
}
const SUM = Object.fromEntries(R.times.map((t) => [t, summary(t)]));

function versus(time, a, b) {
  const rows = onMap.filter((c) => c.time === time);
  let wins = 0; let ties = 0; let losses = 0;
  for (const c of rows) {
    if (c[a] <= R.tieKm2 && c[b] <= R.tieKm2) ties += 1;
    else if (c[a] < c[b]) wins += 1;
    else losses += 1;
  }
  return { wins, ties, losses, winRate: wins / Math.max(1, wins + losses), ratio: median(rows.map((c) => c[b] / Math.max(c[a], 1e-4))) };
}

const DIST_BINS = [[0, 500, 'under 0.5 km'], [500, 1500, '0.5 to 1.5 km'], [1500, 3000, '1.5 to 3 km'], [3000, 1e9, 'over 3 km']];
const byDistance = (time) => DIST_BINS.map(([lo, hi, label]) => {
  const rows = onMap.filter((c) => c.time === time && c.d >= lo && c.d < hi);
  return { label, n: rows.length, ...Object.fromEntries(R.methods.map((m) => [m, rows.length ? median(rows.map((c) => c[m])) : NaN])) };
});
const TYPES = ['structure', 'road', 'linear', 'field', 'water', 'drainage', 'woods', 'brush'];
const byType = (time) => TYPES.map((type) => {
  const rows = onMap.filter((c) => c.time === time && c.type === type);
  return { label: type, n: rows.length, ...Object.fromEntries(R.methods.map((m) => [m, rows.length ? median(rows.map((c) => c[m])) : NaN])) };
}).filter((r) => r.n > 0);

const mm = R.mismatch;
const MIS = {
  n: mm.length,
  rings: median(mm.map((c) => c.rings)),
  new60: median(mm.map((c) => c.new60)), new100: median(mm.map((c) => c.new100)),
  old60: median(mm.map((c) => c.old60)), old100: median(mm.map((c) => c.old100)),
  stats60: median(mm.map((c) => c.stats60)), stats100: median(mm.map((c) => c.stats100)),
  within1: Object.fromEntries(['rings', 'new60', 'new100', 'old60', 'old100', 'stats60', 'stats100'].map((k) => [k, mm.filter((c) => c[k] <= 1).length / mm.length])),
};

const END = SUM.end;
const H60 = SUM[60];
const vsRingsEnd = versus('end', 'new', 'rings');
const vsOldEnd = versus('end', 'new', 'oldSmooth');
const vsRings60 = versus(60, 'new', 'rings');
const vsOld60 = versus(60, 'new', 'oldSmooth');
const check = R.calibrationCheck;
const T = check.targets;

// Rows of the calibration table: [key, label, unit, fitted?]
const CAL_ROWS = [
  ['within300m', 'Found within 0.3 km (ISRID 25%)', '%'], ['within1100m', 'Found within 1.1 km (ISRID 50%)', '%'], ['within3200m', 'Found within 3.2 km (ISRID 75%)', '%'],
  ['structure', 'Found at a structure', '%'], ['road', 'Found on a road', '%'], ['linear', 'Found on a path (linear)', '%'], ['field', 'Found in a field / open ground', '%'],
  ['water', 'Found in water', '%'], ['drainage', 'Found in a drainage', '%'], ['woods', 'Found in woods', '%'], ['brush', 'Found in brush', '%'],
  ['trackOffset25', 'Track offset, 25%', 'm'], ['trackOffset50', 'Track offset, 50%', 'm'], ['trackOffset75', 'Track offset, 75%', 'm'], ['trackOffset95', 'Track offset, 95%', 'm'],
  ['dispersion25', 'Dispersion angle, 25%', '°'], ['dispersion50', 'Dispersion angle, 50%', '°'], ['dispersion75', 'Dispersion angle, 75%', '°'],
  ['mobilityH25', 'Mobility, 25%', 'h'], ['mobilityH50', 'Mobility, 50%', 'h'], ['mobilityH75', 'Mobility, 75%', 'h'], ['mobilityH95', 'Mobility, 95%', 'h'],
  ['within1mile', 'Found within 1 mile (Rowe 2011)', '%'],
];
const fmtStat = (key, v) => (key.startsWith('mobility') ? v.toFixed(2) : v.toFixed(key.startsWith('within') || TYPES.includes(key) ? 1 : 0));
const spotted = check.heldOut['stop: noticed by the public'];
const blend = CAL.blend;
const atLimit = [...CAL.atLimit];
if (blend && (blend.best === 0 || blend.best === 1)) atLimit.push(`BLEND_WALKERS (${blend.best === 0 ? 'low' : 'high'})`);

// ---- The real-world check (161 news-reported cases; never used for calibration) ---------------------

const p0 = (x) => (x === null || x === undefined ? '–' : `${Math.round(100 * x)}%`);
function realSection() {
  if (!REAL) return '';
  const mdTable = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  const TYPES8 = ['structure', 'road', 'linear', 'field', 'water', 'drainage', 'woods', 'brush'];
  const all = REAL.distance[0];
  const urban = REAL.distance.find((d) => d.label === 'Setting: urban');
  const suburban = REAL.distance.find((d) => d.label === 'Setting: suburban');
  const rural = REAL.distance.find((d) => d.label === 'Setting: rural');
  const walkersBins = REAL.modelDistance[2].bins;
  const realUrbanType = REAL.findType.real.find((r) => r.label === 'Setting: urban');
  const realSuburbanType = REAL.findType.real.find((r) => r.label === 'Setting: suburban');
  const realRuralType = REAL.findType.real.find((r) => r.label === 'Setting: rural');
  const hz = REAL.hazard;
  const distanceRows = [
    ...REAL.modelDistance.map((m) => [`**Model:** ${m.label}`, '–', ...m.bins.map(p0), p0(m.bins[0] + m.bins[1]), '–']),
    ...REAL.distance.map((d) => [`Real: ${d.label}`, d.n, ...(d.coarseOnly ? ['(merged)', '(merged)'] : d.bins.slice(0, 2).map(p0)), ...d.bins.slice(2).map(p0), p0(d.bins[0] + d.bins[1]), `${d.q50} km`]),
  ];
  const timeRows = REAL.byTime.filter((b) => b.n).map((b) => [b.label, b.n, `${Math.round(b.medianMinutes / 60)} h`, `${b.real.q25} / ${b.real.q50} / ${b.real.q75}`, `${b.curve.q25} / ${b.curve.q50} / ${b.curve.q75}`, `${b.walkers.q25} / ${b.walkers.q50} / ${b.walkers.q75}${b.medianMinutes > b.walkers.atMinutes ? ' (at the 12 h cap)' : ''}`]);
  const typeRows = [
    ...REAL.findType.model.map((m) => [`**Model:** ${m.label}`, m.n, ...TYPES8.map((t) => p0(m.mix[t]))]),
    ...REAL.findType.real.map((m) => [`Real: ${m.label}`, m.n, ...TYPES8.map((t) => p0(m.mix[t]))]),
  ];
  let maps = '';
  if (REAL.maps && REAL.maps.cases.length) {
    const on = REAL.maps.cases.filter((c) => !c.offMap);
    const off = REAL.maps.cases.filter((c) => c.offMap);
    const med = (k) => f2(median(on.map((c) => c[k])));
    const better = on.filter((c) => c.newKm2 < c.ringsKm2).length;
    const dead = on.filter((c) => c.outcome === 'deceased');
    maps = `
### 5. The prior on the real places (the few cases known to street level)

${REAL.maps.considered} cases have both points located to street level. For each, the town's streets and water were downloaded (the app's first-phase map, no buildings) and the prior was run for the time the person was missing (12 hours at most). ${on.length} found places are on the 3.2 km map; ${off.length} are beyond it${REAL.maps.skipped.length ? `; ${REAL.maps.skipped.length} could not be scored (${[...new Set(REAL.maps.skipped.map((x) => x.why))].join('; ')})` : ''}.

${mdTable(['Case', 'Setting', 'Found at', 'Outcome', 'Distance', 'New prior, km² searched', 'Statistics map', 'Rings', 'Flagged water within 150 m of the found place'],
    REAL.maps.cases.map((c) => [c.case_id, c.setting || '–', c.found_type || '–', c.outcome, `${c.distanceKm} km`, ...(c.offMap ? [`off the map (prior gave "off the map" ${p0(c.restOfWorld)})`, '–', '–', '–'] : [f2(c.newKm2), f2(c.statsKm2), f2(c.ringsKm2), c.hazardNearM !== null ? `yes, ${c.hazardNearM} m` : c.mappedWaterNear ? 'water mapped, below the threshold' : 'no'])]))}

On the ${on.length} cases on the map: median ground searched ${med('newKm2')} km² for the new prior, ${med('statsKm2')} for the statistics map, ${med('ringsKm2')} for rings; the new prior needs less ground than rings in ${better} of ${on.length}.${dead.length ? ` Of the ${dead.length} deaths on the map, ${dead.filter((c) => c.hazardNearM !== null).length} were within 150 m of water the hazard layer flagged.` : ''} ${on.length} cases cannot rank methods; what this shows is whether the map behaves sensibly on real towns it has never seen, and that ${off.length} of ${REAL.maps.cases.length} real found places were beyond a 3.2 km map.
`;
  }
  return `## Real-world check: ${REAL.cases} news-reported cases

**These cases were never used for calibration.** They are ${REAL.cases} resolved cases of people with dementia who left a home or care facility on foot, collected from public news, police and coroner reports with both the last-seen place and the found place described (\`docs/research/cases-public.csv\`; method in \`docs/research/REPORT.md\`). ${REAL.withDistance} have a usable distance, ${REAL.withMinutes} a time missing, ${REAL.withBoth} both. ${REAL.settings.urban} are urban, ${REAL.settings.suburban} suburban, ${REAL.settings.rural} rural (the researcher's judgment).

**Their biases, which shape everything below:**
- **News reports long, dramatic and fatal searches.** ${p0(hz.deceasedShareOfAll)} of these cases ended in death; ISRID's urban table has 6%. Distances and times here lean long, and woods and water are over-represented.
- **Quick nearby finds are missing.** The largest reason candidates were rejected (318 of them) was "found safe nearby" with no place given. Short distances are under-represented.
- Journalists round distances ("about a mile"), and only 14 cases have both points located to street level.
- This is not an urban sample, while the model is tuned to ISRID's urban column.

### 1. Distance from the last-seen point

Bins are cut at the ISRID urban quartile distances, so the ISRID urban curve has 25% in each. Cases located only to a neighborhood (±1–2 km) are shown with the two near bins merged.

${mdTable(['', 'n', 'Within 0.3 km', '0.3 to 1.1 km', '1.1 to 3.2 km', 'Beyond 3.2 km', 'Within 1.1 km (merged)', 'Median'], distanceRows)}

- **Near:** ${p0(all.bins[0])} of real cases are within 0.3 km, against 25% in ISRID and ${p0(walkersBins[0])} for the walkers. That is the direction the missing quick finds would push it, so it is not evidence against the model.
- **Far:** ${p0(all.bins[3])} of real cases are beyond 3.2 km, against 25% in ISRID urban and ${p0(walkersBins[3])} for the walkers. The walkers put too few people far out, by ISRID's own measure and by this one.
- **By setting, the real cases run opposite to what the urban column suggests:** urban cases are the farthest (median ${urban.q50} km, ${p0(urban.bins[3])} beyond 3.2 km, n = ${urban.n}), suburban in between (median ${suburban.q50} km, n = ${suburban.n}), rural the nearest (median ${rural.q50} km, n = ${rural.n}). With n = ${urban.n} and news selection this is weak, but it argues against trusting the map's 3.2 km reach in a city.

### 2. Distance by time missing

Real cases that report both a time and a distance (${REAL.withBoth}), against the model's distance at the bin's median time. "Statistics map" is its rule (the smaller of the ISRID end distance and pace × t); "walkers" are the calibrated walkers on held-out Fremont starts, run for 12 hours at most. Kilometers at 25% / 50% / 75%.

${mdTable(['Time missing', 'n', 'Median time', 'Real cases', 'Model: statistics map', 'Model: walkers'], timeRows)}

Half of the real cases with a time were missing for more than ${Math.round(REAL.minutes.q50 / 60)} hours (25% / 50% / 75%: ${Math.round(REAL.minutes.q25 / 60)} / ${Math.round(REAL.minutes.q50 / 60)} / ${Math.round(REAL.minutes.q75 / 60)} h), far beyond the first hour the app is built for, and only ${REAL.byTime[0].n} are in the first three hours. So this data cannot test the first hour. For the long cases the real distances are larger than the model's, which stops growing once it reaches the ISRID end distances: people found after a day are a selected, farther group, and the model has no way to say "still missing after a day means farther".

### 3. Where people were found

${mdTable(['', 'n', ...TYPES8], typeRows)}

- **Urban real cases match ISRID's urban column:** ${p0(realUrbanType.mix.structure)} at a structure and ${p0(realUrbanType.mix.road)} on a road (n = ${realUrbanType.n}), against 35% and 36%. That supports the column the model is tuned to, for cities.
- **Suburban and rural real cases do not:** woods ${p0(realSuburbanType.mix.woods)} and ${p0(realRuralType.mix.woods)}, water ${p0(realSuburbanType.mix.water)} and ${p0(realRuralType.mix.water)}, structures ${p0(realSuburbanType.mix.structure)} and ${p0(realRuralType.mix.structure)}. Part of that is the news bias (woods and water searches are the ones reported), but the app uses the urban column everywhere, and for a suburb with open land that is probably wrong. ISRID's temperate column is already in \`engine/prior.js\`; choosing the column by setting is the obvious next step.
- The walkers' mix (0% woods, 0% brush) reflects Fremont, where there is almost none of either near the start points.

### 4. Where the deceased were found, against the hazard layer

The hazard layer flags water, creeks and drainage channels, and wetland, where the person is likely to be within ${hz.reachM} m.

${mdTable(['Deceased, by where found (n = ' + hz.typed + ')', ...TYPES8], [['Share', ...TYPES8.map((t) => p0(hz.mix[t]))], ['Flagged by the hazard layer?', ...TYPES8.map((t) => (t === 'water' || t === 'drainage' ? 'yes' : 'no'))]])}

- **${p0(hz.inHazardTypes)} of deaths were in water or a drainage**, the kinds of place the hazard layer flags; among people found alive it is ${p0(hz.aliveInHazardTypes)}. Of all water and drainage finds, ${p0(hz.waterFindsDeceased)} were deaths, against ${p0(hz.otherFindsDeceased)} of finds anywhere else. Flagging water is well aimed.
- **${p0(hz.notCovered.woods)} of deaths were in woods, which the hazard layer does not flag** (brush ${p0(hz.notCovered.brush)}, fields ${p0(hz.notCovered.field)}). Those are exposure deaths, not drownings. A hazard layer that only knows water misses about ${p0(1 - hz.inHazardTypes)} of where the deaths in this data happened.
- **The deceased were found farther out, not nearer:** median ${hz.distance.deceased.q50} km (n = ${hz.distance.deceased.n}) against ${hz.distance.alive.q50} km for those found alive (n = ${hz.distance.alive.n}); ${p0(hz.distance.deceasedWithin800m)} of deaths were within 0.8 km. Rowe et al. (2011) found 50% of deaths within 0.5 mile. The news bias toward long searches may explain the gap; either way, the hazard layer follows the likely area outward rather than assuming deaths are near home, which this data supports.
${maps}
### What the real cases change

- Nothing here was used to tune anything, and the model's numbers above are unchanged by it.
- They support: the urban find-location column for cities; flagging water.
- They question: the 3.2 km map in cities (${p0(urban.bins[3])} of urban cases beyond it); using the urban column for suburbs and open country; a hazard layer without woods and brush; the far tail of the walkers.
- They cannot test: the first hour, which is what the app is for.

`;
}

// ---- Markdown ---------------------------------------------------------------------------------------

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const methodTable = (s) => table(
  ['Method', 'Median km²', ...BUDGETS.map((b) => `Found within ${b} km²`), 'R (our 6.4 km map)', 'R (25 km extent)'],
  ORDER.map((m) => [METHOD_NAMES[m], f2(s.methods[m].median), ...s.methods[m].within.map(pct), s.methods[m].R.toFixed(3), s.methods[m].R25.toFixed(3)]),
);
const splitTable = (rows, first) => table([first, 'Cases', ...ORDER.map((m) => METHOD_NAMES[m])], rows.map((r) => [r.label, r.n, ...ORDER.map((m) => f2(r[m]))]));

const gain = (a, b) => `${Math.round(100 * (1 - a / b))}% less`;
const verdict = [
  `**The new prior reaches the person in less searched ground than the old engine${R.times.every((t) => SUM[t].methods.new.median <= SUM[t].methods.rings.median) ? ' and than distance rings, at every time tested' : ', and than distance rings at most times tested'}.** For where people end up: median ${f2(END.methods.new.median)} km² searched, against ${f2(END.methods.oldSmooth.median)} km² for the old engine as its app drew it (${f2(END.methods.old.median)} km² for its raw map) and ${f2(END.methods.rings.median)} km² for rings. At 60 minutes: ${f2(H60.methods.new.median)} against ${f2(H60.methods.oldSmooth.median)} and ${f2(H60.methods.rings.median)} km².`,
  `**It is close to the upper bound, and that is partly by construction.** The ISRID statistics map scores ${f2(END.methods.stats.median)} km² (end) and ${f2(H60.methods.stats.median)} km² (60 min). It is the recipe that placed the true locations, and the new prior is ${Math.round(100 * (1 - CAL.params.BLEND_WALKERS))}% that map.`,
  `**The evaluation chose a walkers' share of ${CAL.params.BLEND_WALKERS}.**${blend && (blend.best === 0 || blend.best === 1) ? ' That is at the limit of its range.' : ''} With true locations placed from ISRID statistics alone, the walkers add little to a map with no clues. They still decide what a direction, a familiar place, a sighting or a search does to the map, which this evaluation cannot score.`,
  `**Calibration fits the urban distances** (${fmtStat('within300m', check.heldOut.within300m)} / ${fmtStat('within1100m', check.heldOut.within1100m)} / ${fmtStat('within3200m', check.heldOut.within3200m)}% within 0.3 / 1.1 / 3.2 km on held-out starts; ISRID 25 / 50 / 75) **and does not fit the mobility hours**: the model's median is ${check.heldOut.mobilityH50.toFixed(2)} h against ISRID's 0.25 h. Both are reported as they came out.`,
  (() => {
    if (!PHONE) return `**Speed:** a cold replay takes ${R.timing.coldMedianMs} ms on the laptop. The phone budget (under 2,000 ms with the processor slowed four times) was not measured for this report.`;
    const firstHour = PHONE.slowed.filter((r) => /45 min|75 min/.test(r.label)).map((r) => r.coldMs);
    const long = PHONE.slowed.filter((r) => /hours old/.test(r.label));
    const ok = Math.max(...firstHour) < 2000;
    return `**Phone budget (cold replay under 2,000 ms with the processor slowed four times): ${ok ? 'met' : 'NOT met in this run'} for first-hour cases**, ${Math.min(...firstHour)} to ${Math.max(...firstHour)} ms in Chrome for the Demo and for 75-minute cases with 7 searches and 3 sightings.${long.length ? ` Older cases are slower because the walkers have walked longer: ${long.map((r) => `${r.coldMs} ms for ${r.label.replace(', no events', '')}`).join(', ')}.` : ''} These timings move by about ±30% with what else the laptop is doing.`;
  })(),
  ...(REAL ? [(() => {
    const all = REAL.distance[0];
    const urbanT = REAL.findType.real.find((r) => r.label === 'Setting: urban');
    return `**Against ${REAL.cases} real news-reported cases (never used for tuning), the picture is mixed.** Real urban finds match the ISRID urban column the model is tuned to (${Math.round(100 * urbanT.mix.structure)}% structure, ${Math.round(100 * urbanT.mix.road)}% road, n = ${urbanT.n}), and ${Math.round(100 * REAL.hazard.inHazardTypes)}% of deaths were in water or drainage, which the hazard layer flags. But ${Math.round(100 * all.bins[3])}% of real cases were beyond the map's 3.2 km (the walkers say ${Math.round(100 * REAL.modelDistance[2].bins[3])}%), suburban and rural cases look nothing like the urban column, and ${Math.round(100 * REAL.hazard.notCovered.woods)}% of deaths were in woods, which the hazard layer does not flag. The data leans toward long and fatal searches and cannot test the first hour.`;
  })()] : []),
];

const limits = [
  'No real cases. Every "true location" is drawn from published ISRID statistics. The ranking of methods is only as good as that recipe, and the recipe is also half of what is being tested.',
  'The upper bound and the new prior share the recipe. "New prior is close to the upper bound" mostly says the blend leans on the statistics map; it is not independent evidence that the map is right.',
  `ISRID's 95% distance (12.6 km) cannot be tested: the map reaches 3.2 km. ${pct(END.offMap / END.cases)} of end-state truths fall off the map and are excluded from the area numbers (they are in the 25 km R). The model sends ${check.heldOut.leftMap.toFixed(1)}% of walkers off the map.`,
  `The mobility mismatch is real: ISRID's mobility sample (temperate, n = 42) says half stop within 15 minutes; the urban distances (n = 336) need people to keep going far longer at the measured walking speed. We fitted the distances.`,
  'Time-conditioned truths ("t minutes after") use our own rule, the smaller of the ISRID end distance and pace × t. ISRID has no distance-by-time table, so the 15 to 120 minute rows rest on that assumption and on the gait-speed study (people with cognitive impairment, not all diagnosed dementia).',
  'One city. Start points, ground classes and calibration are all Fremont. The dispersion angle (n = 11) and track offset come from non-urban samples.',
  `The spotting rate is identified only through the road-find share and the road-type exposure table, which is our assumption. Track offset below 10 m cannot be resolved on 10 m squares.`,
  'The old engine is scored on a download centered on each start, the best case for it, and both raw and blurred as its app drew it. Direction, familiar places, sightings and searches are not part of this evaluation.',
  'Elevation is not modeled. The sea would be treated as plain ground.',
];

const md = `# Prior v2: evaluation report

Made by \`node bench/prior-eval.js\` and \`node bench/prior-report.js\` on ${R.date.slice(0, 10)}. ${R.starts} held-out Fremont start points (never used in calibration), ${R.truthsPerStart} true locations per start and time, ${R.cases.length} cases in all. True locations are placed from ISRID statistics only, never by our walkers. Score: area searched before reaching the person, most likely squares first (km², lower is better). The charts are in \`bench/prior-report.html\`.

## Verdict

${verdict.map((v) => `- ${v}`).join('\n')}

## Evidence

### Where people end up (no time limit)

${END.onMap} cases on the map, ${END.offMap} off it.

${methodTable(END)}

New prior against rings: ${vsRingsEnd.wins} wins, ${vsRingsEnd.ties} ties, ${vsRingsEnd.losses} losses (wins ${pct(vsRingsEnd.winRate)} of the cases that are not ties; a tie is both within ${R.tieKm2} km²). Total ground searched over all cases: rings ${END.methods.rings.total.toFixed(0)} km², new prior ${END.methods.new.total.toFixed(0)} km² (${gain(END.methods.new.total, END.methods.rings.total)}). Against the old engine as its app drew it: ${vsOldEnd.wins} wins, ${vsOldEnd.ties} ties, ${vsOldEnd.losses} losses; total ${END.methods.oldSmooth.total.toFixed(0)} km² against ${END.methods.new.total.toFixed(0)} km² (${gain(END.methods.new.total, END.methods.oldSmooth.total)}).

**About the two old-engine rows.** The old engine's own 25 m map is 5,000 end points on street lines over an even 2% floor, so about half the true locations sit on a floor square and tie with tens of thousands of others. The old app blurred that map by about 150 m before drawing it. "As the app drew it" applies the same blur and is the fair comparison; the raw row is what the engine's own numbers said.

**About R.** r = (n + m/2) / N and R = (0.5 − r) / 0.5 (Sava, Twardy, Koester, Sonwalkar 2016); 1 is perfect, 0 is a blank map. The first R column is over our own 6.4 km map and only the cases on it. The second is over a 25 × 25 km extent, the one Sava et al. used, and includes the ${END.offMap} cases off our map, for which every method alike must search the whole map and then outward in rings. That is why the methods barely differ there: the score is dominated by the far cases no map of this size can help with. Sava et al. report 0.78 for rings on 376 real cases; our ${END.methods.rings.R25.toFixed(2)} for rings is on simulated cases that follow the ISRID urban curve exactly, so the closeness says the extent and the distance curve are comparable, not that the two tests are the same.

### By time since last seen

${table(['Minutes since last seen', 'Cases on map', ...ORDER.map((m) => `${METHOD_NAMES[m]}, median km²`), 'New prior: share off the map'], R.times.map((t) => [TIME_LABEL(t), SUM[t].onMap, ...ORDER.map((m) => f2(SUM[t].methods[m].median)), pct(R.restOfWorld[t])]))}

${table(['Minutes since last seen', ...ORDER.map((m) => `${METHOD_NAMES[m]}, found within 0.5 km²`)], R.times.map((t) => [TIME_LABEL(t), ...ORDER.map((m) => pct(SUM[t].methods[m].within[1]))]))}

The end-state row has smaller areas than the 120-minute row because ${pct(END.offMap / END.cases)} of end-state truths are beyond the map and left out of it; at 120 minutes almost everyone is still on the map, including those on their way out.

At 60 minutes, new prior against rings: ${vsRings60.wins} wins, ${vsRings60.ties} ties, ${vsRings60.losses} losses; against the old engine as drawn: ${vsOld60.wins} wins, ${vsOld60.ties} ties, ${vsOld60.losses} losses.

### By distance of the true location (end state), median km²

${splitTable(byDistance('end'), 'Distance')}

### By find type (end state), median km²

${splitTable(byType('end'), 'Find type')}

### Mismatch: gone 100 minutes, the app is told 60

${MIS.n} cases with the true location placed for 100 minutes.

${table(['Map', 'Median km²', 'Found within 1 km²'], [
    ['Distance rings', f2(MIS.rings), pct(MIS.within1.rings)],
    ['Old engine as drawn, told 60', f2(MIS.old60), pct(MIS.within1.old60)],
    ['Old engine as drawn, told 100 (correct)', f2(MIS.old100), pct(MIS.within1.old100)],
    ['New prior, told 60', f2(MIS.new60), pct(MIS.within1.new60)],
    ['New prior, told 100 (correct)', f2(MIS.new100), pct(MIS.within1.new100)],
    ['ISRID statistics map, told 60', f2(MIS.stats60), pct(MIS.within1.stats60)],
    ['ISRID statistics map, told 100 (correct)', f2(MIS.stats100), pct(MIS.within1.stats100)],
  ])}

### Stability across seeds

The same case run with two different seeds; overlap of the two hot zones (the smallest set of squares holding 80% of the chance on the map), median over ${R.stability.starts} starts.

${table(['Map', 'At 60 min', 'End state (12 h)'], [
    ['New prior (the blend)', pct(R.stability.blend[60]), pct(R.stability.blend.end)],
    ['Walkers alone (5,000)', pct(R.stability.walkersOnly[60]), pct(R.stability.walkersOnly.end)],
  ])}

### Calibration: target against model

Walkers run for 12 hours with spotting on. "Calibration" = the ${CAL.starts.length} start points the fit used; "held out" = ${check.walkersPerStart} walkers from each of 24 start points it never saw. Score (lower is closer): defaults ${check.scoreDefaults}, calibration starts ${check.scoreCalibration}, held-out starts ${check.scoreHeldOut}.

${table(['Statistic', 'Target', 'Before (defaults)', 'Model, calibration starts', 'Model, held-out starts', 'Fitted?'], CAL_ROWS.map(([key, label, unit]) => [label, `${T[key]}${unit === '%' || unit === '°' ? '' : ' '}${unit}`, fmtStat(key, check.defaults[key]), fmtStat(key, check.onCalibration[key]), fmtStat(key, check.heldOut[key]), check.weights[key] ? `yes, weight ${check.weights[key]}` : 'no, check only']))}

Elevation (temperate: 19% up, 42% down, 39% same) is not modeled.

Why walkers stopped (held-out starts): ${Object.entries(check.heldOut).filter(([k, v]) => k.startsWith('stop: ') && v > 0.05).map(([k, v]) => `${k.slice(6)} ${v.toFixed(1)}%`).join(', ')}.

### The spotting rate, fitted jointly

One rate does two jobs. Fitted value: **${R.stillMissing.ratePerMinute} per minute on a main road** (scaled down by road type).

1. **It produces the road finds.** A walker that stops walking steps off the road, so "found on a road or path" only happens by being noticed. Model: road ${check.heldOut.road.toFixed(1)}% (ISRID 36%), path ${check.heldOut.linear.toFixed(1)}% (ISRID 9%); ${spotted.toFixed(1)}% of all walkers end by being noticed.
2. **It explains "still missing".** The weight left on a walker who has spent the time on that kind of road:

${table(['Road', 'After 10 min', 'After 30 min', 'After 60 min'], R.stillMissing.weightLeft.map((r) => [r.road, r.after10, r.after30, r.after60]))}

### Mobility: the mismatch, as it is

${table(['', '25%', '50%', '75%', '95%'], [
    ['ISRID mobility hours (temperate, n = 42)', T.mobilityH25, T.mobilityH50, T.mobilityH75, T.mobilityH95],
    ['Model, held-out starts (hours until the walker stops)', ...['mobilityH25', 'mobilityH50', 'mobilityH75', 'mobilityH95'].map((k) => check.heldOut[k].toFixed(2))],
  ])}

(The model's 95% value is 12 h because the walkers are simulated for 12 hours.) At 0.62 m/s, moving 60% of the time, 15 minutes covers about 330 m of path. ISRID's urban median distance is 1,100 m in a straight line. The two samples cannot both hold for one population at that speed. Distance has 336 cases and is what a search plan is drawn from, so it is the fitted target; mobility is shown, not fitted, and not adjusted to look closer.

### The blend, chosen by evaluation

On the ${CAL.starts.length} calibration start points (not the held-out ones), ${blend.cases} true locations at 30, 60 and 120 minutes and the end state. Typical area searched (geometric mean, km²) for each share given to the walkers:

${table(['Walkers\' share', ...blend.curve.filter((_, i) => i % 2 === 0).map((p) => p.blend.toFixed(1))], [['km²', ...blend.curve.filter((_, i) => i % 2 === 0).map((p) => p.typicalAreaKm2.toFixed(3))]])}

Best: **${blend.best}**.${blend.best === 0 || blend.best === 1 ? ' At its limit.' : ''} The curve is nearly flat from 0 to 0.1 and rises steadily after that; walkers alone (1.0) are the worst choice by a wide margin.

What this does and does not say: with no clues, on true locations drawn from the ISRID recipe, the recipe's own map is hard to beat, and 5,000 walkers add sampling noise to it. It does not say the walkers are useless: they are what a search or a sighting re-weighs in time order, and when a case lists familiar places a further ${Math.round(100 * R.params.SHARE_GOAL)}% of the map goes to walkers heading there (\`SHARE_GOAL\`, an assumption this evaluation cannot score, because ISRID has no number for it).

### Numbers that ended at a limit

${atLimit.length ? atLimit.map((a) => `- ${a}`).join('\n') : 'None.'}

### Fitted numbers

${table(['Number', 'Default', 'Fitted', 'Allowed range', 'At a limit?'], CAL.knobs.map((k) => [`\`${k.name}\``, k.default, k.fitted, `${k.low} to ${k.high}`, k.atLimit ? `**${k.atLimit}**` : 'no']))}

Walker kinds as fitted: keeps a course ${pct(CAL.params.SHARE_DIRECTION)}, wanders ${pct(CAL.params.SHARE_WANDER)}, stays near a structure ${pct(CAL.params.SHARE_STAYER)}. ${CAL.settingsTried} settings tried in ${Math.round(CAL.seconds)} s.

### Sensitivity

One number changed at a time, ±50% (DATA numbers ±20%), kept inside its range; everything else as fitted. Fitted score ${R.sensitivity.baseScore}.

${table(['Number', 'Kind', 'Score if lower', 'Score if higher', 'Moves most (lower)', 'Moves most (higher)'], R.sensitivity.rows.map((r) => [`\`${r.name}\``, r.kind, `${r.lower.score} (${r.lower.change >= 0 ? '+' : ''}${r.lower.change})`, `${r.higher.score} (${r.higher.change >= 0 ? '+' : ''}${r.higher.change})`, r.lower.moved, r.higher.moved]))}

### Time and memory

${table(['Measure', 'Value'], [
    ['Cold replay, laptop (median over the held-out starts, at 60 min)', `${R.timing.coldMedianMs} ms (slowest ${R.timing.coldMaxMs} ms)`],
    ['5-minute clock tick, laptop', `${R.timing.clockTickMedianMs} ms; ${R.timing.blockTickMedianMs} ms for the one tick in three that starts a new 15-minute block of walking`],
    ...(PHONE ? [
      ...PHONE.slowed.map((r) => [`Chrome, processor slowed 4×: ${r.label}`, `${r.coldMs} ms cold; ${r.tickMs} ms for the next clock tick (one that starts a new block of walking, except at the 12 h cap)`]),
      ...PHONE.normal.map((r) => [`Chrome, unslowed: ${r.label}`, `${r.coldMs} ms cold`]),
    ] : []),
    ['Memory per walker-minute', '4 bytes (a 16-bit map square and a 16-bit exposure total)'],
    ['Walkers, a case at 45 min / 2 h / the 12 h cap', '2.2 MB / 3.4 MB / 15.4 MB'],
    ['Ground map; one familiar-place field', '1.6 MB; 1.6 MB'],
    ['Map data in memory (the Demo\'s 6.9 MB file)', 'about 23 MB, plus about 29 MB for the street network; twice that with the worker\'s copy'],
  ])}

${realSection()}## Honest limits

${limits.map((l) => `- ${l}`).join('\n')}

## Reproduce

\`\`\`bash
node tools/calibrate.js            # about 10 minutes; writes engine/calibrated.json and .js
node bench/prior-eval.js           # about 6 minutes; writes bench/prior-results.json
node bench/real-cases.js           # the real-world check (reads docs/research/cases-public.csv)
node bench/real-cases-maps.js      # optional, needs the internet: the prior on real found places
node bench/prior-report.js         # writes this file and bench/prior-report.html
node --expose-gc bench/phone-budget.js      # time and memory in Node
node tools/browser/budget.mjs      # time in Chrome slowed 4x (see tools/browser/README.md)
\`\`\`
`;
fs.writeFileSync(new URL('./prior-report.md', import.meta.url), md);

// ---- HTML -------------------------------------------------------------------------------------------

// Share of cases found within each area, for the "found by area searched" curves.
const curve = (time) => {
  const rows = onMap.filter((c) => c.time === time);
  const xs = Array.from({ length: 61 }, (_, i) => 10 ** (-3 + (i * (Math.log10(R.gridKm2) + 3)) / 60));
  return { xs, series: Object.fromEntries(R.methods.map((m) => [m, xs.map((x) => rows.filter((c) => c[m] <= x).length / rows.length)])) };
};
const DATA = {
  names: METHOD_NAMES, order: CHART_ORDER, times: R.times.map(TIME_LABEL),
  curves: { end: curve('end'), h60: curve(60) },
  medianByTime: Object.fromEntries(R.methods.map((m) => [m, R.times.map((t) => SUM[t].methods[m].median)])),
  shares: CAL_ROWS.filter(([key]) => check.weights[key] && (key.startsWith('within') || TYPES.includes(key))).map(([key, label]) => ({ label, target: T[key], model: check.heldOut[key] })),
  blend: blend.curve.map((p) => ({ x: p.blend, y: p.typicalAreaKm2 })), blendBest: blend.best,
  sensitivity: R.sensitivity.rows.slice(0, 14).map((r) => ({ name: r.name + (r.kind === 'DATA' ? ' (DATA)' : ''), lower: r.lower.change, higher: r.higher.change })),
  types: byType('end'),
  real: REAL ? {
    bins: REAL.bins,
    isrid: REAL.modelDistance[0].bins, walkers: REAL.modelDistance[2].bins, all: REAL.distance[0].bins, nAll: REAL.distance[0].n,
    types: ['structure', 'road', 'linear', 'field', 'water', 'drainage', 'woods', 'brush'].map((t) => ({ label: t, isrid: REAL.findType.model[0].mix[t], real: REAL.findType.real[0].mix[t], dead: REAL.findType.real[2].mix[t] })),
    nTypes: REAL.findType.real[0].n, nDead: REAL.findType.real[2].n,
  } : null,
};

const mdToHtml = (text) => {
  // Just enough Markdown for this report: headings, tables, lists, paragraphs, bold, code.
  const inline = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) { const code = []; i++; while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]); out.push(`<pre>${code.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`); continue; }
    if (/^#{1,3} /.test(line)) { const level = line.indexOf(' '); out.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`); continue; }
    if (line.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]); i--;
      const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
      out.push(`<div class="scroll"><table><thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line); const items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, '')); i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('\n');
};

// Charts go right after these headings.
const CHART_AFTER = {
  'Where people end up (no time limit)': '<figure><div class="chart" id="c-end"></div><figcaption>Share of cases reached, by area searched (end state). Higher and further left is better. Log scale.</figcaption></figure>',
  'By time since last seen': '<figure><div class="chart" id="c-h60"></div><figcaption>The same curves for true locations 60 minutes after last seen.</figcaption></figure><figure><div class="chart" id="c-time"></div><figcaption>Median area searched before reaching the person, by time since last seen. Log scale.</figcaption></figure>',
  'By find type (end state), median km²': '<figure><div class="chart" id="c-type"></div><figcaption>Median area searched by find type (end state): rings against the new prior.</figcaption></figure>',
  'Calibration: target against model': '<figure><div class="chart" id="c-cal"></div><figcaption>The fitted shares on held-out starts: ISRID target against the model, in percent.</figcaption></figure>',
  'The blend, chosen by evaluation': '<figure><div class="chart" id="c-blend"></div><figcaption>Typical area searched for each share of the map given to the walkers (0 = statistics map only, 1 = walkers only).</figcaption></figure>',
  '1. Distance from the last-seen point': '<figure><div class="chart" id="c-real-dist"></div><figcaption>Share of people in each distance bin: the ISRID urban curve, the calibrated walkers, and the real cases with a distance.</figcaption></figure>',
  '3. Where people were found': '<figure><div class="chart" id="c-real-type"></div><figcaption>Where people were found: ISRID urban (the calibration target), all real cases, and the real cases that ended in death.</figcaption></figure>',
  Sensitivity: '<figure><div class="chart" id="c-sens"></div><figcaption>Change in the calibration score when one number is made lower or higher (right = a worse fit). The 14 that matter most.</figcaption></figure>',
};
let body = mdToHtml(md);
for (const [heading, chart] of Object.entries(CHART_AFTER)) body = body.replace(`<h3>${heading}</h3>`, `<h3>${heading}</h3>\n${chart}`);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FindThem prior v2: evaluation report</title>
<style>
  :root {
    color-scheme: light;
    --surface: #fcfcfb; --surface-2: #f3f2ee; --text: #0b0b0b; --text-2: #52514e; --text-3: #7a7973; --grid: #e1e0d9; --axis: #c3c2b7;
    --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --neutral: #a9a89f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --surface: #1a1a19; --surface-2: #242423; --text: #f0efec; --text-2: #c3c2b7; --text-3: #8f8e86; --grid: #383835; --axis: #52514e;
      --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --neutral: #6f6e68;
    }
  }
  body { margin: 0; background: var(--surface); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 24px 18px 80px; }
  h1 { font-size: 1.7rem; margin: 0 0 8px; } h2 { font-size: 1.3rem; margin: 36px 0 8px; padding-top: 12px; border-top: 1px solid var(--grid); } h3 { font-size: 1.05rem; margin: 28px 0 6px; }
  p, li { color: var(--text); } p { margin: 8px 0; } li { margin: 6px 0; }
  code, pre { font: 13px ui-monospace, Menlo, Consolas, monospace; } code { background: var(--surface-2); padding: 1px 4px; border-radius: 3px; }
  pre { background: var(--surface-2); padding: 12px; border-radius: 6px; overflow-x: auto; }
  .scroll { overflow-x: auto; margin: 10px 0; }
  table { border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--grid); vertical-align: top; }
  th { color: var(--text-2); font-weight: 600; } td:not(:first-child), th:not(:first-child) { text-align: right; }
  figure { margin: 14px 0 20px; } figcaption { color: var(--text-2); font-size: 13.5px; margin-top: 4px; }
  .chart { position: relative; } .chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--text-2); margin: 0 0 4px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; } .legend i { width: 14px; height: 3px; border-radius: 2px; display: inline-block; } .legend i.box { height: 10px; width: 10px; }
  .tip { position: absolute; pointer-events: none; background: var(--surface); color: var(--text); border: 1px solid var(--axis); border-radius: 6px; padding: 6px 9px; font-size: 12.5px; line-height: 1.4; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.12); display: none; z-index: 2; }
  .tip b { font-weight: 600; } .tip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  text { fill: var(--text-2); font: 12px system-ui, -apple-system, "Segoe UI", sans-serif; } text.lab { fill: var(--text); }
</style>
</head>
<body>
<main>
${body}
</main>
<script>
const D = ${JSON.stringify(DATA)};
const COLOR = { new: 'var(--s1)', rings: 'var(--s2)', stats: 'var(--s3)', oldSmooth: 'var(--s4)' };
const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const fmt = (x) => (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3));
function frame(id, { legend, height = 300, left = 52, right = 16, top = 10, bottom = 40 }) {
  const host = document.getElementById(id);
  if (legend) { const l = document.createElement('div'); l.className = 'legend'; l.innerHTML = legend.map((s) => '<span><i class="' + (s.box ? 'box' : '') + '" style="background:' + s.color + '"></i>' + s.name + '</span>').join(''); host.appendChild(l); }
  const W = 860; const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + height, role: 'img' }); host.appendChild(svg);
  const tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip);
  const show = (evt, htmlText) => { const box = host.getBoundingClientRect(); tip.innerHTML = htmlText; tip.style.display = 'block'; const x = evt.clientX - box.left + 14; tip.style.left = Math.min(x, box.width - tip.offsetWidth - 4) + 'px'; tip.style.top = (evt.clientY - box.top - tip.offsetHeight - 10) + 'px'; };
  const hide = () => { tip.style.display = 'none'; };
  return { svg, W, H: height, left, right, top, bottom, pw: W - left - right, ph: height - top - bottom, show, hide };
}
// A line chart. series: [{ key, name, ys }], xs shared. Hover shows every series at the nearest x.
function lines(id, { xs, series, xLog, yLog, xTicks, yTicks, xLabel, yLabel, xFmt, yFmt, endLabels, height }) {
  const f = frame(id, { legend: series.map((s) => ({ name: s.name, color: COLOR[s.key] })), height, left: 70, right: endLabels ? 64 : 16 });
  const tx = (v) => (xLog ? Math.log10(v) : v); const ty = (v) => (yLog ? Math.log10(v) : v);
  const x0 = tx(xs[0]); const x1 = tx(xs[xs.length - 1]);
  const all = series.flatMap((s) => s.ys); const y0 = ty(yTicks[0]); const y1 = ty(yTicks[yTicks.length - 1]);
  const X = (v) => f.left + ((tx(v) - x0) / (x1 - x0)) * f.pw; const Y = (v) => f.top + f.ph - ((ty(v) - y0) / (y1 - y0)) * f.ph;
  for (const t of yTicks) { el('line', { x1: f.left, x2: f.left + f.pw, y1: Y(t), y2: Y(t), stroke: 'var(--grid)', 'stroke-width': 1 }, f.svg); el('text', { x: f.left - 8, y: Y(t) + 4, 'text-anchor': 'end' }, f.svg).textContent = yFmt(t); }
  for (const t of xTicks) el('text', { x: X(t.v !== undefined ? t.v : t), y: f.top + f.ph + 18, 'text-anchor': 'middle' }, f.svg).textContent = t.label !== undefined ? t.label : xFmt(t);
  el('line', { x1: f.left, x2: f.left + f.pw, y1: f.top + f.ph, y2: f.top + f.ph, stroke: 'var(--axis)', 'stroke-width': 1 }, f.svg);
  if (xLabel) el('text', { x: f.left + f.pw / 2, y: f.H - 4, 'text-anchor': 'middle' }, f.svg).textContent = xLabel;
  if (yLabel) el('text', { x: 12, y: f.top + f.ph / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (f.top + f.ph / 2) + ')' }, f.svg).textContent = yLabel;
  for (const s of series) {
    el('path', { d: s.ys.map((v, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(Math.max(v, yLog ? yTicks[0] : v)).toFixed(1)).join(''), fill: 'none', stroke: COLOR[s.key], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.svg);
    if (endLabels) { const last = s.ys[s.ys.length - 1]; el('circle', { cx: X(xs[xs.length - 1]), cy: Y(last), r: 4, fill: COLOR[s.key], stroke: 'var(--surface)', 'stroke-width': 2 }, f.svg); }
  }
  if (endLabels) {
    // Values at the line ends, moved apart where two lines end close together.
    const ends = series.map((s) => ({ v: s.ys[s.ys.length - 1], y: Y(s.ys[s.ys.length - 1]) + 4 })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) el('text', { x: X(xs[xs.length - 1]) + 9, y: e.y, class: 'lab' }, f.svg).textContent = fmt(e.v);
  }
  const cross = el('line', { y1: f.top, y2: f.top + f.ph, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, f.svg);
  const hit = el('rect', { x: f.left, y: f.top, width: f.pw, height: f.ph, fill: 'transparent' }, f.svg);
  hit.addEventListener('mousemove', (evt) => {
    const box = f.svg.getBoundingClientRect(); const px = ((evt.clientX - box.left) / box.width) * f.W;
    let best = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(X(xs[i]) - px) < Math.abs(X(xs[best]) - px)) best = i;
    cross.setAttribute('x1', X(xs[best])); cross.setAttribute('x2', X(xs[best])); cross.setAttribute('visibility', 'visible');
    f.show(evt, '<b>' + xFmt(xs[best], true) + '</b><br>' + series.map((s) => '<i style="background:' + COLOR[s.key] + '"></i>' + s.name + ': ' + yFmt(s.ys[best], true)).join('<br>'));
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); f.hide(); });
}
// Horizontal bars in groups: rows [{ label, values: [{ name, color, v }] }].
function bars(id, { rows, max, min = 0, fmtV, legend, xLabel, zero }) {
  const rowH = 16 * rows[0].values.length + 12;
  const f = frame(id, { legend, height: rows.length * rowH + 44, left: 200, right: 110, top: 6, bottom: 36 });
  const X = (v) => f.left + ((v - min) / (max - min)) * f.pw;
  const ticks = 5; for (let i = 0; i <= ticks; i++) { const v = min + ((max - min) * i) / ticks; el('line', { x1: X(v), x2: X(v), y1: f.top, y2: f.top + f.ph, stroke: 'var(--grid)', 'stroke-width': 1 }, f.svg); el('text', { x: X(v), y: f.top + f.ph + 16, 'text-anchor': 'middle' }, f.svg).textContent = fmtV(v); }
  if (xLabel) el('text', { x: f.left + f.pw / 2, y: f.H - 2, 'text-anchor': 'middle' }, f.svg).textContent = xLabel;
  const base = X(zero ? 0 : min);
  rows.forEach((row, i) => {
    const y = f.top + i * rowH + 6;
    el('text', { x: f.left - 10, y: y + (rowH - 12) / 2 + 4, 'text-anchor': 'end', class: 'lab' }, f.svg).textContent = row.label;
    row.values.forEach((b, j) => {
      const shown = Math.max(min, Math.min(max, b.v)); const clipped = shown !== b.v;
      const x = Math.min(base, X(shown)); const w = Math.max(1, Math.abs(X(shown) - base)); const by = y + j * 16;
      const r = Math.min(4, w / 2); const right = b.v >= (zero ? 0 : min);
      // Rounded at the data end only, square at the baseline.
      const d = right ? 'M' + x + ' ' + by + 'h' + (w - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (12 - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + (-r) + ' ' + r + 'h' + (-(w - r)) + 'z'
        : 'M' + (x + w) + ' ' + by + 'h' + (-(w - r)) + 'a' + r + ' ' + r + ' 0 0 0 ' + (-r) + ' ' + r + 'v' + (12 - 2 * r) + 'a' + r + ' ' + r + ' 0 0 0 ' + r + ' ' + r + 'h' + (w - r) + 'z';
      const bar = el('path', { d, fill: b.color }, f.svg);
      el('text', { x: right ? X(shown) + 6 : X(shown) - 6, y: by + 10, 'text-anchor': right ? 'start' : 'end' }, f.svg).textContent = fmtV(b.v, true) + (clipped ? ' (off the scale)' : '');
      const hit = el('rect', { x: f.left, y: by - 2, width: f.pw, height: 16, fill: 'transparent' }, f.svg);
      hit.addEventListener('mousemove', (evt) => f.show(evt, '<b>' + row.label + '</b><br><i style="background:' + b.color + '"></i>' + b.name + ': ' + fmtV(b.v, true)));
      hit.addEventListener('mouseleave', f.hide);
      void bar;
    });
  });
  if (zero) el('line', { x1: base, x2: base, y1: f.top, y2: f.top + f.ph, stroke: 'var(--axis)', 'stroke-width': 1 }, f.svg);
}
const pctFmt = (v) => Math.round(100 * v) + '%';
const areaTicks = [0.001, 0.01, 0.1, 1, 10];
for (const [id, c] of [['c-end', D.curves.end], ['c-h60', D.curves.h60]]) {
  lines(id, { xs: c.xs, series: D.order.map((k) => ({ key: k, name: D.names[k], ys: c.series[k] })), xLog: true, xTicks: areaTicks, yTicks: [0, 0.25, 0.5, 0.75, 1],
    xLabel: 'Area searched before reaching the person (km², log scale)', yLabel: 'Cases reached', xFmt: (v, tip) => (tip ? fmt(v) + ' km²' : String(v)), yFmt: pctFmt });
}
lines('c-time', { xs: [0, 1, 2, 3, 4], series: D.order.map((k) => ({ key: k, name: D.names[k], ys: D.medianByTime[k] })), yLog: true, endLabels: true,
  xTicks: D.times.map((label, i) => ({ v: i, label })), yTicks: [0.1, 1, 10], xLabel: 'Time since last seen', yLabel: 'Median km² searched', height: 280,
  xFmt: (v) => D.times[v], yFmt: (v, tip) => (tip ? fmt(v) + ' km²' : v >= 1 ? String(+v.toFixed(2)) : v.toFixed(v < 0.1 ? 3 : 2)) });
bars('c-type', { rows: D.types.map((t) => ({ label: t.label + ' (' + t.n + ')', values: [{ name: D.names.rings, color: COLOR.rings, v: t.rings }, { name: D.names.new, color: COLOR.new, v: t.new }] })),
  max: Math.max(...D.types.map((t) => Math.max(t.rings, t.new))) * 1.08, fmtV: (v, tip) => (tip ? fmt(v) + ' km²' : fmt(v)), xLabel: 'Median km² searched',
  legend: [{ name: D.names.rings, color: COLOR.rings, box: true }, { name: D.names.new, color: COLOR.new, box: true }] });
bars('c-cal', { rows: D.shares.map((s) => ({ label: s.label, values: [{ name: 'ISRID target', color: 'var(--neutral)', v: s.target }, { name: 'Model, held-out starts', color: COLOR.new, v: s.model }] })),
  max: 85, fmtV: (v, tip) => (tip ? v.toFixed(1) + '%' : Math.round(v) + '%'), legend: [{ name: 'ISRID target', color: 'var(--neutral)', box: true }, { name: 'Model, held-out starts', color: COLOR.new, box: true }] });
{
  const ys = D.blend.map((p) => p.y); const lo = Math.min(...ys); const hi = Math.max(...ys);
  const step = (hi - lo) / 4 || 1; const yTicks = [0, 1, 2, 3, 4].map((i) => lo + i * step);
  lines('c-blend', { xs: D.blend.map((p) => p.x), series: [{ key: 'new', name: 'Typical area searched (km²); best at a walkers\\' share of ' + D.blendBest, ys }], xTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], yTicks,
    xLabel: 'Walkers\\' share of the map', yLabel: 'km² (geometric mean)', xFmt: (v, tip) => (tip ? 'walkers\\' share ' + v.toFixed(2) : v.toFixed(1)), yFmt: (v) => fmt(v), height: 260 });
}
if (D.real) {
  const pc = (v, tip) => (tip ? (100 * v).toFixed(0) + '%' : Math.round(100 * v) + '%');
  bars('c-real-dist', { rows: D.real.bins.map((label, i) => ({ label, values: [
    { name: 'ISRID urban curve', color: 'var(--neutral)', v: D.real.isrid[i] }, { name: 'Calibrated walkers', color: COLOR.new, v: D.real.walkers[i] }, { name: 'Real cases (n = ' + D.real.nAll + ')', color: COLOR.rings, v: D.real.all[i] }] })),
    max: 0.5, fmtV: pc, legend: [{ name: 'ISRID urban curve', color: 'var(--neutral)', box: true }, { name: 'Calibrated walkers', color: COLOR.new, box: true }, { name: 'Real cases (n = ' + D.real.nAll + ')', color: COLOR.rings, box: true }] });
  bars('c-real-type', { rows: D.real.types.map((t) => ({ label: t.label, values: [
    { name: 'ISRID urban', color: 'var(--neutral)', v: t.isrid }, { name: 'Real cases (n = ' + D.real.nTypes + ')', color: COLOR.rings, v: t.real }, { name: 'Real cases, deceased (n = ' + D.real.nDead + ')', color: COLOR.stats, v: t.dead }] })),
    max: 0.45, fmtV: pc, legend: [{ name: 'ISRID urban', color: 'var(--neutral)', box: true }, { name: 'Real cases (n = ' + D.real.nTypes + ')', color: COLOR.rings, box: true }, { name: 'Real cases, deceased (n = ' + D.real.nDead + ')', color: COLOR.stats, box: true }] });
}
{
  // Scale to the second-largest change, so one runaway bar doesn't flatten the rest.
  const sizes = D.sensitivity.flatMap((s) => [Math.abs(s.lower), Math.abs(s.higher)]).sort((a, b) => b - a);
  const m = [1, 2.5, 5, 10, 20, 50].find((v) => v >= (sizes[1] || sizes[0] || 1)) || sizes[0];
  bars('c-sens', { rows: D.sensitivity.map((s) => ({ label: s.name, values: [{ name: 'number lower', color: COLOR.new, v: s.lower }, { name: 'number higher', color: COLOR.rings, v: s.higher }] })),
    min: -m, max: m, zero: true, fmtV: (v, tip) => (v > 0 ? '+' : '') + (tip ? v.toFixed(2) : String(+v.toFixed(1))), xLabel: 'Change in score (right = worse fit)',
    legend: [{ name: 'number lower', color: COLOR.new, box: true }, { name: 'number higher', color: COLOR.rings, box: true }] });
}
</script>
</body>
</html>
`;
fs.writeFileSync(new URL('./prior-report.html', import.meta.url), html);
console.log('Wrote bench/prior-report.md and bench/prior-report.html');
console.log('\n' + verdict.map((v) => '- ' + v.replace(/\*\*/g, '')).join('\n'));
