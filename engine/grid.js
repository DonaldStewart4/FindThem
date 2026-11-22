// engine/grid.js — the probability map and Bayesian search theory.
//
// 1. Prior, for "t minutes since last seen": a BLEND of two maps on a grid of 25 m squares.
//      - where the simulated walkers (sim.js) are at minute t. A walker that would have spent
//        long on busy roads counts for less, because the person is STILL MISSING: on a busy
//        road someone would probably have noticed them by now.
//      - the ISRID statistics map (prior.js): the published distances and find locations.
//    Whatever lies beyond the map's edge is "rest of world" (Prediction.restOfWorld), so the
//    map plus rest of world always sums to 1.
// 2. Searched, nobody found: every walker that was inside that area AT THE TIME OF THE SEARCH
//    counts for less, by how likely searchers were to spot the person there (probability of
//    detection, POD = 1 − e^(−coverage), Koopman's formula). Everything else rises (Bayes' rule).
// 3. Sighting: new walkers start from where the person was seen and walk for as long as it has
//    been since then (so a sighting spreads out as the clock runs). They are blended in by how
//    sure the reporter is. Searches made BEFORE the sighting don't count against it: the person
//    arrived afterwards.
// 4. Next areas: the 200 m sectors where the next searcher's minutes add the most chance of
//    finding the person.
// 5. Top spots: the most likely places, with the nearest creek / park and named street.
// 6. A second layer, "where it's dangerous": water, creeks and wetland in or beside the likely
//    area (grid.hazard). Hazard flags come from this layer, not from where walkers ended.
//
// The grid is anchored to the CASE (its grid origin), not to the map download a phone holds, so
// every phone on a shared search means the same ground by the same sector id.
//
// Exports (INTERFACES.md section 2): replay, cellToLatLng, nextSectors, topSpots,
// plus podForMinutes and sectorBoundsXY used by routes.js and the tests.

import { simulate, compassToDegrees, costToGoal, STOP } from './sim.js';
import { statsMap, ringProbability } from './prior.js';
import { nearestTrap, toXY } from './graph.js';
import { PARAMS } from './params.js';
import {
  surfaceFor, cellAt, snapToNetwork, xyToLatLng, latLngToXY, C, CLASS_NAMES,
  SURFACE_N, SURFACE_CELL_M, SURFACE_RADIUS_M,
} from './surface.js';

// ---- Tunable numbers --------------------------------------------------------------------------

export const CELL_SIZE_M = 25;      // ASSUMPTION: squares of the probability map
export const GRID_RADIUS_M = SURFACE_RADIUS_M; // the grid covers this far from the grid origin
export const SECTOR_CELLS = 8;      // ASSUMPTION: a sector is 8 × 8 squares = 200 m × 200 m,
                                    // about what one volunteer covers in 20 minutes
// The grid origin, when the case doesn't carry one, is the last-seen point rounded to this many
// decimals of a degree (3 → about 100 m). Rounding makes it a short, exact number that every
// phone works out identically from the shared last-seen point.
export const GRID_ORIGIN_DECIMALS = 3; // ASSUMPTION
// Searching: a volunteer walks SEARCH_SPEED_MPS and spots a person within SWEEP_WIDTH_M / 2
// either side. coverage = speed × seconds × sweep width ÷ sector area; POD = 1 − e^(−coverage)
// (Koopman; Koester, Cooper, Frost & Robe 2004, DTIC ADA511593).
// Measured sweep widths for an adult-sized target in forest and wildland run from 16 m (low
// visibility) to 142 m (same report, table 11-3). No urban figure was found, and houses and
// fences block more than trees do, so we keep a value at the low end.
export const SEARCH_SPEED_MPS = 0.8; // ASSUMPTION: a slow, looking-around walk
export const SWEEP_WIDTH_M = 20;     // ASSUMPTION (see above)
// A sighting reported "0 minutes ago" still spreads walkers a little from that point.
export const SIGHTING_MIN_MINUTES = 5; // ASSUMPTION
// Top spots: how far apart two spots must be, and how far around a spot counts toward it.
export const SPOT_SEPARATION_M = 150;  // ASSUMPTION
export const SPOT_RADIUS_M = 75;       // ASSUMPTION
export const SPOT_TRAP_SEARCH_M = 50;  // ASSUMPTION
export const HAZARD_TYPES = ['creek', 'river', 'water', 'wetland'];
// The hazard layer: a water / creek / wetland square is scored by the chance of the person
// being within HAZARD_REACH_M of it. A sector or spot is flagged when that score reaches
// HAZARD_MIN_CHANCE. Rowe et al. 2011: deaths "most commonly occurred in unpopulated areas due
// to exposure and drowning", half of them within 0.5 mile of where the person was last seen.
export const HAZARD_REACH_M = 150;       // ASSUMPTION: about a two-minute walk
export const HAZARD_MIN_CHANCE = 0.005;  // ASSUMPTION: 1 chance in 200 that they are that close
// Codes in grid.hazardType (0 = no hazard in that square).
export const HAZARD_CODES = [null, 'water', 'creek', 'wetland'];

