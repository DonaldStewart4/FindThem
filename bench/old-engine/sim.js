// FROZEN COPY of engine/sim.js as it was on the main branch (commit d7d7d27, Nov 21).
// Kept only so bench/ can compare the old prior with the new one and place "true" people with a
// different model than the app uses. The app never loads this file. Do not edit it.

// engine/sim.js — the simulated walkers.
//
// Each walker is one guess at what the missing person did. It starts at the street point
// nearest the last-seen spot and walks along real streets following patterns from
// search-and-rescue studies of lost people with dementia:
//   - they keep going straight and rarely turn around ("walk until they get stuck"),
//   - they stop at dead ends,
//   - most give up within about a mile,
//   - they're often found just off the road, in a creek, brush or woods,
//   - familiar places (an old home, a church) pull them a little.
// Where 5,000 walkers stop becomes the starting probability map (see grid.js).
//
// Same inputs + same seed → exactly the same walkers on every phone (no Math.random here).

import { nearestNode, nearestTrap, toXY, toLatLng, bearing } from './graph.js';

// ---- Tunable numbers (sources in comments) ------------------------------------------------

export const N_WALKERS = 5000;
// People don't walk the whole time: they stop, wander, pause. Share of time spent moving.
export const ACTIVITY_FACTOR = 0.6;
// Walking speeds in meters per second.
export const SPEED_MPS = { normal: 1.0, slow: 0.7, walker: 0.45 };
// "Give up" distance ALONG THE STREETS, drawn from a lognormal distribution. The research numbers
// (Koester's dementia data) are STRAIGHT-LINE: median ~0.8 km from the last-seen point, ~89%
// within 1 mile. Suburban paths wind (sidewalks, cul-de-sacs), so the walking distance has to be
// much longer. Calibrated on the Fremont map over 5 start points (no time limit): straight-line
// median ≈ 0.75 km, ≈ 89% within 1 mile. tests/sim.test.js re-checks this.
export const GIVE_UP_MEDIAN_M = 2500;
export const GIVE_UP_SIGMA = 0.6;
// At an intersection, a turn of θ degrees gets weight exp(-θ / TURN_SCALE_DEG): straight ahead
// is strongly preferred ("they walk in a straight line until they get stuck").
export const TURN_SCALE_DEG = 30;
// If a direction was given, the first street is weighted by exp(-difference / FIRST_SCALE_DEG).
export const FIRST_SCALE_DEG = 30;
// If a direction was given, every later street also gets exp(-difference / HEADING_SCALE_DEG):
// a gentle, lasting pull the way they were seen going (without it, the heading is forgotten
// after a few turns on curvy suburban streets).
export const HEADING_SCALE_DEG = 90;
// Streets heading within FAMILIAR_CONE_DEG of the nearest familiar place get this multiplier.
export const FAMILIAR_PULL = 1.5;
export const FAMILIAR_CONE_DEG = 45;
// When a walker stops within TRAP_RADIUS_M of a creek, brush, woods, water or park, it ends up
// in that feature with probability TRAP_PROB ("most are found just off the road").
export const TRAP_RADIUS_M = 30;
export const TRAP_PROB = 0.6;
// How much walkers favor each kind of way. In OSM, "service" ways are mostly driveways and
// parking-lot aisles, which people don't follow for long; real streets and paths are preferred.
export const HIGHWAY_WEIGHT = {
  primary: 0.8, secondary: 0.9, tertiary: 1, unclassified: 1, residential: 1, living_street: 1,
  pedestrian: 1, footway: 0.9, path: 1, cycleway: 0.8, track: 0.8, steps: 0.5, service: 0.25,
};
// At a dead end, a walker stops ("gets stuck") with this probability; otherwise it turns back.
// Not 1.0, because many OSM dead ends are driveways, parking aisles and cul-de-sacs a person
// simply walks back out of. Calibrated together with GIVE_UP_MEDIAN_M (see tests/engine.test.js).
export const DEAD_END_STOP_PROB = 0.3;
// Safety limit on steps per walker, so a strange map can never loop forever.
const MAX_STEPS = 5000;

const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

// ---- Random numbers ---------------------------------------------------------------------------

