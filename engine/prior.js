// engine/prior.js — the ISRID statistics map: what a search planner would draw from the
// published lost-person tables alone, before thinking about any one person's walk.
//
// Recipe, for a person last seen at a point t minutes ago:
//   1. HOW FAR. ISRID gives the distance from the last-seen point at which people with dementia
//      were found (25/50/75/95% of cases). That is where they END UP. After only t minutes they
//      can't be farther than their own pace allows, so the distance now is the smaller of the
//      two: min(where they would end up, pace × t).
//   2. WHAT KIND OF PLACE. ISRID also gives the share found at each kind of place (structure,
//      road, water, ...). Within every 50 m ring of distance, each kind of ground present there
//      gets its ISRID share, spread evenly over the squares of that kind.
//   3. WHICH WAY (only when the case gives a direction). ISRID's dispersion angle says how far
//      the bearing to the find strays from the direction of travel.
// Whatever part of step 1 falls beyond the edge of the map is "rest of world".
//
// grid.js blends this map with the walkers. It is also the recipe bench/prior-eval.js uses to
// place its "true" people, which is why the evaluation labels it an upper bound.
//
// Pure and deterministic; no randomness at all.

import { C, SURFACE_N, SURFACE_CELL_M } from './surface.js';
import { PARAMS } from './params.js';

// ---- ISRID tables (DATA) ----------------------------------------------------------------------
// Koester, "Lost Person Behavior", dementia chapter (https://www.dbs-sar.com/LPB/Dementia.pdf).

export const ISRID = {
  // The urban column (distance n = 336, find location n = 223). Used for Fremont.
  urban: {
    distanceM: [[0.25, 300], [0.5, 1100], [0.75, 3200], [0.95, 12600]],
    find: { structure: 35, road: 36, linear: 9, field: 6, water: 6, drainage: 4, woods: 3, brush: 1 },
  },
  // The temperate flat column (distance n = 175, find location n = 207): the alternative for
  // towns with open country around them.
  temperate: {
    distanceM: [[0.25, 300], [0.5, 1000], [0.75, 2400], [0.95, 12800]],
    find: { structure: 20, road: 18, linear: 9, field: 14, water: 7, drainage: 9, woods: 17, brush: 6 },
  },
};
// Dispersion angle (temperate, n = 11): 25/50/75/95% = 11/23/66/70°. The quartiles are used as
// published. The 95% value (70°, only 4° past the 75% value) rests on a single case out of 11,
// so beyond 66° the remaining quarter is spread evenly out to 180° instead. ASSUMPTION for the
// tail; DATA for the quartiles.
export const DISPERSION_DEG = [[0.25, 11], [0.5, 23], [0.75, 66], [1, 180]];

export const FIND_TYPES = ['structure', 'road', 'linear', 'field', 'water', 'drainage', 'woods', 'brush'];
export const BLOCKED = 255; // a square nobody can be found on (inside a building, open water)

// ---- Tunable numbers --------------------------------------------------------------------------

export const BAND_M = 50;            // ASSUMPTION: width of the distance rings
const N_BANDS = 100;                 // rings out to 5 km: past the map's far corner (4.5 km)
// The ISRID table stops at 95%. For the curve we need a smallest and a largest distance.
export const DIST_MIN_M = 10;        // ASSUMPTION: 0% of people are found closer than this
export const DIST_MAX_M = 40000;     // ASSUMPTION: 100% are found within 40 km
// Open water farther than this from the shore is not a place a person on foot is found.
export const WATER_EDGE_M = 20;      // ASSUMPTION
// Straight-line progress as a share of the distance actually walked (streets wind, people
// drift). ASSUMPTION; our direction-keeping walkers measure about 0.75 on Fremont streets.
export const STRAIGHTNESS = 0.75;
// The direction of travel says little about someone found a few steps away: its effect fades
// in over this distance. ASSUMPTION.
export const DIRECTION_FADE_M = 200;
// "Still missing", for the statistics map: a person standing on a road for this many minutes
// would have been noticed at the same rate as the walkers are. ASSUMPTION.
export const STATS_ROAD_DWELL_MIN = 15;

// ---- What kind of place is each 10 m square? ----------------------------------------------------

const typeCache = new WeakMap(); // surface → Uint8Array of FIND_TYPES indexes (or BLOCKED)