const COLS = Math.round((2 * GRID_RADIUS_M) / CELL_SIZE_M); // 256 squares across
const ROWS = COLS;
const SECTOR_SIZE_M = SECTOR_CELLS * CELL_SIZE_M;            // 200 m
const SECTOR_COLS = COLS / SECTOR_CELLS;                      // 32 sectors across
const SECTOR_AREA_M2 = SECTOR_SIZE_M * SECTOR_SIZE_M;

// ---- Small helpers ----------------------------------------------------------------------------

// Probability that a search of this many searcher-minutes in one sector would spot the person,
// if they are there: 1 − e^(−coverage).
export function podForMinutes(minutes) {
  const coverage = (SEARCH_SPEED_MPS * minutes * 60 * SWEEP_WIDTH_M) / SECTOR_AREA_M2;
  return 1 - Math.exp(-coverage);
}

function parseSector(sectorId) {
  const m = /^r(\d+)c(\d+)$/.exec(String(sectorId));
  if (!m) return null;
  const sr = Number(m[1]);
  const sc = Number(m[2]);
  if (sr >= SECTOR_COLS || sc >= SECTOR_COLS) return null;
  return { sr, sc, index: sr * SECTOR_COLS + sc };
}

// The sector's rectangle in meters east (x) and north (y) of the GRID ORIGIN:
// { minX, maxX, minY, maxY }.
export function sectorBoundsXY(sectorId) {
  const s = parseSector(sectorId);
  if (!s) return null;
  return {
    minX: s.sc * SECTOR_SIZE_M - GRID_RADIUS_M,
    maxX: (s.sc + 1) * SECTOR_SIZE_M - GRID_RADIUS_M,
    minY: s.sr * SECTOR_SIZE_M - GRID_RADIUS_M,
    maxY: (s.sr + 1) * SECTOR_SIZE_M - GRID_RADIUS_M,
  };
}

// The id of the sector holding a point, for a grid anchored at `origin`; null if off the grid.
export function sectorIdAt(origin, lat, lng) {
  const { x, y } = latLngToXY(origin, lat, lng);
  const sc = Math.floor((x + GRID_RADIUS_M) / SECTOR_SIZE_M);
  const sr = Math.floor((y + GRID_RADIUS_M) / SECTOR_SIZE_M);
  if (sc < 0 || sr < 0 || sc >= SECTOR_COLS || sr >= SECTOR_COLS) return null;
  return `r${sr}c${sc}`;
}

// Which sector (0..1023) a 25 m square of the probability map belongs to.
function sectorOfGridCell(cell) {
  const r = Math.floor(cell / COLS);
  const c = cell % COLS;
  return Math.floor(r / SECTOR_CELLS) * SECTOR_COLS + Math.floor(c / SECTOR_CELLS);
}

// Coordinates as every phone must see them: 6 decimals (about 0.1 m), the precision the share
// link carries. Without this the phone that created the search (full precision) and a phone
// that joined by link (rounded) could start their walkers one square apart.
const canon = (v) => Number(Number(v).toFixed(6));

// The grid origin for a case: caseInput.gridOrigin if the screen passes one, otherwise the
// last-seen point rounded to GRID_ORIGIN_DECIMALS.
export function gridOriginFor(caseInput) {
  const g = caseInput.gridOrigin;
  if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) return { lat: canon(g.lat), lng: canon(g.lng) };
  return {
    lat: Number(canon(caseInput.lastSeen.lat).toFixed(GRID_ORIGIN_DECIMALS)),
    lng: Number(canon(caseInput.lastSeen.lng).toFixed(GRID_ORIGIN_DECIMALS)),
  };
}

