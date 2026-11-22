// engine/grid.js — the probability map and Bayesian search theory.
//
// 1. Prior: where the simulated walkers (sim.js) are, t minutes after the person was last seen,
//    counted onto a grid of 25 m squares. A walker that would have spent long on busy roads
//    counts for less, because the person is STILL MISSING: on a busy road someone would
//    probably have noticed them by now.
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
//
// The grid is anchored to the CASE (its grid origin), not to the map download a phone holds, so
// every phone on a shared search means the same ground by the same sector id.
//
// Exports (INTERFACES.md section 2): replay, cellToLatLng, nextSectors, topSpots,
// plus podForMinutes and sectorBoundsXY used by routes.js and the tests.

import { simulate, compassToDegrees, costToGoal, STOP } from './sim.js';
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
// Until the ISRID statistics map arrives (stage 3 of prior v2), a small share of the chance is
// spread evenly over the grid so no square is exactly zero.
export const PRIOR_FLOOR = 0.02;    // ASSUMPTION (temporary)
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

const COLS = Math.round((2 * GRID_RADIUS_M) / CELL_SIZE_M); // 256 squares across
const ROWS = COLS;
const SECTOR_SIZE_M = SECTOR_CELLS * CELL_SIZE_M;            // 200 m
const SECTOR_COLS = COLS / SECTOR_CELLS;                      // 32 sectors across
const SECTOR_AREA_M2 = SECTOR_SIZE_M * SECTOR_SIZE_M;
const N10 = SURFACE_N;                                        // 640 ground squares across
const SECTOR_GROUND_CELLS = SECTOR_SIZE_M / SURFACE_CELL_M;   // 20 ground squares per sector side

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

// Which sector (0..1023) a 10 m ground square belongs to.
function sectorOfGroundCell(cell) {
  const r = Math.floor(cell / N10);
  const c = cell % N10;
  return Math.floor(r / SECTOR_GROUND_CELLS) * SECTOR_COLS + Math.floor(c / SECTOR_GROUND_CELLS);
}