// One ISRID find type per ground square, by this order of precedence:
//   blocked    inside a building or fence line; open water away from the shore; ground cut
//              off from the street network (a walled yard, an island)
//   water      lake, pond or river within WATER_EDGE_M of the shore; wetland
//   drainage   a creek, ditch or channel
//   road       streets and service ways
//   linear     paths, footways, cycleways
//   structure  open ground touching a building
//   drainage   (again) the bank squares right beside a creek, if not touching a building
//   brush, woods
//   field      everything else (grass, parks, lots, yards, plain or unknown ground)
export function findTypes(surface) {
  if (typeCache.has(surface)) return typeCache.get(surface);
  const { n, cls, region, nearBuilding } = surface;
  const T = Object.fromEntries(FIND_TYPES.map((name, i) => [name, i]));
  const type = new Uint8Array(n * n).fill(BLOCKED);
  const edgeCells = Math.round(WATER_EDGE_M / SURFACE_CELL_M);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const v = cls[i];
      if (v === C.BUILDING || v === C.BARRIER) continue;
      if (v === C.WATER) {
        // Only water close to ground that is joined to the streets.
        let nearShore = false;
        for (let dr = -edgeCells; dr <= edgeCells && !nearShore; dr++) {
          for (let dc = -edgeCells; dc <= edgeCells; dc++) {
            const rr = r + dr; const c2 = c + dc;
            if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
            if (region[rr * n + c2]) { nearShore = true; break; }
          }
        }
        if (nearShore) type[i] = T.water;
        continue;
      }
      if (!region[i]) continue; // cut off from the street network
      if (v === C.WETLAND) { type[i] = T.water; continue; }
      if (v === C.CREEK) { type[i] = T.drainage; continue; }
      if (v === C.ROAD || v === C.SERVICE) { type[i] = T.road; continue; }
      if (v === C.PATH) { type[i] = T.linear; continue; }
      // The bank of a creek: any of the 8 squares around is creek.
      let bank = false;
      for (let dr = -1; dr <= 1 && !bank; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr; const c2 = c + dc;
          if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
          if (cls[rr * n + c2] === C.CREEK) { bank = true; break; }
        }
      }
      // A yard that backs onto a channel AND touches a house is "at a structure".
      if (nearBuilding[i]) type[i] = T.structure;
      else if (bank) type[i] = T.drainage;
      else if (v === C.BRUSH) type[i] = T.brush;
      else if (v === C.WOODS) type[i] = T.woods;
      else type[i] = T.field;
    }
  }
  typeCache.set(surface, type);
  return type;
}

// ---- Curves -----------------------------------------------------------------------------------

// P(found within d meters), from the ISRID percentiles joined by straight lines on a
// logarithmic distance scale. (DATA at the four percentiles; the shape between them and the
// two ends are ASSUMPTION.)
export function distanceCdf(d, profile = PARAMS.ISRID_PROFILE) {
  if (!(d > DIST_MIN_M)) return 0;
  if (d >= DIST_MAX_M) return 1;
  const knots = [[0, DIST_MIN_M], ...ISRID[profile].distanceM, [1, DIST_MAX_M]];
  for (let i = 1; i < knots.length; i++) {
    if (d <= knots[i][1]) {
      const f = Math.log(d / knots[i - 1][1]) / Math.log(knots[i][1] / knots[i - 1][1]);
      return knots[i - 1][0] + f * (knots[i][0] - knots[i - 1][0]);
    }
  }
  return 1;
}

// The reverse: the distance within which a share u of people are found.
export function distanceQuantile(u, profile = PARAMS.ISRID_PROFILE) {
  const knots = [[0, DIST_MIN_M], ...ISRID[profile].distanceM, [1, DIST_MAX_M]];
  for (let i = 1; i < knots.length; i++) {
    if (u <= knots[i][0]) {
      const f = (u - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]);
      return knots[i - 1][1] * Math.exp(f * Math.log(knots[i][1] / knots[i - 1][1]));
    }
  }
  return DIST_MAX_M;
}

// A standard normal value for a probability (Acklam's approximation, good to 1e-9).
function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - 0.02425) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Straight-line progress in meters per minute, as a sorted list of equally likely values:
// walking speed (the same bell curve the walkers use) × share of time moving × STRAIGHTNESS.
const paceCache = new Map();
export function paceSamples(mobility = 'normal') {
  if (paceCache.has(mobility)) return paceCache.get(mobility);
  const P = PARAMS;
  const factor = mobility === 'walker' ? P.MOBILITY_WALKER : mobility === 'slow' ? P.MOBILITY_SLOW : P.MOBILITY_NORMAL;
  const out = [];
  const nSpeed = 25;
  const nMove = 9;
  for (let i = 0; i < nSpeed; i++) {
    const z = normalQuantile((i + 0.5) / nSpeed);
    const v = Math.min(P.SPEED_MAX_MPS, Math.max(P.SPEED_MIN_MPS, P.SPEED_MEAN_MPS + P.SPEED_SD_MPS * z));
    for (let j = 0; j < nMove; j++) {
      const move = P.MOVE_FRAC_MIN + ((j + 0.5) / nMove) * (P.MOVE_FRAC_MAX - P.MOVE_FRAC_MIN);
      out.push(v * factor * move * STRAIGHTNESS * 60);
    }
  }
  out.sort((x, y) => x - y);
  paceCache.set(mobility, out);
  return out;
}

