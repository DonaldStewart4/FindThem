// bench/real-cases-maps.js — the prior, scored on real found places.
//
// For each real case (docs/research/cases-public.csv) whose last-seen AND found points are both
// known to street level: download that town's streets and water around the last-seen point
// (one Overpass request, the app's own first-phase query; cached in bench/.cache/, which is
// git-ignored), run the prior for the time the person was missing, and ask:
//   - how much ground is searched before reaching the place the person was really found,
//     most likely squares first? (the new prior, the ISRID statistics map, distance rings)
//   - is the found place beside water the hazard layer flags?
//
// These cases are never used for calibration. There are only a handful, the points are rounded
// to about 110 m, and news reports lean toward long and fatal searches (docs/research/REPORT.md):
// read the result as a sanity check, not as a score.
// The maps here have no buildings (that is the app's second download), so this is the
// "first map" a user would see.
//
// Run from the project folder (needs the internet; a few minutes):
//   node bench/real-cases-maps.js
// Writes bench/real-cases-maps.json (case ids and numbers only: no coordinates, no sources).

import fs from 'node:fs';
import zlib from 'node:zlib';
import * as engine from '../engine/index.js';
import { replay, gridOriginFor, HAZARD_REACH_M, HAZARD_MIN_CHANCE } from '../engine/grid.js';
import { statsMap } from '../engine/prior.js';
import { latLngToXY } from '../engine/surface.js';
import { fetchOverpass, parseOverpass, DEFAULT_RADIUS_M } from '../data.js';
import { setupStart, areaBefore, ringsMap } from './eval-lib.js';
import { loadCases } from './real-cases.js';

const CACHE = new URL('./.cache/', import.meta.url);
const OUT = new URL('./real-cases-maps.json', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 3) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

async function mapFor(c) {
  const center = gridOriginFor({ lastSeen: c.lastSeen });
  const file = new URL(`${c.case_id}.json.gz`, CACHE);
  if (fs.existsSync(file)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const json = await fetchOverpass(center.lat, center.lng, DEFAULT_RADIUS_M, { attempts: 6, extraHeaders: { 'User-Agent': 'FindThem/0.1 (hackathon prototype; evaluation)' } });
  const osm = parseOverpass(json, center, DEFAULT_RADIUS_M);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(osm)));
  await sleep(4000); // be gentle with the public server
  return osm;
}

const cases = loadCases().filter((c) => ['exact', 'street'].includes(c.location_confidence) && c.lastSeen && c.found);
console.log(`${cases.length} real cases have both points known to street level`);
const scored = [];
const skipped = [];
for (const c of cases) {
  let osm;
  try {
    osm = await mapFor(c);
  } catch (err) {
    skipped.push({ case_id: c.case_id, why: 'map download failed' });
    console.log(`  ${c.case_id}: map download failed (${err.message.slice(0, 60)})`);
    continue;
  }
  if (osm.ways.length < 20) { skipped.push({ case_id: c.case_id, why: 'almost no streets mapped there' }); continue; }
  const area = engine.prepareArea(osm);
  const minutes = Math.max(15, Math.min(720, c.minutes ?? 720)); // the engine simulates at most 12 h
  const caseInput = { lastSeen: c.lastSeen, minutes, direction: null, mobility: 'normal', familiarPlaces: [], seed: 20261122 };
  const pred = replay(area, caseInput, []);
  const { x, y } = latLngToXY(pred.grid.origin, c.found.lat, c.found.lng);
  const col = Math.floor((x + 3200) / 25);
  const row = Math.floor((y + 3200) / 25);
  if (col < 0 || col >= 256 || row < 0 || row >= 256) {
    scored.push({ case_id: c.case_id, setting: c.setting, found_type: c.found_type || null, outcome: c.outcome, distanceKm: c.distanceKm, minutesUsed: minutes, offMap: true, restOfWorld: round(pred.restOfWorld) });
    console.log(`  ${c.case_id}: found ${c.distanceKm} km away, off the 3.2 km map (the prior gave "off the map" ${Math.round(100 * pred.restOfWorld)}%)`);
    continue;
  }
  const cell = row * 256 + col;
  const setup = setupStart(osm, c.lastSeen);
  const stats = statsMap(setup.surface, setup.startCell, c.minutes === null || c.minutes >= 720 ? Infinity : minutes, { stillMissing: false }).grid;
  // The nearest water / creek / wetland square the hazard layer flags, within its reach of the found place.
  const reach = Math.round(HAZARD_REACH_M / 25);
  let hazardNearM = null;
  let hazardScore = 0;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const r = row + dr; const k = col + dc;
      if (r < 0 || r >= 256 || k < 0 || k >= 256) continue;
      const score = pred.grid.hazard[r * 256 + k];
      const d = Math.hypot(dr, dc) * 25;
      if (score >= HAZARD_MIN_CHANCE && d <= HAZARD_REACH_M && (hazardNearM === null || d < hazardNearM)) { hazardNearM = d; hazardScore = score; }
    }
  }
  const anyWaterNear = (() => {
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      const r = row + dr; const k = col + dc;
      if (r >= 0 && r < 256 && k >= 0 && k < 256 && pred.grid.hazardType[r * 256 + k] && Math.hypot(dr, dc) * 25 <= HAZARD_REACH_M) return true;
    }
    return false;
  })();
  const result = {
    case_id: c.case_id, setting: c.setting, found_type: c.found_type || null, outcome: c.outcome, distanceKm: c.distanceKm,
    minutesMissing: c.minutes, minutesUsed: minutes,
    newKm2: round(areaBefore(pred.grid.p, cell)), statsKm2: round(areaBefore(stats, cell)), ringsKm2: round(areaBefore(ringsMap(setup), cell)),
    mappedWaterNear: anyWaterNear, hazardNearM: hazardNearM === null ? null : Math.round(hazardNearM), hazardScore: round(hazardScore),
    restOfWorld: round(pred.restOfWorld), ways: osm.ways.length,
  };
  scored.push(result);
  console.log(`  ${c.case_id} ${c.setting} ${c.found_type || '-'} ${c.outcome}, ${c.distanceKm} km: prior ${result.newKm2} km², statistics map ${result.statsKm2}, rings ${result.ringsKm2}${result.hazardNearM !== null ? `; flagged water ${result.hazardNearM} m from the found place` : result.mappedWaterNear ? '; water mapped nearby but below the flag threshold' : ''}`);
}
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), considered: cases.length, cases: scored, skipped, reachM: HAZARD_REACH_M, minChance: HAZARD_MIN_CHANCE }, null, 1) + '\n');
console.log(`Wrote bench/real-cases-maps.json (${scored.length} scored, ${skipped.length} skipped)`);
