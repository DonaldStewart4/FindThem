// engine/planner/params.js — every tunable number of the search planner, in one place.
//
// Labels (the same three the engine uses, see engine/params.js):
//   DATA        a published number, never tuned
//   EXPERT      a practice described in the search-and-rescue literature; the number is ours
//   ASSUMPTION  our own choice
// Sources (see docs/PLANNER.md and docs/PRIOR-V2.md):
//   Koopman   B. O. Koopman, "Search and Screening" (1946; 1980): sweep width is the area under
//             the lateral range curve; random search gives POD = 1 − e^(−coverage)
//   K2004     Koester, Cooper, Frost & Robe 2004, "Sweep Width Estimation for Ground Search and
//             Rescue", DTIC ADA511593 (checked Nov 22): 16–142 m for an adult-sized target in
//             forest and wildland. No urban, night or vehicle figure was found.
//   ISRID     Koester, "Lost Person Behavior", dementia chapter (checked Nov 22)

// Ground classes of the 10 m ground map. These must equal engine/surface.js `C`; the planner
// core does not import the engine, so tests/planner.test.js checks the two lists match.
export const G = {
  NODATA: 0, DEVELOPED: 1, ROAD: 2, PATH: 3, SERVICE: 4, BUILDING: 5, BARRIER: 6, WATER: 7,
  CREEK: 8, WETLAND: 9, WOODS: 10, BRUSH: 11, GRASS: 12, PARK: 13, YARD: 14, LOT: 15,
};

// Visibility classes: what a searcher walking past can see of a square.
export const V = { STREET: 0, OPEN: 1, YARD: 2, BUILDING: 3, COVER: 4, NONE: 5 };
export const V_NAMES = ['street', 'open', 'yard', 'building', 'cover', 'none'];

