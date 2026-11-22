// engine/sim.js — the simulated walkers ("particles").
//
// Each walker is one guess at what the missing person did. It starts at the last-seen point and
// moves over the 10 m ground map (surface.js) one square at a time. Walkers differ, the way
// real people do:
//   - its own walking speed, share of time spent moving, and minutes before it settles;
//   - a kind: keeps one course / wanders / heads for a familiar place / stays near home;
//   - a road habit: keeps to roads and paths, or is willing to cross and leave them.
// It stops when its time runs out, when it goes up to a building and stays, when it gets stuck
// in brush, woods, a wetland or a drainage channel, or when it walks into water.
//
// The result is not just where each walker ended, but where it was at EVERY MINUTE. That is what
// lets grid.js ask "where are they 45 minutes after last seen?", and lets a later clue (a search
// that found nobody, a sighting) re-weigh whole paths instead of only end points.
//
// Same inputs + same seed → exactly the same walkers on every phone (no Math.random here). Each
// walker has its own random stream, so a walker's first hour is the same whether one hour or
// twelve are simulated.

import { C, isWalkable } from './surface.js';
import { PARAMS, GROUND_PREF, GROUND_SPEED, OPEN_GROUND } from './params.js';

export const N_WALKERS = PARAMS.N_WALKERS;

// Kinds of walker.
export const KIND = { DIRECTION: 0, WANDER: 1, GOAL: 2, STAYER: 3 };
// Why a walker stopped. ACTIVE = still moving when the simulated time ran out.
export const STOP = {
  ACTIVE: 0, TIRED: 1, STRUCTURE: 2, WATER: 3, STUCK: 4, SPOTTED: 5, GOAL: 6, LEFT_MAP: 7, BOXED_IN: 8,
};
export const STOP_NAMES = ['still moving', 'mobility time over', 'went to a structure', 'walked into water',
  'stuck in terrain', 'noticed by the public', 'reached the familiar place', 'left the map', 'boxed in'];

// The 8 directions a walker can step in: 0 = north, then clockwise (1 = NE, 2 = E, ...).
const DC = Int32Array.from([0, 1, 1, 1, 0, -1, -1, -1]);   // column change (east = +1)
const DR = Int32Array.from([1, 1, 0, -1, -1, -1, 0, 1]);   // row change (north = +1)
const STEP_M = Float64Array.from([10, 14.142, 10, 14.142, 10, 14.142, 10, 14.142]);
const INV_SQRT2 = Math.SQRT1_2;
const UX = Float64Array.from(DC, (v, k) => (k % 2 ? v * INV_SQRT2 : v)); // the same directions as unit vectors
const UY = Float64Array.from(DR, (v, k) => (k % 2 ? v * INV_SQRT2 : v));

const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
export function compassToDegrees(direction) {
  return direction && COMPASS[direction] !== undefined ? COMPASS[direction] : null;
}

// ---- Random numbers ---------------------------------------------------------------------------