// P(the person is farther than d meters from the last-seen point, t minutes after):
// they would end up farther than d AND their pace has let them get that far.
export function farther(d, minutes, mobility, profile = PARAMS.ISRID_PROFILE) {
  if (d <= 0) return 1;
  if (!(minutes > 0)) return 0;
  const pace = paceSamples(mobility);
  const need = d / minutes; // meters per minute needed to be that far by now
  // Share of paces above `need` (binary search in the sorted list).
  let lo = 0;
  let hi = pace.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pace[mid] > need) hi = mid; else lo = mid + 1; }
  return (1 - distanceCdf(d, profile)) * ((pace.length - lo) / pace.length);
}

// P(the person is in the 50 m distance ring that holds distance d, t minutes after).
export function ringProbability(d, minutes, mobility, profile = PARAMS.ISRID_PROFILE) {
  const b = Math.floor(d / BAND_M);
  return farther(b * BAND_M, minutes, mobility, profile) - farther((b + 1) * BAND_M, minutes, mobility, profile);
}

// How likely a bearing that is `deg` off the direction of travel is, relative to an even
// spread over all bearings (so the average over the full circle is 1).
export function directionFactor(deg) {
  const a = Math.abs(deg);
  let prevP = 0;
  let prevA = 0;
  for (const [p, angle] of DISPERSION_DEG) {
    if (a <= angle) return ((p - prevP) / (angle - prevA)) * 180; // density per degree of |angle| × 180
    prevP = p; prevA = angle;
  }
  return 0;
}

// ---- The map ------------------------------------------------------------------------------------
//
// Speed matters here: the app asks for this map again at every 5-minute clock tick, and once
// more per sighting. So the work is split in two:
//   - statsBase(): everything that does NOT depend on the time. For each 25 m square of the
//     probability map: which distance ring it is in, and its weight within that ring (find-type
//     shares, direction of travel, road evidence). One pass over the ground map, kept.
//   - statsMap(): for a given time, the probability of each ring; each square's value is its
//     weight × its ring's probability ÷ the ring's total weight. A few thousand multiplications.

const GRID_COLS = Math.floor((2 * (SURFACE_N - 1) + 1) / 5) + 1; // 256: the 25 m map's width
const baseCache = new WeakMap(); // surface → Map(key → base)