// Which 25 m square of the probability map holds the middle of a 10 m ground square.
function gridCellOfGroundCell(cell) {
  const r = Math.floor(cell / N10);
  const c = cell % N10;
  const row = Math.floor(((r + 0.5) * SURFACE_CELL_M) / CELL_SIZE_M);
  const col = Math.floor(((c + 0.5) * SURFACE_CELL_M) / CELL_SIZE_M);
  return row * COLS + col;
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

// Familiar places as the walkers need them: the square, and the walking cost to it from everywhere.
// A place off the map only gives a bearing from the start (walkers just head that way).
function goalsFor(surface, places, fromLatLng) {
  if (!goalCache.has(surface)) goalCache.set(surface, new Map());
  const cache = goalCache.get(surface);
  const goals = [];
  for (const p of places || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const lat = canon(p.lat);
    const lng = canon(p.lng);
    const cell = snapToNetwork(surface, cellAt(surface, lat, lng));
    if (cell < 0) {
      const a = latLngToXY(surface.origin, fromLatLng.lat, fromLatLng.lng);
      const b = latLngToXY(surface.origin, lat, lng);
      const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
      goals.push({ cell: -1, bearingDeg: deg < 0 ? deg + 360 : deg });
      continue;
    }
    if (!cache.has(cell)) {
      if (cache.size > 6) cache.clear();
      cache.set(cell, costToGoal(surface, cell));
    }
    goals.push({ cell, cost: cache.get(cell) });
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

// A walker's square at a case minute (minutes since last seen), or -1 if it has left the map.
function cellAtMinute(comp, w, minute) {
  let index = Math.round(minute - comp.born);
  if (index < 0) return -2; // this story hasn't started yet at that minute
  if (index > comp.walks.T) index = comp.walks.T;
  return comp.walks.pos[w * (comp.walks.T + 1) + index];
}

// "Still missing": multiply each walker's weight by the chance nobody noticed it, given the
// minutes it spent on roads up to `minute`.
function applyStillMissing(surface, comp, minute, scale) {
  const { walks } = comp;
  const W = walks.T + 1;
  const last = Math.max(0, Math.min(walks.T, Math.round(minute - comp.born)));
  const logKeep = new Float64Array(101);
  for (let e = 1; e <= 100; e++) logKeep[e] = Math.log(1 - Math.min(0.999, PARAMS.SPOT_RATE_PER_MIN * e * 0.01));
  for (let w = 0; w < walks.n; w++) {
    let log = 0;
    const base = w * W;
    for (let m = 1; m <= last; m++) {
      const cell = walks.pos[base + m];
      if (cell < 0) break;
      const e = surface.exposure[cell];
      if (e) log += logKeep[e];
    }
    comp.weight[w] = scale * Math.exp(log);
  }
}

// A search of `sector` at case minute `minute` that found nobody.
function applySearchToWalkers(comp, sector, minute, keep) {
  if (minute < comp.born) return; // this story starts later: the person wasn't there yet
  for (let w = 0; w < comp.walks.n; w++) {
    const cell = cellAtMinute(comp, w, minute);
    if (cell >= 0 && sectorOfGroundCell(cell) === sector) comp.weight[w] *= keep;
  }
}

function sumWeights(comp) {
  let total = 0;
  for (let w = 0; w < comp.weight.length; w++) total += comp.weight[w];
  return total;
}

function scaleWeights(comp, factor) {
  for (let w = 0; w < comp.weight.length; w++) comp.weight[w] *= factor;
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
  const goals = goalsFor(surface, caseInput.familiarPlaces, lastSeen);

  // When did an event happen, in minutes since last seen? Needs caseInput.minutesAt (the clock
  // time at which `minutes` was true). Without it every event counts as "now", as before.
  const minutesAt = Number(caseInput.minutesAt);
  const lastSeenMs = Number.isFinite(minutesAt) && minutesAt > 0 ? minutesAt - now * 60000 : null;
  const caseMinute = (ev) => {
    if (lastSeenMs === null || !Number.isFinite(Number(ev.at))) return now;
    return Math.max(0, Math.min(now, Math.round((Number(ev.at) - lastSeenMs) / 60000)));
  };

  // The base story: walkers from the last-seen point.
  const baseWalks = cachedSimulate(surface, {
    startCell, minutes: horizonFor(now), headingDeg: compassToDegrees(caseInput.direction),
    mobility, goals, seed,
  });
  const base = { walks: baseWalks, born: 0, weight: new Float64Array(baseWalks.n) };
  applyStillMissing(surface, base, now, (1 - PRIOR_FLOOR) / baseWalks.n);
  const components = [base];
  // The background layer: weight per 25 m square.
  const background = new Float64Array(COLS * ROWS).fill(PRIOR_FLOOR / (COLS * ROWS));
  let outside = 0; // "rest of world" weight that doesn't belong to any walker

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
      for (const comp of components) applySearchToWalkers(comp, sector.index, minute, keep);
      forEachGridCellInSector(sector, (i) => { background[i] *= keep; });
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
      for (let i = 0; i < background.length; i++) total += background[i];
      const shrink = total > 0 ? (1 - r) / total : 0;
      for (const comp of components) scaleWeights(comp, shrink);
      for (let i = 0; i < background.length; i++) background[i] *= shrink;
      outside *= shrink;

      // The "witness was right" story, with share r: walkers from the sighting, walking for as
      // long as it has been since the person was seen there.
      const seenAt = Math.max(0, caseMinute(ev) - Math.max(0, Number(ev.minutesSince) || 0));
      const elapsed = Math.max(SIGHTING_MIN_MINUTES, now - seenAt);
      const sightCell = snapToNetwork(surface, cellAt(surface, canon(lat), canon(lng)));
      if (sightCell < 0) { outside += r; continue; } // seen somewhere off this map
      const walks = cachedSimulate(surface, {
        startCell: sightCell, minutes: horizonFor(elapsed), headingDeg: compassToDegrees(ev.direction),
        mobility, goals: goalsFor(surface, caseInput.familiarPlaces, { lat, lng }),
        seed: (seed + 7919 * sightingNumber) >>> 0, walkedMin: Math.round(seenAt),
        n: PARAMS.N_SIGHTING_WALKERS,
      });
      const comp = { walks, born: now - elapsed, weight: new Float64Array(walks.n) };
      applyStillMissing(surface, comp, now, (r * (1 - PRIOR_FLOOR)) / walks.n);
      // Searches made after the person was seen there do count against this story.
      const extra = new Float64Array(COLS * ROWS).fill((r * PRIOR_FLOOR) / (COLS * ROWS));
      for (const s of pastSearches) {
        if (s.minute < comp.born) continue;
        applySearchToWalkers(comp, s.sector.index, s.minute, s.keep);
        forEachGridCellInSector(s.sector, (i) => { extra[i] *= s.keep; });
      }
      for (let i = 0; i < background.length; i++) background[i] += extra[i];
      components.push(comp);
    }
  }

  // Put it all on the 25 m grid: walkers where they are NOW, smoothed a little, plus the
  // background. Walkers that left the map count as "rest of world".
  const counts = new Float64Array(COLS * ROWS);
  for (const comp of components) {
    for (let w = 0; w < comp.walks.n; w++) {
      const cell = cellAtMinute(comp, w, now);
      if (cell < 0) outside += comp.weight[w];
      else counts[gridCellOfGroundCell(cell)] += comp.weight[w];
    }
  }
  const p = smooth(counts);
  let total = outside;
  for (let i = 0; i < p.length; i++) { p[i] += background[i]; total += p[i]; }
  for (let i = 0; i < p.length; i++) p[i] /= total;
  const restOfWorld = outside / total;

  return {
    sim: simSummary(area, surface, base, now),
    grid: {
      cellSize: CELL_SIZE_M, cols: COLS, rows: ROWS, p,
      origin: { ...origin },
      sectors: buildSectors(origin, p, searchedMinutes),
    },
    restOfWorld,
    minutes: now,
  };
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

// What the screen draws from the base walkers: where each is now, and how many used each street.
const trapOfClass = { [C.CREEK]: 'creek', [C.WATER]: 'water', [C.WETLAND]: 'wetland', [C.WOODS]: 'woods',
  [C.BRUSH]: 'brush', [C.GRASS]: 'grass', [C.PARK]: 'park' };

function simSummary(area, surface, comp, minute) {
  const { walks } = comp;
  const endpoints = [];
  for (let w = 0; w < walks.n; w++) {
    const cell = cellAtMinute(comp, w, minute);
    if (cell < 0) continue; // left the map
    const r = Math.floor(cell / N10);
    const c = cell % N10;
    const x = (c + 0.5) * SURFACE_CELL_M - SURFACE_RADIUS_M;
    const y = (r + 0.5) * SURFACE_CELL_M - SURFACE_RADIUS_M;
    const { lat, lng } = xyToLatLng(surface.origin, x, y);
    endpoints.push({ lat, lng, x, y, edgeIndex: -1, trapType: trapOfClass[surface.cls[cell]] || null, trapId: null });
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

function buildSectors(origin, p, searchedMinutes) {
  const probability = new Float64Array(SECTOR_COLS * SECTOR_COLS);
  for (let i = 0; i < p.length; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    probability[Math.floor(row / SECTOR_CELLS) * SECTOR_COLS + Math.floor(col / SECTOR_CELLS)] += p[i];
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
  return chosen.map((s) => {
    const street = nearestNamedStreet(area, s.areaXY.x, s.areaXY.y);
    let walkers = 0;
    for (const e of prediction.sim.endpoints) if (Math.hypot(e.x - s.x, e.y - s.y) <= SPOT_RADIUS_M) walkers += 1;
    const { lat, lng } = xyToLatLng(origin, s.pin.x, s.pin.y);
    return {
      lat,
      lng,
      probability: s.probability,
      walkerShare: walkers / nWalkers,
      trapType: s.trap ? s.trap.type : null,
      trapName: s.trap ? s.trap.name : null,
      streetName: street ? street.name : null,
      distanceToStreetM: street ? street.distance : null,
      hazard: s.trap ? HAZARD_TYPES.includes(s.trap.type) : false,
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