// Sorts strings by their code units, the same on every phone (localeCompare depends on the
// phone's language settings). Firebase push ids are made to sort this way, and sync.js does too.
function compareIds(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---- Caching: walkers and goal fields don't change unless the case does ---------------------------

const simCache = new WeakMap();  // surface → Map(key → walks)
const goalCache = new WeakMap(); // surface → Map(goal cell → cost field)

function cachedSimulate(surface, options) {
  if (!simCache.has(surface)) simCache.set(surface, new Map());
  const cache = simCache.get(surface);
  const { goals, ...plain } = options;
  const key = JSON.stringify({ ...plain, goals: goals.map((g) => [g.cell, g.bearingDeg ?? null]) });
  if (!cache.has(key)) {
    if (cache.size > 12) cache.clear(); // keep memory small
    cache.set(key, simulate(surface, options));
  }
  return cache.get(key);
}

// Familiar places as the walkers need them: the square, and the walking cost to it (see
// costToGoal). The cost is worked out once per place, for the box around the LAST-SEEN point
// and the place, and used for every story of the case, so every phone uses the same field
// whatever order it learned things in. A place off the map, or walkers that start outside that
// box (a far-away sighting), only get a bearing: they just head that way.
//   lastSeen   the case's last-seen point (decides the box)
//   from       where these walkers start: { lat, lng } (the last-seen point or a sighting)
function goalsFor(surface, places, lastSeen, from) {
  if (!goalCache.has(surface)) goalCache.set(surface, new Map());
  const cache = goalCache.get(surface);
  const anchor = snapToNetwork(surface, cellAt(surface, lastSeen.lat, lastSeen.lng));
  const fromCell = snapToNetwork(surface, cellAt(surface, canon(from.lat), canon(from.lng)));
  const UNREACHABLE = 0x3fffffff;
  const goals = [];
  for (const p of places || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const lat = canon(p.lat);
    const lng = canon(p.lng);
    const cell = snapToNetwork(surface, cellAt(surface, lat, lng));
    let cost = null;
    if (cell >= 0 && anchor >= 0 && fromCell >= 0) {
      const key = `${cell}|${anchor}`;
      if (!cache.has(key)) {
        if (cache.size > 6) cache.clear();
        cache.set(key, costToGoal(surface, cell, anchor));
      }
      cost = cache.get(key);
      if (cost[fromCell] >= UNREACHABLE) cost = null; // these walkers start outside the box
    }
    if (cost) { goals.push({ cell, cost }); continue; }
    const a = latLngToXY(surface.origin, canon(from.lat), canon(from.lng));
    const b = latLngToXY(surface.origin, lat, lng);
    const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
    goals.push({ cell: -1, bearingDeg: deg < 0 ? deg + 360 : deg });
  }
  return goals;
}

// Walkers are simulated in half-hour blocks, so the 5-minute clock ticks of the app reuse the
// same run instead of starting over each time. (A walker's path doesn't depend on how long the
// run is, so a longer block changes nothing that was already on the map.)
function horizonFor(minutes) {
  return Math.min(PARAMS.MAX_SIM_MINUTES, Math.max(30, Math.ceil(minutes / 30) * 30));
}

// ---- The pieces of the map ---------------------------------------------------------------------------
//
// The map is a MIXTURE of "components". Each component is one story about the person:
//   - the walkers from the last-seen point,
//   - the walkers from each sighting (if that witness was right),
//   - a fixed background layer (for now an even floor).
// Each walker carries a weight; the background carries a weight per square. Evidence multiplies
// weights. Nothing is renormalized until the end, so the components compete fairly: a story
// that searches keep contradicting loses its share to the others.

// Where a story's walkers are at a case minute (minutes since last seen): the index into each
// walker's minute-by-minute record, or -1 if the story hasn't started yet at that minute.
function minuteIndex(comp, minute) {
  const index = Math.round(minute - comp.born);
  if (index < 0) return -1;
  return Math.min(index, comp.walks.T);
}

// "Still missing": each walker's weight is the chance nobody noticed it, given how exposed to
// the public it has been up to `minute`: (1 − rate)^(exposure-minutes). The weights are then
// scaled so the whole story keeps the share `total`: the evidence moves chance from walkers on
// busy roads to the others, it doesn't shrink the story.
function applyStillMissing(comp, minute, total) {
  const { walks } = comp;
  const W = walks.T + 1;
  const index = Math.max(0, minuteIndex(comp, minute));
  const logKeep = Math.log(1 - PARAMS.SPOT_RATE_PER_MIN) * 0.01;
  let sum = 0;
  for (let w = 0; w < walks.n; w++) {
    comp.weight[w] = Math.exp(logKeep * walks.seen[w * W + index]);
    sum += comp.weight[w];
  }
  const scale = sum > 0 ? total / sum : 0;
  for (let w = 0; w < walks.n; w++) comp.weight[w] *= scale;
}

// A search of `sector` at case minute `minute` that found nobody.
function applySearchToWalkers(comp, sector, minute, keep) {
  const index = minuteIndex(comp, minute);
  if (index < 0) return; // this story starts later: the person wasn't there yet
  const { walks } = comp;
  const W = walks.T + 1;
  for (let w = 0; w < walks.n; w++) {
    if (index >= walks.leftMin[w]) continue; // already off the map
    if (sectorOfGridCell(walks.pos[w * W + index]) === sector) comp.weight[w] *= keep;
  }
}

// The same search, for a story's statistics-map layer. That layer has no paths, so we ask how
// much of the chance now in a square was ALREADY there when it was searched: the chance of
// being at that distance from the story's start at the time of the search, over the chance of
// being there now (at most 1). A square nobody could have reached yet is left alone.
function applySearchToBackground(comp, sector, minute, keep, now) {
  const then = minute - comp.born;
  if (then < 0) return;
  const age = now - comp.born;
  const sameTime = then >= age - 0.5;
  forEachGridCellInSector(sector, (i) => {
    if (!(comp.background[i] > 0)) return;
    let present = 1;
    if (!sameTime) {
      const x = ((i % COLS) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
      const y = (Math.floor(i / COLS) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
      const d = Math.hypot(x - comp.startX, y - comp.startY);
      const nowChance = ringProbability(d, age, comp.mobility);
      present = nowChance > 0 ? Math.min(1, ringProbability(d, then, comp.mobility) / nowChance) : 0;
    }
    comp.background[i] *= 1 - (1 - keep) * present;
  });
}

function sumWeights(comp) {
  let total = 0;
  for (let w = 0; w < comp.weight.length; w++) total += comp.weight[w];
  for (let i = 0; i < comp.background.length; i++) total += comp.background[i];
  return total;
}

function scaleWeights(comp, factor) {
  for (let w = 0; w < comp.weight.length; w++) comp.weight[w] *= factor;
  for (let i = 0; i < comp.background.length; i++) comp.background[i] *= factor;
}

// One story: its walkers and its statistics map, sharing `share` of the whole map between
// them (walkers BLEND_WALKERS, statistics map the rest). Returns the story and the part of its
// statistics map that lies beyond the map's edge.
function makeStory(surface, walks, startCell, born, now, mobility, headingDeg, share) {
  const blend = Math.min(1, Math.max(0, PARAMS.BLEND_WALKERS));
  const stats = cachedStats(surface, startCell, Math.max(0, now - born), mobility, headingDeg);
  const background = new Float64Array(COLS * ROWS);
  for (let i = 0; i < background.length; i++) background[i] = share * (1 - blend) * stats.grid[i];
  const n = surface.n;
  const comp = {
    walks, born, mobility, background,
    weight: new Float64Array(walks.n),
    // The start, in meters from the grid origin.
    startX: ((startCell % n) + 0.5) * SURFACE_CELL_M - SURFACE_RADIUS_M,
    startY: (Math.floor(startCell / n) + 0.5) * SURFACE_CELL_M - SURFACE_RADIUS_M,
  };
  applyStillMissing(comp, now, share * blend);
  return { comp, outside: share * (1 - blend) * stats.outside };
}

// ---- Replay: prior + every event, in order ------------------------------------------------------------

// The main call. Same case + same events → the same map on every phone.
export function replay(area, caseInput, events) {
  const origin = gridOriginFor(caseInput);
  const surface = surfaceFor(area, origin);
  const lastSeen = { lat: canon(caseInput.lastSeen.lat), lng: canon(caseInput.lastSeen.lng) };
  const now = Math.max(0, Number(caseInput.minutes) || 0); // minutes since last seen, "now"
  const mobility = caseInput.mobility || 'normal';
  const seed = caseInput.seed >>> 0;
  const startCell = snapToNetwork(surface, cellAt(surface, lastSeen.lat, lastSeen.lng));
  const goals = goalsFor(surface, caseInput.familiarPlaces, lastSeen, lastSeen);

  // When did an event happen, in minutes since last seen? Needs caseInput.minutesAt (the clock
  // time at which `minutes` was true). Without it every event counts as "now", as before.
  const minutesAt = Number(caseInput.minutesAt);
  const lastSeenMs = Number.isFinite(minutesAt) && minutesAt > 0 ? minutesAt - now * 60000 : null;
  const caseMinute = (ev) => {
    if (lastSeenMs === null || !Number.isFinite(Number(ev.at))) return now;
    return Math.max(0, Math.min(now, Math.round((Number(ev.at) - lastSeenMs) / 60000)));
  };

  // The base story. Its walkers get the share BLEND_WALKERS of the map, the ISRID statistics
  // map the rest. (The statistics map's part beyond the map's edge is "rest of world".)
  const heading = compassToDegrees(caseInput.direction);
  const baseWalks = cachedSimulate(surface, {
    startCell, minutes: horizonFor(now), headingDeg: heading, mobility, goals, seed,
  });
  const first = makeStory(surface, baseWalks, startCell, 0, now, mobility, heading, 1);
  const base = first.comp;
  const components = [base];
  let outside = first.outside; // "rest of world" weight that isn't a walker's

  const searchedMinutes = {};
  const pastSearches = []; // { sector, minute, keep }

  const ordered = [...(events || [])]
    .filter((e) => e && (e.type === 'searched' || e.type === 'sighting'))
    .sort((a, b) => (Number(a.at) - Number(b.at)) || compareIds(a.id, b.id));

  let sightingNumber = 0;
  for (const ev of ordered) {
    if (ev.type === 'searched') {
      const minutes = Number(ev.minutes); // a string like "20" must not be glued onto the total
      if (!(minutes > 0)) continue;
      const sector = parseSector(ev.sectorId);
      if (!sector) continue; // unknown sector id
      const keep = 1 - podForMinutes(minutes);
      const minute = caseMinute(ev);
      for (const comp of components) {
        applySearchToWalkers(comp, sector.index, minute, keep);
        applySearchToBackground(comp, sector, minute, keep, now);
      }
      pastSearches.push({ sector, minute, keep });
      searchedMinutes[ev.sectorId] = (searchedMinutes[ev.sectorId] || 0) + minutes;
    } else {
      sightingNumber += 1;
      const r = Math.min(1, Math.max(0, Number(ev.reliability) || 0));
      const lat = Number(ev.lat);
      const lng = Number(ev.lng);
      if (r === 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      // Everything so far becomes the "witness was wrong" story, with share (1 − r).
      let total = outside;
      for (const comp of components) total += sumWeights(comp);
      const shrink = total > 0 ? (1 - r) / total : 0;
      for (const comp of components) scaleWeights(comp, shrink);
      outside *= shrink;

      // The "witness was right" story, with share r: walkers (and a statistics map) from the
      // sighting, for as long as it has been since the person was seen there.
      const seenAt = Math.max(0, caseMinute(ev) - Math.max(0, Number(ev.minutesSince) || 0));
      const elapsed = Math.max(SIGHTING_MIN_MINUTES, now - seenAt);
      const sightCell = snapToNetwork(surface, cellAt(surface, canon(lat), canon(lng)));
      if (sightCell < 0) { outside += r; continue; } // seen somewhere off this map
      const sightHeading = compassToDegrees(ev.direction);
      const walks = cachedSimulate(surface, {
        startCell: sightCell, minutes: horizonFor(elapsed), headingDeg: sightHeading,
        mobility, goals: goalsFor(surface, caseInput.familiarPlaces, lastSeen, { lat, lng }),
        seed: (seed + 7919 * sightingNumber) >>> 0, walkedMin: Math.round(seenAt),
        n: PARAMS.N_SIGHTING_WALKERS,
      });
      const story = makeStory(surface, walks, sightCell, now - elapsed, now, mobility, sightHeading, r);
      outside += story.outside;
      // Searches made after the person was seen there do count against this story.
      for (const s of pastSearches) {
        applySearchToWalkers(story.comp, s.sector.index, s.minute, s.keep);
        applySearchToBackground(story.comp, s.sector, s.minute, s.keep, now);
      }
      components.push(story.comp);
    }
  }

  // Put it all on the 25 m grid: walkers where they are NOW, smoothed a little, plus the
  // background. Walkers that left the map count as "rest of world".
  const counts = new Float64Array(COLS * ROWS);
  for (const comp of components) {
    const { walks } = comp;
    const W = walks.T + 1;
    const index = Math.max(0, minuteIndex(comp, now));
    for (let w = 0; w < walks.n; w++) {
      if (index >= walks.leftMin[w]) outside += comp.weight[w];
      else counts[walks.pos[w * W + index]] += comp.weight[w];
    }
  }
  const p = smooth(counts);
  for (const comp of components) for (let i = 0; i < p.length; i++) p[i] += comp.background[i];
  let total = outside;
  for (let i = 0; i < p.length; i++) total += p[i];
  for (let i = 0; i < p.length; i++) p[i] /= total;
  const restOfWorld = outside / total;

  const hazardType = hazardTypesFor(surface);
  const hazard = hazardLayer(p, hazardType);
  return {
    sim: simSummary(area, surface, base, now),
    grid: {
      cellSize: CELL_SIZE_M, cols: COLS, rows: ROWS, p,
      origin: { ...origin },
      hazard, hazardType,
      sectors: buildSectors(origin, p, searchedMinutes, hazard),
    },
    restOfWorld,
    minutes: now,
    noDataShare: surface.noDataShare,
    hasLayers: surface.hasLayers,
  };
}

// The statistics map for a start point and time, kept for the last few asked for.
const statsCache = new WeakMap(); // surface → Map(key → { grid, outside })
function cachedStats(surface, startCell, minutes, mobility, headingDeg) {
  if (!statsCache.has(surface)) statsCache.set(surface, new Map());
  const cache = statsCache.get(surface);
  const key = `${startCell}|${minutes}|${mobility}|${headingDeg}`;
  if (!cache.has(key)) {
    if (cache.size > 8) cache.clear();
    cache.set(key, statsMap(surface, startCell, minutes, { mobility, headingDeg }));
  }
  return cache.get(key);
}

// ---- The hazard layer ------------------------------------------------------------------------------

// For each 25 m square: does it hold water (1), a creek or channel (2) or wetland (3)? 0 = none.
const hazardTypeCache = new WeakMap();
function hazardTypesFor(surface) {
  if (hazardTypeCache.has(surface)) return hazardTypeCache.get(surface);
  const out = new Uint8Array(COLS * ROWS);
  const n = surface.n;
  for (let r = 0; r < n; r++) {
    const row = Math.floor((2 * r + 1) / 5);
    for (let c = 0; c < n; c++) {
      const v = surface.cls[r * n + c];
      const code = v === C.WATER ? 1 : v === C.CREEK ? 2 : v === C.WETLAND ? 3 : 0;
      if (!code) continue;
      const i = row * COLS + Math.floor((2 * c + 1) / 5);
      if (out[i] === 0 || code < out[i]) out[i] = code; // water wins over creek over wetland
    }
  }
  hazardTypeCache.set(surface, out);
  return out;
}

// The hazard score of every square: for a water / creek / wetland square, the chance that the
// person is within HAZARD_REACH_M of it; 0 for every other square. (Sums of the map over a
// box around each square, done with running totals so it is quick.)
function hazardLayer(p, hazardType) {
  const reach = Math.round(HAZARD_REACH_M / CELL_SIZE_M);
  const sums = new Float64Array((COLS + 1) * (ROWS + 1)); // sums[r][c] = total of p above-left
  for (let r = 0; r < ROWS; r++) {
    let rowTotal = 0;
    for (let c = 0; c < COLS; c++) {
      rowTotal += p[r * COLS + c];
      sums[(r + 1) * (COLS + 1) + c + 1] = sums[r * (COLS + 1) + c + 1] + rowTotal;
    }
  }
  const hazard = new Float32Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!hazardType[r * COLS + c]) continue;
      const r1 = Math.max(0, r - reach); const r2 = Math.min(ROWS, r + reach + 1);
      const c1 = Math.max(0, c - reach); const c2 = Math.min(COLS, c + reach + 1);
      hazard[r * COLS + c] = sums[r2 * (COLS + 1) + c2] - sums[r1 * (COLS + 1) + c2] - sums[r2 * (COLS + 1) + c1] + sums[r1 * (COLS + 1) + c1];
    }
  }
  return hazard;
}

// Calls fn(cellIndex) for every 25 m square in a sector.
function forEachGridCellInSector(sector, fn) {
  for (let r = sector.sr * SECTOR_CELLS; r < (sector.sr + 1) * SECTOR_CELLS; r++) {
    for (let c = sector.sc * SECTOR_CELLS; c < (sector.sc + 1) * SECTOR_CELLS; c++) fn(r * COLS + c);
  }
}

// A 3×3 blur (weights 1-2-1 each way) that never crosses the edge of a 200 m sector: weight
// that would spill into the next sector stays on the sector's edge square instead. So each
// sector's total is exactly the weight of the walkers inside it, and a search's Bayes
// arithmetic (which works on whole sectors) stays exact.
function smooth(counts) {
  const out = new Float64Array(COLS * ROWS);
  const k = [1, 2, 1];
  for (let r = 0; r < ROWS; r++) {
    const rMin = r - (r % SECTOR_CELLS);
    const rMax = rMin + SECTOR_CELLS - 1;
    for (let c = 0; c < COLS; c++) {
      const v = counts[r * COLS + c];
      if (v === 0) continue;
      const cMin = c - (c % SECTOR_CELLS);
      const cMax = cMin + SECTOR_CELLS - 1;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = Math.min(rMax, Math.max(rMin, r + dr));
          const cc = Math.min(cMax, Math.max(cMin, c + dc));
          out[rr * COLS + cc] += (v * k[dr + 1] * k[dc + 1]) / 16;
        }
      }
    }
  }
  return out;
}

