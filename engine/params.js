// engine/params.js — every tunable number of the walkers and the probability map, in one place.
//
// Each number carries one of three labels:
//   DATA        a published number. Never tuned. (Sensitivity is tested at ±20%.)
//   EXPERT      a behavior described in the search-and-rescue literature; the number is ours.
//   ASSUMPTION  our own choice. tools/calibrate.js tunes the ones listed in its KNOBS table to
//               the ISRID statistics and writes the result to engine/calibrated.js, which
//               overrides the defaults below. (Sensitivity is tested at ±50%.)
//
// Sources (all checked on Nov 22, 2026; see docs/PRIOR-V2.md):
//   ISRID   Koester, "Lost Person Behavior", dementia chapter, urban column unless noted
//           https://www.dbs-sar.com/LPB/Dementia.pdf
//   Toots   Toots, Taylor, Lord, Close 2019, J Alzheimers Dis 71(s1):S15–S21 (gait speed)
//   S&G     Soule & Goldman 1972, J Appl Physiol 32(5) (terrain coefficients for walking)

import CALIBRATED from './calibrated.js';
import { C, N_CLASSES } from './surface.js';

export const DEFAULTS = {
  // ---- How many, and for how long -------------------------------------------------------------
  N_WALKERS: 5000,          // ASSUMPTION: enough for a smooth map, few enough for a phone
  N_SIGHTING_WALKERS: 2500, // ASSUMPTION: walkers restarted from each sighting; they start from a
                            // known point a short time ago, so half as many map it as smoothly
  MAX_SIM_MINUTES: 720,     // ASSUMPTION: paths are simulated for at most 12 h; a longer case
                            // uses the 12 h picture (by then nearly every walker has stopped)

  // ---- Each walker's own pace -----------------------------------------------------------------
  SPEED_MEAN_MPS: 0.62,     // DATA (Toots): usual gait speed, n = 309 community-dwelling older
  SPEED_SD_MPS: 0.23,       // DATA (Toots)   adults with cognitive impairment, mean age 82
  SPEED_MIN_MPS: 0.2,       // ASSUMPTION: cut-offs for the bell curve (about −2 SD and +3 SD;
  SPEED_MAX_MPS: 1.3,       //             1.3 m/s is a healthy older adult's usual pace)
  // The app's "how do they walk?" answer scales every walker's speed.
  MOBILITY_NORMAL: 1.0,     // EXPERT: "normal" = the measured distribution as it is
  MOBILITY_SLOW: 0.7,       // ASSUMPTION: "slowly"
  MOBILITY_WALKER: 0.45,    // ASSUMPTION: "walker or cane"
  // Share of the time a mobile person is actually moving (the rest: pausing, standing, looking).
  // Each walker draws one value, evenly between these two. ISRID has no such number.
  MOVE_FRAC_MIN: 0.35,      // ASSUMPTION
  MOVE_FRAC_MAX: 0.85,      // ASSUMPTION (the middle, 0.6, is the old engine's ACTIVITY_FACTOR)
  // Minutes a person keeps going before settling somewhere, drawn from a lognormal curve.
  // ISRID's mobility hours (temperate, n = 42: 0 / 0.25 / 3.8 / 18 h) are far more spread out
  // than its distances (urban, n = 336) allow, so these two are tuned to the distances and the
  // mobility hours are kept as a check in the calibration table.
  MOBILE_MEDIAN_MIN: 60,    // ASSUMPTION, calibrated
  MOBILE_SIGMA: 1.4,        // ASSUMPTION, calibrated

  // ---- What kind of walker --------------------------------------------------------------------
  // EXPERT (ISRID text): "goes until they get stuck", "direction of travel is a good predictor",
  // "may attempt to travel to former residence, favorite place"; urban finds are mostly in
  // structures or along roads. The shares are ours.
  SHARE_DIRECTION: 0.55,    // ASSUMPTION, calibrated: keeps one course
  SHARE_WANDER: 0.2,        // ASSUMPTION, calibrated: wanders with no course
  SHARE_STAYER: 0.25,       // ASSUMPTION, calibrated: stays near home, ends at a nearby structure
  SHARE_GOAL: 0.25,         // ASSUMPTION: heads for a familiar place, when the case lists any
                            // (taken evenly from the three kinds above). Not calibrated: ISRID
                            // gives no share for it.
  STAYER_MOBILE_MEDIAN_MIN: 10, // ASSUMPTION, calibrated: stayers settle quickly
  // ISRID: 66% "cross or depart from a road" → 34% keep to roads and paths.
  ROAD_FOLLOWER_SHARE: 0.34, // DATA (ISRID)

  // ---- Steering --------------------------------------------------------------------------------
  // A step that turns by θ from the walker's recent heading gets weight e^(−θ / scale).
  TURN_SCALE_DEG: 35,        // ASSUMPTION, calibrated: direction walkers and road followers
  WANDER_TURN_SCALE_DEG: 90, // ASSUMPTION, calibrated: wanderers and stayers turn freely
  // Direction walkers also weigh each step by e^(−θ / scale) with θ measured from the course
  // they set out on, so they come back to it after going around something.
  COURSE_SCALE_DEG: 45,      // ASSUMPTION, calibrated (ISRID dispersion angle is the check)
  // When the case gives a direction, each walker's own course is that direction plus a bell
  // curve with this spread. ISRID dispersion angle (temperate, n = 11): median 23°.
  HEADING_SD_DEG: 25,        // EXPERT
  HEADING_MEMORY: 0.6,       // ASSUMPTION: how much of the old heading survives each 10 m step
                             // (smooths the zig-zag of a diagonal road on a square grid)
  ROAD_STICK: 8,             // ASSUMPTION, calibrated: how much more a road follower likes a
                             // road or path square than open ground
  OPEN_BOOST: 1.0,           // ASSUMPTION, calibrated: multiplies a road-crosser's liking for
                             // open ground (lots, parks, grass, plain ground); sets how far
                             // off the road people end up (ISRID track offset is the check)

  // ---- Reasons to stop -------------------------------------------------------------------------
  // Chance per 10 m step, when a building is right beside the walker, of going up to it and
  // staying (a porch, a shed, a shop). Fitted to ISRID urban "structure 35%".
  P_STRUCT_STEP: 0.004,      // ASSUMPTION, calibrated
  P_STRUCT_STAYER: 0.08,     // ASSUMPTION, calibrated: the same for a "stayer"
  STRUCT_MIN_M: 40,          // ASSUMPTION: not before leaving the home's own lot
  // Water (lake, pond, river): each walker decides ONCE, the first time water is beside them,
  // whether they will walk in (ISRID: "attracted to water features and will walk into water").
  // Everyone else treats water as a wall. Fitted to ISRID urban "water 6%".
  P_WATER_ENTER: 0.15,       // ASSUMPTION, calibrated
  // Chance per 10 m step of getting stuck, by ground class. Fitted to ISRID urban
  // drainage 4% / woods 3% / brush 1%.
  P_CREEK_STUCK: 0.2,        // ASSUMPTION, calibrated: in a creek bed or drainage channel
  P_WOODS_STUCK: 0.02,       // ASSUMPTION, calibrated
  P_BRUSH_STUCK: 0.05,       // ASSUMPTION, calibrated
  P_WET_STUCK: 0.05,         // ASSUMPTION
  // Being noticed: chance per minute on a main road (exposure 1) that someone spots the person.
  // In calibration this FINDS the walker there (ISRID urban "road 36%", "linear 9%"). In the app
  // nobody has found them, so it becomes evidence instead: a walker's weight is multiplied by
  // (1 − rate × exposure) for every minute it spent on a road ("still missing").
  SPOT_RATE_PER_MIN: 0.03,   // ASSUMPTION, calibrated

  // ---- Familiar places -------------------------------------------------------------------------
  GOAL_TEMP_M: 4,            // ASSUMPTION: how sharply a goal-seeker prefers the step that
                             // shortens the walk to the place. One 10 m step along a road
                             // toward it is e^(10/4) ≈ 12 times as likely as standing still
                             // would be, and a step away 12 times less: single-minded, but
                             // still able to take a wrong turn now and then
  GOAL_RADIUS_M: 30,         // ASSUMPTION: this close counts as arrived
};

