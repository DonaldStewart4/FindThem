// engine/grid.js — the probability map and Bayesian search theory.
//
// 1. Prior: where the simulated walkers stopped, spread onto a grid of 25 m squares.
// 2. Searched, nobody found: that area's chance drops by how likely searchers were to spot the
//    person there (probability of detection, POD = 1 − e^(−coverage), Koopman's formula), and
//    every other area rises (Bayes' rule: divide by the new total).
// 3. Sighting: rerun walkers from where the person was seen and blend that map in,
//    weighted by how sure the reporter is.
// 4. Next areas: the 200 m sectors where the next searcher's minutes add the most chance of
//    finding the person (greedy allocation; for this detection model greedy is optimal).
// 5. Top spots: the most likely places, with the nearest creek / park and named street.
//
// Exports (INTERFACES.md section 2): replay, cellToLatLng, nextSectors, topSpots,
// plus podForMinutes and sectorBoundsXY used by routes.js and the tests.

import { simulate } from './sim.js';
import { nearestTrap, toLatLng } from './graph.js';

// ---- Tunable numbers --------------------------------------------------------------------------

export const CELL_SIZE_M = 25;      // grid squares
export const GRID_RADIUS_M = 3200;  // the grid covers this far from the area's center (= Overpass radius)
export const SECTOR_CELLS = 8;      // a sector is 8 × 8 squares = 200 m × 200 m
// Every square gets a small share of probability, so no place is ever "impossible".
export const PRIOR_FLOOR = 0.02;    // 2% of the total, spread evenly over the whole grid
// Searching: a volunteer walks SEARCH_SPEED_MPS and spots a person within SWEEP_WIDTH_M / 2
// either side. coverage = speed × seconds × sweep width ÷ sector area.
export const SEARCH_SPEED_MPS = 0.8;
export const SWEEP_WIDTH_M = 20;
// A sighting reported "0 minutes ago" still spreads walkers a little from that point.
export const SIGHTING_MIN_MINUTES = 5;
// Top spots: how far apart two spots must be, and how far around a spot counts toward it.
export const SPOT_SEPARATION_M = 150;
export const SPOT_RADIUS_M = 75;
export const SPOT_TRAP_SEARCH_M = 50;
export const HAZARD_TYPES = ['creek', 'river', 'water', 'wetland'];

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

function cellOf(x, y) {
  const col = Math.floor((x + GRID_RADIUS_M) / CELL_SIZE_M);
  const row = Math.floor((y + GRID_RADIUS_M) / CELL_SIZE_M);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
  return row * COLS + col;
}

function sectorIdOf(cell) {
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  return `r${Math.floor(row / SECTOR_CELLS)}c${Math.floor(col / SECTOR_CELLS)}`;
}

// The sector's rectangle in meters: { minX, maxX, minY, maxY }.
export function sectorBoundsXY(sectorId) {
  const m = /^r(\d+)c(\d+)$/.exec(sectorId);
  if (!m) return null;
  const sr = Number(m[1]);
  const sc = Number(m[2]);
  return {
    minX: sc * SECTOR_SIZE_M - GRID_RADIUS_M,
    maxX: (sc + 1) * SECTOR_SIZE_M - GRID_RADIUS_M,
    minY: sr * SECTOR_SIZE_M - GRID_RADIUS_M,
    maxY: (sr + 1) * SECTOR_SIZE_M - GRID_RADIUS_M,
  };
}

// Calls fn(cellIndex) for every square in a sector.
function forEachCellInSector(sectorId, fn) {
  const m = /^r(\d+)c(\d+)$/.exec(sectorId);
  if (!m) return;
  const sr = Number(m[1]);
  const sc = Number(m[2]);
  if (sr >= SECTOR_COLS || sc >= SECTOR_COLS) return;
  for (let r = sr * SECTOR_CELLS; r < (sr + 1) * SECTOR_CELLS; r++) {
    for (let c = sc * SECTOR_CELLS; c < (sc + 1) * SECTOR_CELLS; c++) fn(r * COLS + c);
  }
}

function normalize(p) {
  let total = 0;
  for (let i = 0; i < p.length; i++) total += p[i];
  for (let i = 0; i < p.length; i++) p[i] /= total;
  return p;
}

// ---- 1. Prior: walkers → grid --------------------------------------------------------------------

// Counts walkers per square, smooths with a 3×3 blur (weights 1-2-1), adds the floor, normalizes.
function priorFromWalkers(sim) {
  const counts = new Float64Array(COLS * ROWS);
  for (const e of sim.endpoints) {
    const cell = cellOf(e.x, e.y);
    if (cell >= 0) counts[cell] += 1;
  }
  const p = new Float64Array(COLS * ROWS);
  const k = [1, 2, 1];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = counts[r * COLS + c];
      if (v === 0) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
          p[rr * COLS + cc] += (v * k[dr + 1] * k[dc + 1]) / 16;
        }
      }
    }
  }
  normalize(p);
  const floor = PRIOR_FLOOR / p.length;
  for (let i = 0; i < p.length; i++) p[i] = (1 - PRIOR_FLOOR) * p[i] + floor;
  return p;
}

// ---- Caching: the walkers don't change unless the case does --------------------------------------

const simCache = new WeakMap(); // area → Map(key → sim result)

function cachedSimulate(area, params) {
  if (!simCache.has(area)) simCache.set(area, new Map());
  const cache = simCache.get(area);
  const key = JSON.stringify(params);
  if (!cache.has(key)) {
    if (cache.size > 20) cache.clear(); // keep memory small
    cache.set(key, simulate(area, params));
  }
  return cache.get(key);
}

// ---- 2–3. Replay: prior + every event, in order ---------------------------------------------------