// Street types, as numbers (the planner keeps the street graph in flat arrays).
export const HIGHWAYS = ['residential', 'living_street', 'unclassified', 'tertiary', 'secondary',
  'primary', 'service', 'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'other'];
export const HW = Object.fromEntries(HIGHWAYS.map((name, i) => [name, i]));
export const CAR_HIGHWAYS = ['residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary'];
// Marks in world.special: ground nobody may walk on even though the ground map calls it a fence.
export const SPECIAL = { NONE: 0, RAIL: 1, MOTORWAY: 2 };

export const DEFAULTS = {
  // ---- Detection (docs/PLANNER.md section 3) -------------------------------------------------
  // Sweep width W in meters (both sides together) by visibility class, by day and at night.
  // One look from distance d spots a person with probability P0 · e^(−2 · P0 · d / W); the
  // area under that curve is exactly W (Koopman's definition of sweep width).
  // ASSUMPTION, anchored to K2004's measured range (16–142 m, wildland). We sit at its low end
  // because houses, fences and parked cars block more than trees do.
  W_DAY:   [30, 40, 4, 0, 16, 0],   // street, open, yard, building, cover, none
  W_NIGHT: [12, 12, 2, 0, 6, 0],    // ASSUMPTION: no measured night figure was found
  // 16 m for water / brush is DATA: the lowest measured width in K2004 ("low visibility").
  P0: 0.9,                 // ASSUMPTION: even a person right on the track is missed 1 time in 10
  // Pace: meters per second, and how much of the sweep width survives at that pace.
  SEARCH_SPEED_MPS: 0.8,   // ASSUMPTION (the engine's value: a slow, looking-around walk)
  HASTY_SPEED_MPS: 1.2,    // ASSUMPTION: a brisk walk
  HASTY_W_FACTOR: 0.7,     // ASSUMPTION
  DRIVE_SEARCH_MPS: 6.7,   // ASSUMPTION: 15 mph, looking
  DRIVE_W_FACTOR: 0.5,     // ASSUMPTION
  TRAVEL_SPEED_MPS: 1.3,   // ASSUMPTION: an adult's ordinary walk (no looking credited)
  DRIVE_TRAVEL_MPS: 8.9,   // ASSUMPTION: 20 mph through town, stops included
  FOOTPRINT_CELLS: 4,      // squares either side of the track that a look can reach (40 m)
  MIN_DET: 0.002,          // smaller detection values are dropped
  // Canvass (the "ask permission" task): knocking at each building.
  KNOCK_MIN: 1.0,              // ASSUMPTION: minutes per door
  M2_PER_DOOR: 200,            // ASSUMPTION: one door per 200 m² of building footprint
  POD_CANVASS_BUILDING: 0.4,   // ASSUMPTION: about half answer; most who answer would know
  POD_CANVASS_YARD: 0.5,       // ASSUMPTION: about half answer and look in their own yard
  NIGHT_CANVASS_FACTOR: 0.5,   // ASSUMPTION: fewer doors open at night
  CANVASS_REPEAT_MIN: 120,     // ASSUMPTION: knocking on the same doors again within this time
                               // gets the same answers, so it adds nothing: a block's canvass
                               // counts once, and anyone else there is credited only for
                               // what they see from the street
  // Park sweep: lines one sweep width apart is coverage 1 → POD = 1 − e^(−1) = 63% (Koopman).
  PARK_COVERAGE: 1.0,          // EXPERT
  NIGHT_SUN_DEG: -6,           // DATA: civil twilight; below this it is dark

  // ---- Segments (section 2) -------------------------------------------------------------------
  TASK_MAX_MIN: 45,        // Nathan's requirement: tasks of about 30–45 minutes
  TASK_MIN_MIN: 3,         // ASSUMPTION: anything shorter is not worth a task of its own
  MIN_SEGMENT_CELLS: 20,   // ASSUMPTION: 2,000 m²
  FRONT_DEPTH_CELLS: 1,    // squares beside a street that count as "seen from the street"
                           // (ASSUMPTION; ISRID track offset median is 15 m)
  HASTY_RADIUS_M: 1500,    // ASSUMPTION (ISRID urban median distance is 1.1 km)
  HASTY_BUDGET_MIN: 35,    // ASSUMPTION
  DRIVE_RADIUS_M: 3000,    // ASSUMPTION
  DRIVE_BUDGET_MIN: 20,    // ASSUMPTION
  HAZARD_BANK_CELLS: 3,    // a path within 30 m of water gives a view of the bank (ASSUMPTION)
  HAZARD_MIN_CELLS: 5,     // ASSUMPTION
  WATER_NEAR_CELLS: 3,     // a route within 30 m of water...
  WATER_NEAR_MIN_M: 100,   // ...for at least this far carries the water_nearby warning (ASSUMPTION)
  // Containment points: stand and watch where a moving person would pass.
  CONTAIN_RADIUS_M: 2500,  // ASSUMPTION: how far from the last-seen point posts are considered
  CONTAIN_SPACING_M: 150,  // ASSUMPTION: two posts are at least this far apart
  CATCH_M: 300,            // ASSUMPTION: people within this reach of the post may pass it
  PASS_SHARE: 0.25,        // ASSUMPTION: of those still walking nearby, 1 in 4 pass this point
  POD_POST: 0.9,           // ASSUMPTION: a watcher sees someone who walks past
  POST_MIN: 30,            // ASSUMPTION: minutes on a post before re-planning
  // Share of people still walking, by hours since last seen. DATA (ISRID temperate, n = 42):
  // mobility 25 / 50 / 75 / 95% = 0 / 0.25 / 3.8 / 18 h. Read as: 75% are mobile at all, half
  // have stopped by 15 minutes, 25% are still going at 3.8 h, 5% at 18 h.
  MOBILE_HOURS: [0, 0.25, 3.8, 18],
  MOBILE_SHARE: [0.75, 0.5, 0.25, 0.05],

  // ---- Assignment (section 5) -----------------------------------------------------------------
  CLAIM_CREDIT: 0.8,       // ASSUMPTION: how much of a route in progress is counted as done
  STALE_MIN: 10,           // ASSUMPTION: a searcher silent this long starts losing that credit...
  STALE_FADE_MIN: 10,      // ...by e^(−extra minutes / this)
  DOUBLE_UP_FACTOR: 1.25,  // ASSUMPTION: joining a held task must be this much better
  SWITCH_FACTOR: 1.5,      // ASSUMPTION: leaving a held task needs an option this much better
  MAX_TRAVEL_M: 2000,      // ASSUMPTION: tasks farther than this walk are not offered
  MAX_DRIVE_TRAVEL_M: 6000,
  BLOCK_CANDIDATES: 12,    // how many of each kind get a full route and score per searcher
  PARK_CANDIDATES: 4,
  HAZARD_CANDIDATES: 3,
  HASTY_CANDIDATES: 2,
  POST_CANDIDATES: 3,
  IMPROVE_PASSES: 3,       // rounds of "each searcher moves to their own best option"
  OPTIONS: 3,              // options shown to each searcher
  EXPIRE_FACTOR: 1.5,      // an assignment expires after this × its minutes, plus a margin
  EXPIRE_MARGIN_MIN: 10,

  // ---- Hazard-first rule (section 6). ASSUMPTION, switched off and on in the benchmark ---------
  HAZARD_FIRST: true,
  HAZARD_MIN_POS: 0.005,      // ASSUMPTION: the bank check must have at least this chance of finding
                              // them (1 in 200) before the rule sends a pair
  HAZARD_MIN_CHANCE: 0.005,   // the engine's own threshold on the hazard layer (grid.js): which
                              // stretches count as "near the likely area" at all
  HAZARD_REACH_M: 100,        // the engine's own reach (grid.js HAZARD_REACH_M)
  HAZARD_TEAM_DIVISOR: 4,     // at most one pair per this many searchers is sent by the rule
  HAZARD_RECHECK_MIN: 120,    // a checked stretch is not forced again for this long
  CONTAINMENT: true,          // containment posts offered at all (benchmark switch)

  // ---- Measures (section 8) --------------------------------------------------------------------
  ROW_EXPAND: 0.5,            // ASSUMPTION: "not on this map" this high → widen the search
  MIN_USEFUL_RATE: 0.0002,    // ASSUMPTION: best option under 1 chance in 5,000 per minute
  AGE_TAU_MIN: 30,            // ASSUMPTION: how fast an empty search goes stale if they may be moving
};

export function withParams(overrides) {
  return overrides ? { ...DEFAULTS, ...overrides } : DEFAULTS;
}

// Share of missing people still walking t minutes after they were last seen: straight lines
// between the ISRID quartiles on a log time axis (the first step, 0 → 15 minutes, is linear).
export function mobileShare(minutes, P = DEFAULTS) {
  const h = Math.max(0, minutes) / 60;
  const H = P.MOBILE_HOURS;
  const S = P.MOBILE_SHARE;
  if (h <= H[1]) return S[0] + (S[1] - S[0]) * (h / H[1]);
  for (let i = 2; i < H.length; i++) {
    if (h <= H[i]) {
      const f = Math.log(h / H[i - 1]) / Math.log(H[i] / H[i - 1]);
      return S[i - 1] + (S[i] - S[i - 1]) * f;
    }
  }
  return S[S.length - 1];
}