// How much a walker likes to step onto each ground class, relative to a road (= 1).
// EXPERT: "path of least resistance" (ISRID). ASSUMPTION for the numbers. Blocked classes are 0.
export const GROUND_PREF = new Float64Array(N_CLASSES);
GROUND_PREF[C.ROAD] = 1;
GROUND_PREF[C.PATH] = 1;
GROUND_PREF[C.SERVICE] = 0.5;    // driveways and parking aisles lead nowhere
GROUND_PREF[C.LOT] = 0.5;
GROUND_PREF[C.PARK] = 0.5;
GROUND_PREF[C.GRASS] = 0.4;
GROUND_PREF[C.DEVELOPED] = 0.25;
GROUND_PREF[C.NODATA] = 0.25;    // unknown ground: treated as plain ground
GROUND_PREF[C.YARD] = 0.04;      // private yards are mostly fenced, and fences are rarely mapped
GROUND_PREF[C.WOODS] = 0.15;
GROUND_PREF[C.BRUSH] = 0.08;
GROUND_PREF[C.WETLAND] = 0.03;
GROUND_PREF[C.CREEK] = 0.05;     // a ditch or channel: people rarely step in, some do
GROUND_PREF[C.WATER] = 1;        // only used for the few walkers who decided to walk in
GROUND_PREF[C.BUILDING] = 0;
GROUND_PREF[C.BARRIER] = 0;
// Classes a road-crosser's OPEN_BOOST applies to.
export const OPEN_GROUND = new Uint8Array(N_CLASSES);
for (const k of [C.LOT, C.PARK, C.GRASS, C.DEVELOPED, C.NODATA]) OPEN_GROUND[k] = 1;

// Walking speed on each ground class, relative to pavement (= 1).
// EXPERT: 1 ÷ the S&G terrain coefficient (blacktop 1.0, dirt road 1.1, light brush 1.2, heavy
// brush 1.5, swampy bog 1.8). Those coefficients are for energy cost; using them to slow the
// walk is the usual shortcut. Creek beds are ours (ASSUMPTION).
export const GROUND_SPEED = new Float64Array(N_CLASSES).fill(1);
GROUND_SPEED[C.PATH] = 0.91;
GROUND_SPEED[C.PARK] = 0.91;
GROUND_SPEED[C.GRASS] = 0.91;
GROUND_SPEED[C.YARD] = 0.91;
GROUND_SPEED[C.WOODS] = 0.83;
GROUND_SPEED[C.BRUSH] = 0.67;
GROUND_SPEED[C.WETLAND] = 0.56;
GROUND_SPEED[C.CREEK] = 0.5;
GROUND_SPEED[C.WATER] = 0.5;

// The numbers the engine actually uses: the defaults, with any calibrated values on top.
export const PARAMS = Object.freeze({ ...DEFAULTS, ...(CALIBRATED.params || {}) });