function statsBase(surface, startCell, headingDeg, profile, dwellMin) {
  if (!baseCache.has(surface)) baseCache.set(surface, new Map());
  const cache = baseCache.get(surface);
  const key = `${startCell}|${headingDeg}|${profile}|${dwellMin}`;
  if (cache.has(key)) return cache.get(key);

  const n = surface.n;
  const COLS = GRID_COLS;
  const type = findTypes(surface);
  const nTypes = FIND_TYPES.length;
  const share = FIND_TYPES.map((name) => ISRID[profile].find[name] || 0);
  // The start, in 25 m squares (fractions allowed).
  const startRow = (Math.floor(startCell / n) + 0.5) * (SURFACE_CELL_M / 25);
  const startCol = ((startCell % n) + 0.5) * (SURFACE_CELL_M / 25);

  // 1. Each 25 m square's ring (by the distance of its middle from the start), and, if the
  //    case gives a direction, its factor for the bearing from the start.
  const band = new Uint8Array(COLS * COLS).fill(255);
  const cellsInBand = new Float64Array(N_BANDS);
  const angular = headingDeg !== null && Number.isFinite(headingDeg) ? new Float32Array(COLS * COLS) : null;
  for (let r = 0; r < COLS; r++) {
    for (let c = 0; c < COLS; c++) {
      const dr = r + 0.5 - startRow;
      const dc = c + 0.5 - startCol;
      const d = Math.sqrt(dr * dr + dc * dc) * 25;
      const b = Math.floor(d / BAND_M);
      if (b >= N_BANDS) continue;
      const i = r * COLS + c;
      band[i] = b;
      cellsInBand[b] += 1;
      if (angular) {
        let off = Math.abs((Math.atan2(dc, dr) * 180) / Math.PI - headingDeg) % 360; // 0 = north
        if (off > 180) off = 360 - off;
        // The direction of travel says little about someone found a few steps away.
        const fade = Math.min(1, d / DIRECTION_FADE_M);
        angular[i] = 1 + (directionFactor(off) - 1) * fade;
      }
    }
  }
  // Share of each ring that is on the map (the corners of the square map reach farther than
  // its sides, so the outer rings are only partly on it). A ring that ends before the nearest
  // edge is wholly on the map: exactly 1.
  const onMap = new Float64Array(N_BANDS);
  const toEdgeM = Math.min(startRow, COLS - startRow, startCol, COLS - startCol) * 25;
  for (let b = 0; b < N_BANDS; b++) {
    const ringArea = Math.PI * (((b + 1) * BAND_M) ** 2 - (b * BAND_M) ** 2);
    onMap[b] = (b + 1) * BAND_M <= toEdgeM ? 1 : Math.min(1, (cellsInBand[b] * 625) / ringArea);
  }

  // 2. How many 10 m squares of each find type each ring holds.
  const coarse = new Uint16Array(n);
  for (let k = 0; k < n; k++) coarse[k] = Math.floor((2 * k + 1) / 5);
  const countByType = new Float64Array(N_BANDS * nTypes);
  for (let r = 0; r < n; r++) {
    const rowBase = coarse[r] * COLS;
    for (let c = 0; c < n; c++) {
      const k = type[r * n + c];
      if (k === BLOCKED) continue;
      const b = band[rowBase + coarse[c]];
      if (b !== 255) countByType[b * nTypes + k] += 1;
    }
  }
  // Weight of one 10 m square of each type in each ring: the type's ISRID share (among the
  // types present in the ring) divided by the number of such squares there.
  const perCell = new Float64Array(N_BANDS * nTypes);
  for (let b = 0; b < N_BANDS; b++) {
    let present = 0;
    for (let k = 0; k < nTypes; k++) if (countByType[b * nTypes + k] > 0) present += share[k];
    if (!(present > 0)) continue;
    for (let k = 0; k < nTypes; k++) {
      const count = countByType[b * nTypes + k];
      if (count > 0) perCell[b * nTypes + k] = share[k] / present / count;
    }
  }

  // 3. "Still missing": squares on busier roads count for less.
  const keep = new Float64Array(101).fill(1);
  if (dwellMin > 0) for (let e = 0; e <= 100; e++) keep[e] = Math.pow(1 - PARAMS.SPOT_RATE_PER_MIN, e * 0.01 * dwellMin);

  // 4. Add the 10 m squares up into the 25 m squares, and total each ring.
  const weight = new Float64Array(COLS * COLS);
  const { exposure } = surface;
  for (let r = 0; r < n; r++) {
    const rowBase = coarse[r] * COLS;
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const k = type[i];
      if (k === BLOCKED) continue;
      const j = rowBase + coarse[c];
      const b = band[j];
      if (b === 255) continue;
      weight[j] += perCell[b * nTypes + k] * keep[exposure[i]];
    }
  }
  const ringWeight = new Float64Array(N_BANDS);
  for (let j = 0; j < weight.length; j++) {
    if (!(weight[j] > 0)) continue;
    if (angular) weight[j] *= angular[j];
    ringWeight[band[j]] += weight[j];
  }

  const base = { band, weight, ringWeight, onMap };
  if (cache.size > 8) cache.clear();
  cache.set(key, base);
  return base;
}

// The statistics map for a person last seen at `startCell`, `minutes` ago.
// Returns { grid, outside }: `grid` is a Float64Array over the 25 m probability map (256 × 256,
// row-major) and `outside` is the share beyond the map; together they sum to 1.
// Options: mobility, headingDeg (or null), profile ('urban' | 'temperate'), stillMissing (apply
// the road evidence; the evaluation's "plain recipe" turns it off).
export function statsMap(surface, startCell, minutes, {
  mobility = 'normal', headingDeg = null, profile = PARAMS.ISRID_PROFILE, stillMissing = true,
} = {}) {
  const grid = new Float64Array(GRID_COLS * GRID_COLS);
  if (startCell < 0) return { grid, outside: 1 };
  const dwell = stillMissing ? Math.min(Math.round(minutes), STATS_ROAD_DWELL_MIN) : 0;
  const base = statsBase(surface, startCell, headingDeg, profile, dwell);

  // The probability of each distance ring now, the part of it that is on the map, and the
  // factor that turns a square's weight into its probability.
  const scale = new Float64Array(N_BANDS);
  let placed = 0;
  for (let b = 0; b < N_BANDS; b++) {
    if (!(base.ringWeight[b] > 0)) continue; // a ring with nowhere to stand keeps its share "outside"
    const p = farther(b * BAND_M, minutes, mobility, profile) - farther((b + 1) * BAND_M, minutes, mobility, profile);
    const mass = p * base.onMap[b];
    scale[b] = mass / base.ringWeight[b];
    placed += mass;
  }
  const { band, weight } = base;
  for (let j = 0; j < grid.length; j++) if (weight[j] > 0) grid[j] = weight[j] * scale[band[j]];
  return { grid, outside: Math.max(0, 1 - placed) };
}