// A small seeded random number generator ("mulberry32"): same seed → same sequence.
export function makeRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The same generator, but made 64 numbers at a time into a buffer. The walkers draw two or three
// random numbers at every step; filling a buffer in one tight loop is several times faster on a
// phone than calling a function for each number, and the numbers themselves are identical.
const RANDOM_BUFFER = 64;
function fillRandom(buffer, state) {
  let a = state[0];
  for (let i = 0; i < RANDOM_BUFFER; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    buffer[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  state[0] = a;
}

// Mixes the case seed with a walker's number into that walker's own seed.
function walkerSeed(seed, w) {
  let h = (seed ^ Math.imul(w + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// A standard normal random number (mean 0, spread 1), using the Box–Muller method.
function normal(random) {
  const u = random() || 1e-12;
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Smallest angle between two compass bearings, 0–180 degrees.
function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// A lookup table for the turn weight e^(−θ / scale), indexed by the cosine of the turn in 64
// steps. A table (instead of calling Math.exp at every step) is faster and gives bit-identical
// results on every phone.
const TURN_BINS = 64;
// A step whose direction is more than about 100° off the heading counts as "behind".
const BEHIND_COS = -0.2;
function turnTable(scaleDeg) {
  const table = new Float64Array(TURN_BINS + 1);
  for (let b = 0; b <= TURN_BINS; b++) {
    const cos = Math.max(-1, Math.min(1, (b / TURN_BINS) * 2 - 1));
    table[b] = Math.exp(-((Math.acos(cos) * 180) / Math.PI) / scaleDeg);
  }
  return table;
}

// ---- Familiar places: how far is the walk from every square? ------------------------------------

// Walking "cost" of stepping onto each ground class, relative to a road. Used only to find the
// way to a familiar place: a goal-seeker takes streets and paths around a lake or a block of
// houses rather than a straight line through them. ASSUMPTION (same reasoning as GROUND_PREF).
const GOAL_COST = new Float64Array(16).fill(2);
GOAL_COST[C.ROAD] = 1; GOAL_COST[C.PATH] = 1; GOAL_COST[C.SERVICE] = 1.2; GOAL_COST[C.LOT] = 1.5;
GOAL_COST[C.PARK] = 1.5; GOAL_COST[C.GRASS] = 1.5; GOAL_COST[C.YARD] = 6; GOAL_COST[C.WOODS] = 3;
GOAL_COST[C.BRUSH] = 5; GOAL_COST[C.WETLAND] = 8; GOAL_COST[C.CREEK] = 8;

// For every square, the cost (in "road meters") of the cheapest walk to `goalCell`.
// Squares that can't reach it keep a huge value. Dijkstra's algorithm with a ring of buckets
// (every step costs a small whole number, so no sorting is needed).
// `fromCell` (optional) limits the work to the box that holds both the start and the goal plus
// GOAL_BOX_MARGIN_M on every side: a goal-seeker has no reason to be far outside it, and on a
// phone this is several times faster than covering the whole map. Squares outside the box keep
// the huge value, so walkers treat them as "not the way".
export const GOAL_BOX_MARGIN_M = 1000; // ASSUMPTION
export function costToGoal(surface, goalCell, fromCell = -1) {
  const { n, cls } = surface;
  const INF = 0x3fffffff;
  const cost = new Int32Array(n * n).fill(INF);
  if (goalCell < 0) return cost;
  let rMin = 0; let rMax = n - 1; let cMin = 0; let cMax = n - 1;
  if (fromCell >= 0) {
    const margin = Math.round(GOAL_BOX_MARGIN_M / 10);
    const r1 = Math.floor(goalCell / n); const r2 = Math.floor(fromCell / n);
    const c1 = goalCell % n; const c2 = fromCell % n;
    rMin = Math.max(0, Math.min(r1, r2) - margin); rMax = Math.min(n - 1, Math.max(r1, r2) + margin);
    cMin = Math.max(0, Math.min(c1, c2) - margin); cMax = Math.min(n - 1, Math.max(c1, c2) + margin);
  }
  cost.box = { rMin, rMax, cMin, cMax }; // so a later start point can tell whether this field covers it
  const RING = 256; // must be bigger than the largest single step (14.142 × 8 = 114)
  const buckets = Array.from({ length: RING }, () => []);
  cost[goalCell] = 0;
  buckets[0].push(goalCell);
  let waiting = 1;
  for (let level = 0; waiting > 0; level++) {
    const bucket = buckets[level % RING];
    while (bucket.length) {
      const i = bucket.pop();
      waiting -= 1;
      if (cost[i] !== level) continue; // an older, worse entry for this square
      const r = Math.floor(i / n);
      const c = i % n;
      // Cost of the step INTO i (we search backwards from the goal).
      const into = GOAL_COST[cls[i]];
      for (let k = 0; k < 8; k++) {
        const rr = r + DR[k];
        const c2 = c + DC[k];
        if (rr < rMin || rr > rMax || c2 < cMin || c2 > cMax) continue;
        const j = rr * n + c2;
        if (!isWalkable(cls[j])) continue;
        if (k % 2 && !isWalkable(cls[r * n + c2]) && !isWalkable(cls[rr * n + c])) continue;
        const next = level + Math.max(1, Math.round(STEP_M[k] * into));
        if (next < cost[j]) {
          cost[j] = next;
          buckets[next % RING].push(j);
          waiting += 1;
        }
      }
    }
  }
  return cost;
}

// ---- Which neighbors can be stepped onto ---------------------------------------------------------

// For a square, one bit per direction: can a walker step that way? Remembered per ground map,
// so the walkers don't re-check buildings, fences, water and tight diagonals at every one of
// their millions of steps. Worked out the first time a walker stands on the square (walkers
// only ever visit a small part of the map), and stored as one number:
//   bits 0–7    for walkers who treat water as a wall
//   bits 8–15   for the few who decided to walk into water (water squares are open to them)
//   bit 16      "worked out" (so 0 means "not yet")
// A step off the edge of the map is never in the mask; the walkers handle the edge themselves.
const stepMaskCache = new WeakMap();
function stepMasks(surface) {
  if (!stepMaskCache.has(surface)) stepMaskCache.set(surface, new Int32Array(surface.n * surface.n));
  return stepMaskCache.get(surface);
}
function computeStepMask(cls, n, i) {
  const r = Math.floor(i / n);
  const c = i % n;
  let land = 0;
  let water = 0;
  for (let k = 0; k < 8; k++) {
    const rr = r + DR[k];
    const c2 = c + DC[k];
    if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
    const v = cls[rr * n + c2];
    if (v === C.BUILDING || v === C.BARRIER) continue;
    // No squeezing diagonally between two blocked squares.
    if (k % 2 && !isWalkable(cls[r * n + c2]) && !isWalkable(cls[rr * n + c])) continue;
    water |= 1 << k;
    if (v !== C.WATER) land |= 1 << k;
  }
  return 0x10000 | (water << 8) | land;
}

// ---- The simulation ---------------------------------------------------------------------------

// Runs the walkers. Options:
//   startCell   square to start from (already snapped to the street network, see surface.js)
//   minutes     how many minutes to simulate (capped at MAX_SIM_MINUTES)
//   headingDeg  direction they were seen going, in degrees (0 = north), or null
//   mobility    'normal' | 'slow' | 'walker'
//   goals       familiar places: [{ cell, cost }] (cell = -1 and bearingDeg set if off the map)
//   seed        uint32
//   spotting    true ONLY in calibration: a walker noticed on a road is "found" and stops there
//   walkedMin   minutes the person had already been walking (walkers restarted from a sighting)
//   trace       true in tests and tools: also keep each minute's 10 m square (pos10)
//   n, params   overrides for tests, calibration and the sensitivity run
// Returns the walks. To keep a phone's memory small, each walker-minute takes 4 bytes:
//   pos[w * (T + 1) + m]    which 25 m square of the probability map walker w is in at minute
//                           m (0..T), as a Uint16 (row * 256 + column)
//   seen[w * (T + 1) + m]   how exposed to the public the walker has been up to minute m:
//                           the sum, over the minutes so far, of the exposure (0–100) of the
//                           square it stood on, capped at 65,535. A minute on a main road adds
//                           100. grid.js turns this into the "still missing" weight.
//   leftMin[w]              the minute from which the walker is off the map (65,535 = never)
//   endCell[w]              the 10 m square where it stopped, or where it was when the
//                           simulated time ran out (-1 = off the map)
//   reason, stopMin         why and when each walker stopped (stopMin = T + 1 if still moving)
//   kind, follower, speed, mobileMin, course   each walker's own draw
//   goalBound               1 for walkers heading for a familiar place
//   cell100                 the 10 m square where it was first 100 m from the start (-1 = never)
//   visits                  how many walkers stepped on each 10 m square ("used streets" layer)
export function simulate(surface, {
  startCell, minutes, headingDeg = null, mobility = 'normal', goals = [], seed,
  spotting = false, walkedMin = 0, trace = false, n = N_WALKERS, params = PARAMS,
}) {
  const P = params;
  const N = surface.n;
  const { cls, exposure, nearBuilding } = surface;
  const T = Math.max(0, Math.min(P.MAX_SIM_MINUTES, Math.ceil(Number(minutes) || 0)));
  const W = T + 1;

  const pos = new Uint16Array(n * W);
  const seen = new Uint16Array(n * W);
  const pos10 = trace ? new Int32Array(n * W) : null;
  const leftMin = new Uint16Array(n).fill(65535);
  const endCell = new Int32Array(n).fill(-1);
  const reason = new Uint8Array(n);
  const stopMin = new Float32Array(n).fill(T + 1);
  const kind = new Uint8Array(n);
  const goalBound = new Uint8Array(n); // 1 = this walker is heading for a familiar place
  const follower = new Uint8Array(n);
  const speed = new Float32Array(n);
  const mobileMin = new Float32Array(n);
  const course = new Float32Array(n).fill(NaN);
  const cell100 = new Int32Array(n).fill(-1);
  const visits = new Uint16Array(N * N);
  const lastVisitor = new Int32Array(N * N).fill(-1);
  // Which 25 m square of the probability map a 10 m row or column falls in (by its middle).
  const coarse = new Uint16Array(N);
  for (let i = 0; i < N; i++) coarse[i] = Math.floor((2 * i + 1) / 5);
  const COARSE_COLS = coarse[N - 1] + 1; // 256

  const result = { n, T, pos, seen, pos10, leftMin, endCell, reason, stopMin, kind, goalBound, follower, speed, mobileMin, course, cell100, visits, startCell };
  if (startCell < 0) { leftMin.fill(0); reason.fill(STOP.LEFT_MAP); stopMin.fill(0); return result; }

  const mobilityFactor = mobility === 'walker' ? P.MOBILITY_WALKER : mobility === 'slow' ? P.MOBILITY_SLOW : P.MOBILITY_NORMAL;
  const startRow = Math.floor(startCell / N);
  const startCol = startCell % N;
  const usableGoals = goals.filter((g) => g && (g.cell >= 0 || Number.isFinite(g.bearingDeg)));
  const goalShare = usableGoals.length ? P.SHARE_GOAL : 0;
  const shareTotal = P.SHARE_DIRECTION + P.SHARE_WANDER + P.SHARE_STAYER;
  const cutDirection = P.SHARE_DIRECTION / shareTotal;
  const cutWander = cutDirection + P.SHARE_WANDER / shareTotal;

  // Step weights by ground class: one table for road followers, one for road crossers.
  const prefFollow = new Float64Array(16);
  const prefCross = new Float64Array(16);
  for (let k = 0; k < 16; k++) {
    const onWay = k === C.ROAD || k === C.PATH;
    prefFollow[k] = GROUND_PREF[k] * (onWay ? P.ROAD_STICK : 1);
    prefCross[k] = GROUND_PREF[k] * (OPEN_GROUND[k] ? P.OPEN_BOOST : 1);
  }
  const turnSteady = turnTable(P.TURN_SCALE_DEG);
  const turnLoose = turnTable(P.WANDER_TURN_SCALE_DEG);
  const stuckProb = new Float64Array(16);
  stuckProb[C.CREEK] = P.P_CREEK_STUCK;
  stuckProb[C.WOODS] = P.P_WOODS_STUCK;
  stuckProb[C.BRUSH] = P.P_BRUSH_STUCK;
  stuckProb[C.WETLAND] = P.P_WET_STUCK;
  const structMinCells2 = (P.STRUCT_MIN_M / 10) ** 2;
  const goalRadiusCells2 = (P.GOAL_RADIUS_M / 10) ** 2;
  const mobileMu = Math.log(P.MOBILE_MEDIAN_MIN);
  const stayerMu = Math.log(P.STAYER_MOBILE_MEDIAN_MIN);

  const weight = new Float64Array(8);
  const courseWeight = new Float64Array(8);
  const structure = new Int32Array(8);
  const masks = stepMasks(surface);
  const OFFSET = Int32Array.from(DR, (dr, k) => dr * N + DC[k]); // index change for each direction
  // One random stream, re-seeded for each walker (see fillRandom above and walkOne below).
  const randomBuffer = new Float64Array(RANDOM_BUFFER);
  const randomState = new Int32Array(1);
  const memory = P.HEADING_MEMORY;
  const goalTemp = P.GOAL_TEMP_M;
  const halfBins = 0.5 * TURN_BINS;

  // Everything a walker needs, in one bundle. Each walker is run by walkOne() below: a
  // function of its own, so the JavaScript engine can optimize it after the first few
  // walkers instead of part-way through one very long loop (which made the first run on a
  // phone, the cold one, about twice as slow).
  const run = {
    N, T, W, P, cls, exposure, nearBuilding, pos, seen, pos10, leftMin, endCell, reason, stopMin,
    kind, goalBound, follower, speed, mobileMin, course, cell100, visits, lastVisitor, coarse,
    COARSE_COLS, seed, headingDeg, walkedMin, spotting, mobilityFactor, startRow, startCol,
    startCell, usableGoals, goalShare, cutDirection, cutWander, prefFollow, prefCross, turnSteady,
    turnLoose, stuckProb, structMinCells2, goalRadiusCells2, mobileMu, stayerMu, weight,
    courseWeight, structure, masks, OFFSET, randomBuffer, randomState, memory, goalTemp, halfBins
  };
  for (let w = 0; w < n; w++) walkOne(run, w);
  return result;
}

// One walker, from its own random draws to where it is at every minute.
function walkOne(run, w) {
  const {
    N, T, W, P, cls, exposure, nearBuilding, pos, seen, pos10, leftMin, endCell, reason, stopMin,
    kind, goalBound, follower, speed, mobileMin, course, cell100, visits, lastVisitor, coarse,
    COARSE_COLS, seed, headingDeg, walkedMin, spotting, mobilityFactor, startRow, startCol,
    startCell, usableGoals, goalShare, cutDirection, cutWander, prefFollow, prefCross, turnSteady,
    turnLoose, stuckProb, structMinCells2, goalRadiusCells2, mobileMu, stayerMu, weight,
    courseWeight, structure, masks, OFFSET, randomBuffer, randomState, memory, goalTemp, halfBins
  } = run;
  // This walker's own random stream (see fillRandom above).
  randomState[0] = walkerSeed(seed, w);
  let randomAt = RANDOM_BUFFER;
  const random = () => {
    if (randomAt >= RANDOM_BUFFER) { fillRandom(randomBuffer, randomState); randomAt = 0; }
    return randomBuffer[randomAt++];
  };
  const base = w * W;

  // ---- This walker's own draws (always in the same order, so the stream stays in step) ----
  const uKind = random();
  const uGoal = random();
  const uRoad = random();
  const v = Math.min(P.SPEED_MAX_MPS, Math.max(P.SPEED_MIN_MPS, P.SPEED_MEAN_MPS + P.SPEED_SD_MPS * normal(random)));
  const moveFrac = P.MOVE_FRAC_MIN + (P.MOVE_FRAC_MAX - P.MOVE_FRAC_MIN) * random();
  const zMobile = normal(random);
  const zHeading = normal(random);
  const uHeading = random();
  const uWater = random();
  const uWhichGoal = random();

  let myKind = uKind < cutDirection ? KIND.DIRECTION : uKind < cutWander ? KIND.WANDER : KIND.STAYER;
  let goal = null;
  if (uGoal < goalShare) {
    goal = usableGoals[Math.min(usableGoals.length - 1, Math.floor(uWhichGoal * usableGoals.length))];
    myKind = goal.cell >= 0 ? KIND.GOAL : KIND.DIRECTION; // a place off the map: just head that way
    goalBound[w] = 1;
  }
  const isFollower = myKind === KIND.GOAL || myKind === KIND.STAYER ? 0 : uRoad < P.ROAD_FOLLOWER_SHARE ? 1 : 0;
  kind[w] = myKind;
  follower[w] = isFollower;
  speed[w] = v * mobilityFactor;

  // Minutes of mobility. After a sighting the person had already been walking for walkedMin:
  // draw from the part of the curve beyond that, and keep what is left.
  let mobile = Math.exp((myKind === KIND.STAYER ? stayerMu : mobileMu) + P.MOBILE_SIGMA * zMobile);
  if (walkedMin > 0) {
    for (let tries = 0; tries < 20 && mobile <= walkedMin; tries++) {
      mobile = Math.exp(mobileMu + P.MOBILE_SIGMA * normal(random));
    }
    mobile = Math.max(1, mobile - walkedMin);
  }
  mobileMin[w] = mobile;

  // Heading: the reported direction plus this walker's own spread, or any direction at all.
  let headingDegrees;
  if (goal && goal.cell < 0) headingDegrees = goal.bearingDeg + P.HEADING_SD_DEG * zHeading;
  else if (headingDeg !== null) headingDegrees = headingDeg + P.HEADING_SD_DEG * zHeading;
  else headingDegrees = uHeading * 360;
  headingDegrees = ((headingDegrees % 360) + 360) % 360;
  let hx = Math.sin((headingDegrees * Math.PI) / 180); // heading as a unit vector (east, north)
  let hy = Math.cos((headingDegrees * Math.PI) / 180);
  const hasCourse = myKind === KIND.DIRECTION;
  if (hasCourse) {
    course[w] = headingDegrees;
    for (let k = 0; k < 8; k++) courseWeight[k] = Math.exp(-angleDiff(k * 45, headingDegrees) / P.COURSE_SCALE_DEG);
  }
  const turn = myKind === KIND.DIRECTION || myKind === KIND.GOAL ? turnSteady : turnLoose;
  const pref = isFollower ? prefFollow : prefCross;
  const pStructure = myKind === KIND.STAYER ? P.P_STRUCT_STAYER : P.P_STRUCT_STEP;
  const entersWater = uWater < P.P_WATER_ENTER;
  const goalCost = myKind === KIND.GOAL ? goal.cost : null;
  const goalRow = myKind === KIND.GOAL ? Math.floor(goal.cell / N) : 0;
  const goalCol = myKind === KIND.GOAL ? goal.cell % N : 0;

  // ---- Walk ---------------------------------------------------------------------------------
  let r = startRow;
  let c = startCol;
  let cell = startCell;
  let t = 0;          // this walker's clock, minutes
  let nextMin = 0;    // the next whole minute to record
  let exposed = 0;    // exposure added up over the minutes so far
  let why = STOP.ACTIVE;
  const metersPerMin = speed[w] * moveFrac * 60;

  for (let guard = 0; guard < 200000; guard++) {
    if (t >= T) break;                                  // simulated time is up, still moving
    if (t >= mobile) {
      // Mobility is over: they settle. Not on the roadway itself, though. ISRID says urban
      // subjects are found "in structures or WALKING along roads": a road find is a person
      // noticed while moving, not one sitting in the street. So a walker that runs out of
      // mobility on a road or path steps off it, to a building's edge if one is beside it,
      // otherwise to the nearest open ground within two squares (20 m).
      why = STOP.TIRED;
      const here = cls[cell];
      if (here === C.ROAD || here === C.PATH || here === C.SERVICE) {
        let best = -1;
        let bestRank = 99;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr;
            const c2 = c + dc;
            if (rr < 0 || rr >= N || c2 < 0 || c2 >= N) continue;
            const j = rr * N + c2;
            const v2 = cls[j];
            if (v2 === C.ROAD || v2 === C.PATH || v2 === C.SERVICE || v2 === C.CREEK || !isWalkable(v2)) continue;
            // A building's edge first, then the closer square; ties go to the lower index.
            const rank = (nearBuilding[j] ? 0 : 10) + Math.max(Math.abs(dr), Math.abs(dc));
            if (rank < bestRank) { bestRank = rank; best = j; }
          }
        }
        if (best >= 0) { cell = best; r = Math.floor(cell / N); c = cell % N; }
      }
      break;
    }

    // Look at the squares around: weigh each as a next step, and note buildings to go up to.
    // First only the five squares ahead and to the sides; the three behind are considered
    // only when nothing ahead is open (a dead end): people rarely double back otherwise.
    let total = 0;
    let nStructure = 0;
    let both = masks[cell];
    if (both === 0) { both = computeStepMask(cls, N, cell); masks[cell] = both; }
    const mask = entersWater ? (both >> 8) & 255 : both & 255;
    const onEdge = r === 0 || r === N - 1 || c === 0 || c === N - 1;
    for (let pass = 0; pass < 2 && !(total > 0); pass++) {
      for (let k = 0; k < 8; k++) {
        if (pass === 0) weight[k] = 0;
        // Heading weight from the cosine of the turn (both vectors are unit length).
        let cos = UX[k] * hx + UY[k] * hy;
        if ((cos < BEHIND_COS) !== (pass === 1)) continue;
        if (!(mask & (1 << k))) {
          // Blocked, or off the edge of the map. Off the edge is allowed, and it ends this
          // walker ("rest of world"); a goal-seeker never chooses it.
          if (!onEdge || goalCost) continue;
          const rr = r + DR[k];
          const c2 = c + DC[k];
          if (rr >= 0 && rr < N && c2 >= 0 && c2 < N) continue;
          if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
          let edgeWeight = turn[((cos + 1) * halfBins + 0.5) | 0];
          if (hasCourse) edgeWeight *= courseWeight[k];
          weight[k] = edgeWeight * pref[C.NODATA];
          total += weight[k];
          continue;
        }
        if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
        let wgt = turn[((cos + 1) * halfBins + 0.5) | 0];
        if (hasCourse) wgt *= courseWeight[k];
        const j = cell + OFFSET[k];
        if (nearBuilding[j]) structure[nStructure++] = j;
        wgt *= pref[cls[j]];
        if (goalCost) {
          // Prefer the step that shortens the walk to the familiar place.
          const gain = (goalCost[cell] - goalCost[j]) / goalTemp;
          wgt *= Math.exp(gain > 20 ? 20 : gain < -20 ? -20 : gain);
        }
        weight[k] = wgt;
        total += wgt;
      }
    }

    // Go up to a building beside us and stay there?
    if (nStructure > 0 && pStructure > 0) {
      const dr0 = r - startRow;
      const dc0 = c - startCol;
      if (dr0 * dr0 + dc0 * dc0 >= structMinCells2 && random() < pStructure) {
        cell = structure[Math.min(nStructure - 1, Math.floor(random() * nStructure))];
        r = Math.floor(cell / N);
        c = cell % N;
        why = STOP.STRUCTURE;
        break;
      }
    }
    if (!(total > 0)) { why = STOP.BOXED_IN; break; }

    // Pick the step.
    let pick = random() * total;
    let k = 0;
    for (; k < 7; k++) { pick -= weight[k]; if (pick <= 0 && weight[k] > 0) break; }
    while (weight[k] === 0 && k > 0) k--; // rounding at the very end of the list
    const rr = r + DR[k];
    const c2 = c + DC[k];
    const off = rr < 0 || rr >= N || c2 < 0 || c2 >= N;
    const j = off ? -1 : rr * N + c2;
    const ground = off ? C.NODATA : cls[j];
    const dt = STEP_M[k] / (metersPerMin * GROUND_SPEED[ground]);
    const tNext = t + dt;
    // Whole minutes that pass while walking this step are recorded at the square being left.
    if (nextMin < tNext && nextMin <= T) {
      const coarseCell = coarse[r] * COARSE_COLS + coarse[c];
      const level = exposure[cell];
      while (nextMin < tNext && nextMin <= T) {
        if (nextMin > 0) exposed += level;
        pos[base + nextMin] = coarseCell;
        seen[base + nextMin] = exposed > 65535 ? 65535 : exposed;
        if (pos10) pos10[base + nextMin] = cell;
        nextMin++;
      }
    }
    t = tNext;
    if (off) { cell = -1; why = STOP.LEFT_MAP; break; }
    r = rr; c = c2; cell = j;
    hx = memory * hx + (1 - memory) * UX[k];
    hy = memory * hy + (1 - memory) * UY[k];
    const len = Math.sqrt(hx * hx + hy * hy);
    if (len > 1e-6) { hx /= len; hy /= len; } else { hx = UX[k]; hy = UY[k]; }
    if (lastVisitor[cell] !== w) { lastVisitor[cell] = w; if (visits[cell] < 65535) visits[cell]++; }
    if (cell100[w] < 0) {
      const dr0 = r - startRow;
      const dc0 = c - startCol;
      if (dr0 * dr0 + dc0 * dc0 >= 100) cell100[w] = cell;
    }

    // Reasons to stop on arriving.
    if (ground === C.WATER) { why = STOP.WATER; break; }
    const pStuck = stuckProb[ground];
    if (pStuck > 0 && random() < pStuck) { why = STOP.STUCK; break; }
    if (spotting) {
      const level = exposure[cell];
      // Chance of being noticed during this step: 1 − (1 − rate)^(exposure × minutes).
      if (level > 0 && random() < 1 - Math.pow(1 - P.SPOT_RATE_PER_MIN, level * 0.01 * dt)) {
        why = STOP.SPOTTED;
        break;
      }
    }
    if (goalCost) {
      const dgr = r - goalRow;
      const dgc = c - goalCol;
      if (dgr * dgr + dgc * dgc <= goalRadiusCells2) { why = STOP.GOAL; break; }
    }
  }

  // After stopping (or when time is up) the walker stays where it is. A walker that stopped
  // on a road keeps being exposed there; one that left the map is marked from that minute on.
  reason[w] = why;
  if (why !== STOP.ACTIVE) stopMin[w] = Math.min(t, T + 1);
  endCell[w] = cell;
  if (cell < 0) {
    if (nextMin <= T) leftMin[w] = nextMin;
    const lastSeen = nextMin > 0 ? seen[base + nextMin - 1] : 0;
    while (nextMin <= T) { seen[base + nextMin] = lastSeen; if (pos10) pos10[base + nextMin] = -1; nextMin++; }
  } else {
    const coarseCell = coarse[r] * COARSE_COLS + coarse[c];
    const level = exposure[cell];
    while (nextMin <= T) {
      if (nextMin > 0) exposed += level;
      pos[base + nextMin] = coarseCell;
      seen[base + nextMin] = exposed > 65535 ? 65535 : exposed;
      if (pos10) pos10[base + nextMin] = cell;
      nextMin++;
    }
  }
}