// The main call. Same case + same events → the same map on every phone.
export function replay(area, caseInput, events) {
  const base = cachedSimulate(area, {
    start: caseInput.lastSeen,
    minutes: caseInput.minutes,
    direction: caseInput.direction || null,
    mobility: caseInput.mobility,
    familiarPlaces: caseInput.familiarPlaces || [],
    seed: caseInput.seed >>> 0,
  });
  const p = priorFromWalkers(base);
  const missed = new Float64Array(COLS * ROWS).fill(1); // product of (1 − POD) from every search so far
  const searchedMinutes = {};

  const ordered = [...(events || [])]
    .filter((e) => e && (e.type === 'searched' || e.type === 'sighting'))
    .sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));

  let sightingNumber = 0;
  for (const ev of ordered) {
    if (ev.type === 'searched') {
      if (!(ev.minutes > 0)) continue;
      const pod = podForMinutes(ev.minutes);
      let touched = false;
      forEachCellInSector(ev.sectorId, (i) => { p[i] *= 1 - pod; missed[i] *= 1 - pod; touched = true; });
      if (!touched) continue; // unknown sector id
      searchedMinutes[ev.sectorId] = (searchedMinutes[ev.sectorId] || 0) + ev.minutes;
      normalize(p); // Bayes: everywhere else becomes relatively more likely
    } else {
      sightingNumber += 1;
      const r = Math.min(1, Math.max(0, Number(ev.reliability) || 0));
      if (r === 0 || !Number.isFinite(ev.lat) || !Number.isFinite(ev.lng)) continue;
      const fromSighting = cachedSimulate(area, {
        start: { lat: ev.lat, lng: ev.lng },
        minutes: Math.max(SIGHTING_MIN_MINUTES, Number(ev.minutesSince) || 0),
        direction: ev.direction || null,
        mobility: caseInput.mobility,
        familiarPlaces: caseInput.familiarPlaces || [],
        seed: (caseInput.seed + 7919 * sightingNumber) >>> 0,
      });
      const q = priorFromWalkers(fromSighting);
      for (let i = 0; i < q.length; i++) q[i] *= missed[i]; // earlier searches still count
      normalize(q);
      for (let i = 0; i < p.length; i++) p[i] = (1 - r) * p[i] + r * q[i];
    }
  }

  return { sim: base, grid: { cellSize: CELL_SIZE_M, cols: COLS, rows: ROWS, p, sectors: buildSectors(area, p, searchedMinutes) } };
}

function buildSectors(area, p, searchedMinutes) {
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
      const sw = toLatLng(area.origin, b.minX, b.minY);
      const ne = toLatLng(area.origin, b.maxX, b.maxY);
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

export function cellToLatLng(area, grid, cellIndex) {
  const row = Math.floor(cellIndex / grid.cols);
  const col = cellIndex % grid.cols;
  return toLatLng(area.origin, (col + 0.5) * grid.cellSize - GRID_RADIUS_M, (row + 0.5) * grid.cellSize - GRID_RADIUS_M);
}

// ---- 4. Next areas (greedy allocation) ----------------------------------------------------------------

// The `count` sectors where `searcherMinutes` of searching adds the most probability of
// success: gain = P(person in sector) × POD. Highest first; ties broken by sector id.
export function nextSectors(prediction, searcherMinutes, count) {
  const pod = podForMinutes(searcherMinutes);
  return prediction.grid.sectors
    .map((s) => ({ sectorId: s.id, gain: s.probability * pod, probability: s.probability }))
    .sort((a, b) => (b.gain - a.gain) || (a.sectorId < b.sectorId ? -1 : 1))
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

// The nearest named street to (x, y), searching outward up to ~300 m: { name, distance } or null.
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

// The most likely places, clustered so they're at least SPOT_SEPARATION_M apart.
export function topSpots(area, prediction, count) {
  const { p } = prediction.grid;
  const order = [...p.keys()].sort((a, b) => p[b] - p[a]);
  const radiusCells = Math.ceil(SPOT_RADIUS_M / CELL_SIZE_M);
  const chosen = [];

  for (const cell of order) {
    if (chosen.length >= count) break;
    const row = Math.floor(cell / COLS);
    const col = cell % COLS;
    const x = (col + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    const y = (row + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
    if (chosen.some((s) => Math.hypot(s.x - x, s.y - y) < SPOT_SEPARATION_M)) continue;

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
    chosen.push({ x, y, probability });
  }
  // Picked by their single best square, but listed by the total chance around them, so
  // "Check these first" always goes from most to least likely. (Stable sort: ties keep order.)
  chosen.sort((a, b) => b.probability - a.probability);

  const nWalkers = prediction.sim.nWalkers || prediction.sim.endpoints.length || 1;
  return chosen.map((s) => {
    const trap = nearestTrap(area, s.x, s.y, SPOT_TRAP_SEARCH_M);
    const px = trap ? trap.x : s.x; // point the spot at the creek / park itself if one is close
    const py = trap ? trap.y : s.y;
    const street = nearestNamedStreet(area, px, py);
    let walkers = 0;
    for (const e of prediction.sim.endpoints) if (Math.hypot(e.x - s.x, e.y - s.y) <= SPOT_RADIUS_M) walkers += 1;
    const { lat, lng } = toLatLng(area.origin, px, py);
    return {
      lat,
      lng,
      probability: s.probability,
      walkerShare: walkers / nWalkers,
      trapType: trap ? trap.type : null,
      trapName: trap ? trap.name : null,
      streetName: street ? street.name : null,
      distanceToStreetM: street ? street.distance : null,
      hazard: trap ? HAZARD_TYPES.includes(trap.type) : false,
    };
  });
}