// What the screen draws from the base walkers: where each is now (the middle of its 25 m
// square), and how many used each street.
function simSummary(area, surface, comp, minute) {
  const { walks } = comp;
  const W = walks.T + 1;
  const index = Math.max(0, minuteIndex(comp, minute));
  const endpoints = [];
  for (let w = 0; w < walks.n; w++) {
    if (index >= walks.leftMin[w]) continue; // left the map
    const cell = walks.pos[w * W + index];
    const x = ((cell % COLS) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    const y = (Math.floor(cell / COLS) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    const { lat, lng } = xyToLatLng(surface.origin, x, y);
    endpoints.push({ lat, lng, x, y, edgeIndex: -1, trapType: null, trapId: null });
  }
  return { nWalkers: walks.n, endpoints, edgeCounts: edgeCountsFor(area, surface, walks) };
}

// How many walkers used each street piece: the number that stepped on the ground square at the
// street piece's middle. Cached per run of walkers.
const edgeCountCache = new WeakMap();
function edgeCountsFor(area, surface, walks) {
  if (edgeCountCache.has(walks)) return edgeCountCache.get(walks);
  const { nodes, edges } = area.graph;
  const counts = new Array(edges.length).fill(0);
  for (let i = 0; i < edges.length; i++) {
    const a = nodes[edges[i].a];
    const b = nodes[edges[i].b];
    const cell = cellAt(surface, (a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
    if (cell >= 0) counts[i] = walks.visits[cell];
  }
  edgeCountCache.set(walks, counts);
  return counts;
}

function buildSectors(origin, p, searchedMinutes, hazard) {
  const probability = new Float64Array(SECTOR_COLS * SECTOR_COLS);
  for (let i = 0; i < p.length; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    probability[Math.floor(row / SECTOR_CELLS) * SECTOR_COLS + Math.floor(col / SECTOR_CELLS)] += p[i];
  }
  // Each sector's hazard score: the highest score of any water / creek / wetland square in it.
  const hazardScore = new Float64Array(SECTOR_COLS * SECTOR_COLS);
  for (let i = 0; i < hazard.length; i++) {
    if (!hazard[i]) continue;
    const k = sectorOfGridCell(i);
    if (hazard[i] > hazardScore[k]) hazardScore[k] = hazard[i];
  }
  const sectors = [];
  for (let sr = 0; sr < SECTOR_COLS; sr++) {
    for (let sc = 0; sc < SECTOR_COLS; sc++) {
      const id = `r${sr}c${sc}`;
      const b = sectorBoundsXY(id);
      const sw = xyToLatLng(origin, b.minX, b.minY);
      const ne = xyToLatLng(origin, b.maxX, b.maxY);
      const minutes = searchedMinutes[id] || 0;
      sectors.push({
        id,
        bounds: [[sw.lat, sw.lng], [ne.lat, ne.lng]],
        center: { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 },
        probability: probability[sr * SECTOR_COLS + sc],
        searchedMinutes: minutes,
        pod: minutes ? podForMinutes(minutes) : 0,
        hazardScore: hazardScore[sr * SECTOR_COLS + sc],
        hazard: hazardScore[sr * SECTOR_COLS + sc] >= HAZARD_MIN_CHANCE, // water or a channel near the likely area
      });
    }
  }
  return sectors;
}

// ---- Drawing helper ---------------------------------------------------------------------------------

// The middle of a grid square. `grid.origin` is the case's grid origin (older predictions
// without it fall back to the area's own origin).
export function cellToLatLng(area, grid, cellIndex) {
  const row = Math.floor(cellIndex / grid.cols);
  const col = cellIndex % grid.cols;
  return xyToLatLng(grid.origin || area.origin, (col + 0.5) * grid.cellSize - GRID_RADIUS_M, (row + 0.5) * grid.cellSize - GRID_RADIUS_M);
}

// ---- 4. Next areas (greedy allocation) ----------------------------------------------------------------

// The `count` sectors where `searcherMinutes` of searching adds the most probability of
// success: gain = P(person in sector) × POD. Highest first; ties broken by sector id.
export function nextSectors(prediction, searcherMinutes, count) {
  const pod = podForMinutes(searcherMinutes);
  return prediction.grid.sectors
    .map((s) => ({ sectorId: s.id, gain: s.probability * pod, probability: s.probability }))
    .sort((a, b) => (b.gain - a.gain) || compareIds(a.sectorId, b.sectorId))
    .slice(0, count);
}

// ---- 5. Top spots ---------------------------------------------------------------------------------------

const streetIndexCache = new WeakMap(); // area → Map(50 m square → named edge indices)

function streetIndex(area) {
  if (streetIndexCache.has(area)) return streetIndexCache.get(area);
  const { nodes, edges } = area.graph;
  const index = new Map();
  edges.forEach((e, i) => {
    if (!e.name) return;
    const a = nodes[e.a];
    const b = nodes[e.b];
    // Register the edge in every 50 m square its bounding box touches.
    for (let cx = Math.floor(Math.min(a.x, b.x) / 50); cx <= Math.floor(Math.max(a.x, b.x) / 50); cx++) {
      for (let cy = Math.floor(Math.min(a.y, b.y) / 50); cy <= Math.floor(Math.max(a.y, b.y) / 50); cy++) {
        const key = `${cx},${cy}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(i);
      }
    }
  });
  streetIndexCache.set(area, index);
  return index;
}

// Distance from point (px, py) to the segment a–b.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The nearest named street to (x, y) in the AREA's meters, searching outward up to ~300 m:
// { name, distance } or null.
function nearestNamedStreet(area, x, y) {
  const index = streetIndex(area);
  const { nodes, edges } = area.graph;
  const cx = Math.floor(x / 50);
  const cy = Math.floor(y / 50);
  for (let ring = 1; ring <= 6; ring++) {
    let best = null;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (const i of index.get(`${cx + dx},${cy + dy}`) || []) {
          const e = edges[i];
          const d = distToSegment(x, y, nodes[e.a].x, nodes[e.a].y, nodes[e.b].x, nodes[e.b].y);
          if (!best || d < best.distance) best = { name: e.name, distance: d };
        }
      }
    }
    if (best && best.distance <= ring * 50) return best; // nothing closer can be in a farther ring
  }
  return null;
}

// The most likely places, at least SPOT_SEPARATION_M apart.
export function topSpots(area, prediction, count) {
  const { p } = prediction.grid;
  const origin = prediction.grid.origin || area.origin;
  const order = [...p.keys()].sort((a, b) => (p[b] - p[a]) || (a - b));
  const radiusCells = Math.ceil(SPOT_RADIUS_M / CELL_SIZE_M);
  const chosen = [];

  for (const cell of order) {
    if (chosen.length >= count) break;
    const row = Math.floor(cell / COLS);
    const col = cell % COLS;
    const x = (col + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    const y = (row + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;

    // If a creek / pond / park is right there, the spot's pin goes on it. The pin's final place
    // is what must keep its distance from the other spots.
    const here = xyToLatLng(origin, x, y);
    const a = toXY(area.origin, here.lat, here.lng); // the trap lookup works in the area's meters
    const trap = nearestTrap(area, a.x, a.y, SPOT_TRAP_SEARCH_M);
    const pin = trap ? { x: x + (trap.x - a.x), y: y + (trap.y - a.y) } : { x, y };
    if (chosen.some((s) => Math.hypot(s.pin.x - pin.x, s.pin.y - pin.y) < SPOT_SEPARATION_M)) continue;

    // Probability inside SPOT_RADIUS_M of this square.
    let probability = 0;
    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        if (Math.hypot(dr, dc) * CELL_SIZE_M <= SPOT_RADIUS_M) probability += p[r * COLS + c];
      }
    }
    chosen.push({ x, y, pin, trap, probability, areaXY: trap ? { x: trap.x, y: trap.y } : a });
  }
  // Picked by their single best square, but listed by the total chance around them, so
  // "Check these first" always goes from most to least likely. (Stable sort: ties keep order.)
  chosen.sort((a, b) => b.probability - a.probability);

  const nWalkers = prediction.sim.nWalkers || prediction.sim.endpoints.length || 1;
  const { hazardType } = prediction.grid;
  return chosen.map((s) => {
    const street = nearestNamedStreet(area, s.areaXY.x, s.areaXY.y);
    let walkers = 0;
    for (const e of prediction.sim.endpoints) if (Math.hypot(e.x - s.x, e.y - s.y) <= SPOT_RADIUS_M) walkers += 1;
    const { lat, lng } = xyToLatLng(origin, s.pin.x, s.pin.y);
    // Hazard flags come from the hazard layer (grid.hazardType / grid.hazard), not from where
    // walkers ended: nobody is pushed into a creek to raise a flag.
    //   hazard        water, a creek or wetland AT the spot (within SPOT_TRAP_SEARCH_M):
    //                 the spot itself is for professionals
    //   hazardNearby  the closest such square within HAZARD_REACH_M whose score reaches
    //                 HAZARD_MIN_CHANCE: "look from the bank, don't go in"
    let hazardCode = 0;
    let nearby = null;
    if (hazardType) {
      const row = Math.floor((s.pin.y + GRID_RADIUS_M) / CELL_SIZE_M);
      const col = Math.floor((s.pin.x + GRID_RADIUS_M) / CELL_SIZE_M);
      const reach = Math.ceil(HAZARD_REACH_M / CELL_SIZE_M);
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          const r = row + dr; const c = col + dc;
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          const code = hazardType[r * COLS + c];
          if (!code) continue;
          const d = Math.hypot(dr, dc) * CELL_SIZE_M;
          if (d <= SPOT_TRAP_SEARCH_M && (hazardCode === 0 || code < hazardCode)) hazardCode = code;
          const score = prediction.grid.hazard[r * COLS + c];
          if (d <= HAZARD_REACH_M && score >= HAZARD_MIN_CHANCE && (!nearby || d < nearby.distanceM)) {
            nearby = { type: HAZARD_CODES[code], distanceM: d, nearbyProbability: score };
          }
        }
      }
    }
    const trapIsHazard = s.trap ? HAZARD_TYPES.includes(s.trap.type) : false;
    return {
      lat,
      lng,
      probability: s.probability,
      walkerShare: walkers / nWalkers,
      // The named feature the pin sits on, or else the kind of hazard right at it.
      trapType: s.trap ? s.trap.type : HAZARD_CODES[hazardCode],
      trapName: s.trap ? s.trap.name : null,
      streetName: street ? street.name : null,
      distanceToStreetM: street ? street.distance : null,
      hazard: hazardCode > 0 || trapIsHazard,
      hazardNearby: nearby,
    };
  });
}

// "Where it's dangerous": the water, creek and wetland places with the most chance of the
// person being within HAZARD_REACH_M, at least SPOT_SEPARATION_M apart, most dangerous first.
// These are for professionals (and for telling volunteers where NOT to go in), and they are a
// different list from topSpots: a creek can matter a lot without being a likely place itself.
//   [{ lat, lng, type: 'water' | 'creek' | 'wetland', name, streetName, nearbyProbability }]
export function hazardSpots(area, prediction, count) {
  const { hazard, hazardType } = prediction.grid;
  if (!hazard) return [];
  const origin = prediction.grid.origin || area.origin;
  const candidates = [];
  for (let i = 0; i < hazard.length; i++) if (hazard[i] >= HAZARD_MIN_CHANCE) candidates.push(i);
  candidates.sort((a, b) => (hazard[b] - hazard[a]) || (a - b));
  const chosen = [];
  for (const cell of candidates) {
    if (chosen.length >= count) break;
    const x = ((cell % COLS) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    const y = (Math.floor(cell / COLS) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    if (chosen.some((s) => Math.hypot(s.x - x, s.y - y) < SPOT_SEPARATION_M)) continue;
    chosen.push({ x, y, cell });
  }
  return chosen.map((s) => {
    const { lat, lng } = xyToLatLng(origin, s.x, s.y);
    const a = toXY(area.origin, lat, lng);
    const trap = nearestTrap(area, a.x, a.y, SPOT_TRAP_SEARCH_M);
    const street = nearestNamedStreet(area, a.x, a.y);
    return {
      lat, lng,
      type: HAZARD_CODES[hazardType[s.cell]],
      name: trap && HAZARD_TYPES.includes(trap.type) ? trap.name : null,
      streetName: street ? street.name : null,
      nearbyProbability: hazard[s.cell],
    };
  });
}

// Used by tests and tools: the ground class name at a point of a prediction's map.
export function groundClassAt(area, caseInput, lat, lng) {
  const surface = surfaceFor(area, gridOriginFor(caseInput));
  const cell = cellAt(surface, lat, lng);
  return cell < 0 ? null : CLASS_NAMES[surface.cls[cell]];
}

export { STOP };