// A small seeded random number generator ("mulberry32"): same seed → same sequence.
export function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A standard normal random number (mean 0, spread 1), using the Box–Muller method.
function normal(random) {
  const u = random() || 1e-12;
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Picks an index with probability proportional to weights[i].
function pickWeighted(weights, random) {
  let total = 0;
  for (const w of weights) total += w;
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// Smallest angle between two compass bearings, 0–180 degrees.
function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// The bearing of edge e when leaving from node n.
function bearingFrom(edge, n) {
  return edge.a === n ? edge.bearingAB : (edge.bearingAB + 180) % 360;
}

// ---- The simulation ---------------------------------------------------------------------------

// Runs N_WALKERS walkers. Returns { nWalkers, endpoints, edgeCounts } (see INTERFACES.md):
//   endpoints[i] = { lat, lng, x, y, edgeIndex, trapType, trapId }
//   edgeCounts[e] = how many walkers used street piece e
// `tuning` (optional) overrides some of the numbers above. The app never uses it; the benchmark
// does, so its simulated "real" missing people don't behave exactly the way the app assumes.
export function simulate(area, { start, minutes, direction, mobility, familiarPlaces, seed, tuning = {} }) {
  const T = {
    giveUpMedian: tuning.GIVE_UP_MEDIAN_M ?? GIVE_UP_MEDIAN_M,
    turnScale: tuning.TURN_SCALE_DEG ?? TURN_SCALE_DEG,
    headingScale: tuning.HEADING_SCALE_DEG ?? HEADING_SCALE_DEG,
    deadEndStop: tuning.DEAD_END_STOP_PROB ?? DEAD_END_STOP_PROB,
    trapProb: tuning.TRAP_PROB ?? TRAP_PROB,
  };
  const { nodes, edges } = area.graph;
  const random = makeRandom(seed);
  const edgeCounts = new Array(edges.length).fill(0);
  const lastWalkerOnEdge = new Int32Array(edges.length).fill(-1); // count each walker once per edge
  const endpoints = [];

  const timeBudget = (SPEED_MPS[mobility] || SPEED_MPS.normal) * Math.max(0, minutes) * 60 * ACTIVITY_FACTOR;
  const heading = direction && COMPASS[direction] !== undefined ? COMPASS[direction] : null;
  const familiar = (familiarPlaces || []).map((p) => toXY(area.origin, p.lat, p.lng));
  const startNode = nodes.length ? nearestNode(area, start.lat, start.lng) : -1;
  const startXY = toXY(area.origin, start.lat, start.lng);

  for (let w = 0; w < N_WALKERS; w++) {
    const giveUp = T.giveUpMedian * Math.exp(GIVE_UP_SIGMA * normal(random));
    let budget = Math.min(timeBudget, giveUp);
    let x = startXY.x;
    let y = startXY.y;
    let edgeIndex = -1;

    if (startNode >= 0) {
      let node = startNode;
      x = nodes[node].x;
      y = nodes[node].y;
      let cameFrom = -1;       // edge we arrived on (no U-turns onto it)
      let arrivalBearing = null;

      for (let step = 0; step < MAX_STEPS && budget > 0; step++) {
        // Streets we could take from here (not the one we just walked, unless it's the only one).
        let options = nodes[node].edges.filter((e) => e !== cameFrom);
        if (options.length === 0) {
          if (nodes[node].edges.length === 0) break;          // an isolated point: nowhere to go
          // A real dead end may stop them ("they go until they get stuck"); the end of a
          // driveway or parking aisle doesn't: they just walk back out.
          const stuckHere = cameFrom >= 0 && edges[cameFrom].highway !== 'service';
          if (step > 0 && stuckHere && random() < T.deadEndStop) break;
          options = nodes[node].edges;
          if (arrivalBearing !== null) arrivalBearing = (arrivalBearing + 180) % 360;
        }

        const nearestFamiliar = familiar.length ? closest(familiar, nodes[node].x, nodes[node].y) : null;
        const weights = options.map((e) => {
          const out = bearingFrom(edges[e], node);
          let weight;
          if (arrivalBearing === null) {
            weight = heading === null ? 1 : Math.exp(-angleDiff(out, heading) / FIRST_SCALE_DEG) + 0.02;
          } else {
            weight = Math.exp(-angleDiff(out, arrivalBearing) / T.turnScale);
            if (heading !== null) weight *= Math.exp(-angleDiff(out, heading) / T.headingScale);
          }
          weight *= HIGHWAY_WEIGHT[edges[e].highway] ?? 1;
          if (nearestFamiliar) {
            const toward = bearing(nodes[node].x, nodes[node].y, nearestFamiliar.x, nearestFamiliar.y);
            if (angleDiff(out, toward) <= FAMILIAR_CONE_DEG) weight *= FAMILIAR_PULL;
          }
          return weight;
        });

        const e = options[pickWeighted(weights, random)];
        const edge = edges[e];
        const next = edge.a === node ? edge.b : edge.a;
        if (lastWalkerOnEdge[e] !== w) { lastWalkerOnEdge[e] = w; edgeCounts[e]++; }
        edgeIndex = e;

        if (budget < edge.length) {
          // Runs out of steam part-way along this street.
          const f = budget / edge.length;
          x = nodes[node].x + (nodes[next].x - nodes[node].x) * f;
          y = nodes[node].y + (nodes[next].y - nodes[node].y) * f;
          budget = 0;
          break;
        }
        budget -= edge.length;
        arrivalBearing = bearingFrom(edge, node);
        cameFrom = e;
        node = next;
        x = nodes[node].x;
        y = nodes[node].y;
      }
    }

    // Just off the road: maybe end up in a nearby creek, brush, woods, water or park.
    let trapType = null;
    let trapId = null;
    const trap = nearestTrap(area, x, y, TRAP_RADIUS_M);
    if (trap && (trap.distance === 0 || random() < T.trapProb)) {
      x = trap.x;
      y = trap.y;
      trapType = trap.type;
      trapId = trap.id;
    }

    const { lat, lng } = toLatLng(area.origin, x, y);
    endpoints.push({ lat, lng, x, y, edgeIndex, trapType, trapId });
  }

  return { nWalkers: N_WALKERS, endpoints, edgeCounts };
}

function closest(points, x, y) {
  let best = null;
  let bestD2 = Infinity;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}
