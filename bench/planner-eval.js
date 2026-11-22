// bench/planner-eval.js — does the search planner find people sooner than the old sector list?
//
// A simulation on the real Fremont map. It calls the REAL planner (engine/planner) and the REAL
// old pipeline (replay → nextSectors → routeFor). What is simulated around them:
//
//   The missing person. Where each one ends up comes from ISRID's urban dementia statistics,
//     NOT from the app's walkers: distance from the last-seen point (25/50/75/95% = 0.3 / 1.1 /
//     3.2 / 12.6 km) and kind of place (structure 35, road 36, linear 9, field 6, water 6,
//     drainage 4, woods 3, brush 1). They walk there along streets at a pace drawn from
//     Toots et al. (0.62 ± 0.23 m/s), moving 60% of the time (ASSUMPTION), so some are still on
//     the way while the search runs. People bound for somewhere off the map walk off it.
//   The searchers. Six volunteers on foot. They really walk: travel takes time on the street
//     graph, each has their own pace, and one task in five is NOT done as planned (they wander
//     nearby instead; half of those still report "done").
//   Detection. A searcher passing within 45 m spots the person with the same kind of look curve
//     the planner assumes, but with "true" sweep widths and door-knock values that differ from
//     the planner's by up to ±50%, drawn per setup. A person inside a building is only found by
//     door-knocking, and knocking twice gets the same answer.
//
// Strategies:
//   own      volunteers on their own, who remember where they have been
//   ring     a ring sweep outward from the last-seen point that starts over at the edge
//   stats    greedy on the plain ISRID statistics map, old 200 m areas and routes
//   old      the app before the planner: replay → nextSectors → routeFor
//   planner  the new planner
//   and the planner with one thing switched off: the hazard-first rule, containment, door-knocking
//
// Reported: share found by time, expected time to find (capped at the run length), and 95%
// intervals from resampling SETUPS (start point × time since last seen), then people inside
// each. With few setups those intervals are wide, and that is the honest width.
//
// Run:   node bench/planner-eval.js            (writes bench/planner-report.md)
//        node bench/planner-eval.js --quick    (2 setups, for a look)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareArea } from '../engine/graph.js';
import { replay, nextSectors, podForMinutes } from '../engine/grid.js';
import { routeFor } from '../engine/routes.js';
import { makeRandom } from '../engine/sim.js';
import { plannerWorld, plannerMap, trackFromLatLngs } from '../engine/planner/adapter.js';
import { planSearch as planOnWorld, assignedEvent } from '../engine/planner/plan.js';
import { FOOT, nearestNode, shortestFrom, pathTo, trackOfEdges, cellXY, cellAtXY, toXY } from '../engine/planner/world.js';
import { G, V, DEFAULTS, withParams } from '../engine/planner/params.js';

// ---- Settings -------------------------------------------------------------------------------------

export const TEAM = 6;                 // searchers, all on foot
export const HORIZON_MIN = 180;        // minutes of searching simulated
export const STEP_S = 15;              // the simulation's clock tick
export const CHECKPOINTS = [30, 60, 120, 180];
export const NOT_AS_PLANNED = 0.2;     // share of tasks not done as planned (ASSUMPTION)
export const MOVE_SHARE = 0.6;         // share of the time a walking person is moving (ASSUMPTION)
export const LOOK_RANGE_M = 45;
export const TURN_MIN = 20;            // minutes a volunteer gives one old-style 200 m area (the old app's default)
export const MIN_ROUTE_M = 150;        // an old-style area with less street than this is skipped
export const TRUE_SPREAD = 0.5;        // true sweep widths = planner's × (1 ± this), per setup
const NOON = Date.UTC(2026, 10, 22, 20, 0, 0); // 12:00 in Fremont: the search starts in daylight
const STARTS = [
  { lat: 37.5405, lng: -121.9795 }, { lat: 37.5530, lng: -121.9700 }, { lat: 37.5480, lng: -121.9850 },
  { lat: 37.5600, lng: -121.9750 }, { lat: 37.5450, lng: -121.9600 }, { lat: 37.5560, lng: -121.9820 },
  { lat: 37.5500, lng: -121.9760 }, { lat: 37.5440, lng: -121.9720 },
];
const SINCE_MIN = [60, 120];           // minutes since last seen when the search starts
// ISRID urban dementia (Koester, Lost Person Behavior; checked Nov 22, see docs/PRIOR-V2.md).
const DISTANCE_KNOTS = [[0, 10], [0.25, 300], [0.5, 1100], [0.75, 3200], [0.95, 12600], [1, 40000]];
const FIND_SHARES = [['structure', 35], ['road', 36], ['linear', 9], ['field', 6], ['water', 6], ['drainage', 4], ['woods', 3], ['brush', 1]];
const SPEED = { mean: 0.62, sd: 0.23, min: 0.2, max: 1.3 }; // Toots et al. 2019

export const STRATEGIES = ['own', 'ring', 'stats', 'old', 'planner', 'planner-stats-map', 'planner-even-split', 'planner-no-hazard-first', 'planner-no-containment', 'planner-no-doors'];
export const NAMES = {
  own: 'On their own, with memory', ring: 'Ring sweep, cycling', stats: 'Greedy on the plain statistics map',
  old: 'Old app: nextSectors + routeFor', planner: 'Planner',
  'planner-stats-map': 'Planner on the plain statistics map', 'planner-even-split': 'Planner, 25 m map split evenly',
  'planner-no-hazard-first': 'Planner, hazard-first rule off', 'planner-no-containment': 'Planner, containment off',
  'planner-no-doors': 'Planner, no door-knocking',
};
const PLANNER_PARAMS = {
  planner: null,
  'planner-stats-map': null,
  'planner-even-split': { MAP_SPLIT: 'even' },
  'planner-no-hazard-first': { HAZARD_FIRST: false },
  'planner-no-containment': { CONTAINMENT: false },
  'planner-no-doors': { POD_CANVASS_BUILDING: 0, POD_CANVASS_YARD: 0, KNOCK_MIN: 0 },
};

const STEPS = Math.round((HORIZON_MIN * 60) / STEP_S);
const normal = (random) => Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());

// ---- The missing people (ISRID, not our walkers) --------------------------------------------------------

function distanceQuantile(u) {
  for (let i = 1; i < DISTANCE_KNOTS.length; i++) {
    if (u <= DISTANCE_KNOTS[i][0]) {
      const f = (u - DISTANCE_KNOTS[i - 1][0]) / (DISTANCE_KNOTS[i][0] - DISTANCE_KNOTS[i - 1][0]);
      return DISTANCE_KNOTS[i - 1][1] * Math.exp(f * Math.log(DISTANCE_KNOTS[i][1] / DISTANCE_KNOTS[i - 1][1]));
    }
  }
  return DISTANCE_KNOTS[DISTANCE_KNOTS.length - 1][1];
}

// Every square of the map, sorted into "kind of place" and 50 m bands of distance from the
// last-seen point, so a place of a given kind at a given distance can be drawn.
function placeIndex(world) {
  const { n, cls, hazardCell } = world;
  const bands = Object.fromEntries(FIND_SHARES.map(([type]) => [type, []]));
  bands.structureAt = [];
  const add = (type, band, cell) => { (bands[type][band] || (bands[type][band] = [])).push(cell); };
  for (let i = 0; i < cls.length; i++) {
    const p = cellXY(world, i);
    const band = Math.floor(Math.hypot(p.x - world.lastSeen.x, p.y - world.lastSeen.y) / 50);
    const v = cls[i];
    const r = Math.floor(i / n); const c = i % n;
    let nextToBuilding = false; let dryNeighbor = false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr; const c2 = c + dc;
      if (rr < 0 || rr >= n || c2 < 0 || c2 >= n || (!dr && !dc)) continue;
      if (cls[rr * n + c2] === G.BUILDING) nextToBuilding = true;
      if (!hazardCell[rr * n + c2]) dryNeighbor = true;
    }
    if (v === G.BUILDING) add('structure', band, i);
    else if (v === G.ROAD) add('road', band, i);
    else if (v === G.PATH || v === G.SERVICE) add('linear', band, i);
    else if (v === G.CREEK) add('drainage', band, i);
    else if ((v === G.WATER || v === G.WETLAND) && dryNeighbor) add('water', band, i); // at the water's edge
    else if (v === G.WOODS) add('woods', band, i);
    else if (v === G.BRUSH) add('brush', band, i);
    else if ((v === G.YARD || v === G.LOT || v === G.DEVELOPED) && nextToBuilding) add('structureAt', band, i);
    else if (v === G.GRASS || v === G.PARK || v === G.LOT || v === G.DEVELOPED) add('field', band, i);
  }
  return bands;
}

// Where one person ends up: { type, final (square, or -1 = somewhere off the map), distanceM }.
function drawPlace(setup, random) {
  const { bands } = setup;
  const d = distanceQuantile(random());
  let pick = random() * 100;
  let type = 'road';
  for (const [name, share] of FIND_SHARES) { pick -= share; if (pick <= 0) { type = name; break; } }
  // "Structure" = inside a building (half) or right beside one: a porch, a shed, a yard (half). ASSUMPTION.
  const kind = type === 'structure' && random() < 0.5 ? 'structureAt' : type;
  const band = Math.floor(d / 50);
  const slack = Math.max(1, Math.round((0.1 * d) / 50));
  let final = -1;
  for (const k of [kind, 'road']) {
    const pool = [];
    for (let b = Math.max(0, band - slack); b <= band + slack; b++) if (bands[k][b]) pool.push(bands[k][b]);
    const total = pool.reduce((sum, list) => sum + list.length, 0);
    if (total === 0) continue;
    let at = Math.floor(random() * total);
    for (const list of pool) { if (at < list.length) { final = list[at]; break; } at -= list.length; }
    break;
  }
  return { type, final, distanceM: d };
}

// One person: where they end up and how they get there. Returns
//   { type, final, cells (their square at every clock tick of the search, -1 once off the map),
//     moving (still walking when the search starts), distanceM }
function drawPerson(setup, random) {
  const { world, tree } = setup;
  const { type, final, distanceM: d } = drawPlace(setup, random);
  const g = world.g;
  let node;
  if (final >= 0) {
    const p = cellXY(world, final);
    node = nearestNode(world, p.x, p.y, FOOT);
  } else {
    // Bound for somewhere beyond the map: walk to the map's edge in a random direction, then gone.
    const angle = random() * 2 * Math.PI;
    const ux = Math.sin(angle); const uy = Math.cos(angle);
    let best = -Infinity; node = -1;
    for (let i = 0; i < g.N; i++) {
      if (tree.dist[i] === Infinity) continue;
      const x = g.nx[i] - world.lastSeen.x; const y = g.ny[i] - world.lastSeen.y;
      const along = x * ux + y * uy;
      if (along > best && Math.abs(x * uy - y * ux) < 0.3 * along) { best = along; node = i; }
    }
  }
  const way = node >= 0 ? pathTo(world, tree, node) : null;
  const track = way ? trackOfEdges(world, way.edges, way.nodes[0]) : [];
  const lengthM = way ? tree.dist[node] : 0;
  const speed = Math.min(SPEED.max, Math.max(SPEED.min, SPEED.mean + SPEED.sd * normal(random))) * MOVE_SHARE;
  const cells = new Int32Array(STEPS + 1);
  let moving = false;
  for (let k = 0; k <= STEPS; k++) {
    const walked = speed * (setup.sinceMin * 60 + k * STEP_S);
    if (walked >= lengthM || track.length === 0) cells[k] = final; // arrived (or left the map)
    else { cells[k] = track[Math.min(track.length - 1, Math.floor((walked / lengthM) * track.length))]; if (k === 0) moving = true; }
  }
  return { type, final, cells, moving, distanceM: d };
}

// ---- The searchers' timeline ---------------------------------------------------------------------------

// What every searcher is doing at every clock tick.
const PACE = { travel: 0, search: 1, hasty: 2, still: 3, noLook: 4 };
function newTimeline() {
  return {
    cell: Array.from({ length: TEAM }, () => new Int32Array(STEPS + 1).fill(-1)),
    pace: Array.from({ length: TEAM }, () => new Uint8Array(STEPS + 1).fill(PACE.noLook)),
    knocks: [],  // { area (index of the block), k0, k1 }: doors knocked between those ticks
    sweeps: [],  // { area, k0, k1, coverage }: a park swept in lines
    jobs: 0, travelTicks: 0, types: {},
    trace: [], // one line per task given: for looking at what a strategy did
  };
}
// Walks a searcher along a list of squares over [t0, t0 + minutes]; returns the end time (min).
function lay(tl, s, cells, t0, minutes, pace) {
  const k0 = Math.ceil((t0 * 60) / STEP_S);
  const k1 = Math.min(STEPS, Math.floor(((t0 + minutes) * 60) / STEP_S));
  for (let k = k0; k <= k1; k++) {
    const f = minutes > 0 ? ((k * STEP_S) / 60 - t0) / minutes : 1;
    tl.cell[s][k] = cells.length ? cells[Math.min(cells.length - 1, Math.max(0, Math.floor(f * cells.length)))] : -1;
    tl.pace[s][k] = pace;
  }
  if (pace === PACE.travel) tl.travelTicks += Math.max(0, k1 - k0 + 1);
  return t0 + minutes;
}

// ---- One search by one strategy ---------------------------------------------------------------------------

function runSearch(setup, strategy, seed) {
  const { area, world, caseInput } = setup;
  const g = world.g;
  const random = makeRandom(seed);
  const tl = newTimeline();
  const team = Array.from({ length: TEAM }, (_, s) => {
    // Start scattered within about 300 m of the last-seen point (family and neighbors arriving).
    // ...on the street network that joins up with the last-seen point (not a cut-off scrap of path).
    const sx = world.lastSeen.x + (random() - 0.5) * 600; const sy = world.lastSeen.y + (random() - 0.5) * 600;
    let node = -1; let nearest = Infinity;
    for (let i = 0; i < g.N; i++) {
      if (setup.tree.dist[i] === Infinity) continue;
      const d2 = (g.nx[i] - sx) ** 2 + (g.ny[i] - sy) ** 2;
      if (d2 < nearest) { nearest = d2; node = i; }
    }
    return {
      s, id: `v${s}`, freeAt: 0, cell: cellAtXY(world, g.nx[node], g.ny[node]),
      speed: Math.min(1.4, Math.max(0.6, 1 + 0.15 * normal(random))), // their own pace, × the planned pace
      visited: new Set(),
    };
  });
  const isPlanner = strategy.startsWith('planner');
  const params = isPlanner ? PLANNER_PARAMS[strategy] : null;
  const pw = isPlanner ? (strategy === 'planner-no-doors' ? plannerWorld(area, caseInput, params) : { world, segs: setup.segs }) : null;
  tl.segs = pw ? pw.segs : setup.segs; // which cutting of the map the knocks and sweeps refer to
  const events = [];        // the planner's events so far (assigned / completed / released)
  const pending = [];       // events that will be sent when a task ends: { at (minutes), event }
  const searched = [];      // the old app's 'searched' events
  const busy = new Map();   // sector → searcher id (old-style strategies: who is in which area)
  const belief = strategy === 'stats' ? new Map(setup.statsSectors) : null;
  let ringNext = 0;
  let eventNo = 0;
  const nextId = () => `e${String(++eventNo).padStart(5, '0')}`;
  const here = (v, now) => { const k = Math.min(STEPS, Math.round((now * 60) / STEP_S)); return tl.cell[v.s][k] >= 0 ? tl.cell[v.s][k] : v.cell; };
  // Not done as planned: the searcher wanders nearby streets for the same time instead.
  const wander = (fromCell, meters) => {
    const p = cellXY(world, fromCell);
    let at = nearestNode(world, p.x, p.y, FOOT);
    const edges = []; const start = at; let last = -1; let length = 0;
    while (length < meters) {
      const choices = [];
      for (let i = g.adjOff[at]; i < g.adjOff[at + 1]; i++) if ((g.eflags[g.adjEdge[i]] & FOOT) && g.adjEdge[i] !== last) choices.push(i);
      if (choices.length === 0) { if (last < 0) break; last = -1; continue; }
      const i = choices[Math.floor(random() * choices.length)];
      edges.push(g.adjEdge[i]); length += g.elen[g.adjEdge[i]]; last = g.adjEdge[i]; at = g.adjNode[i];
    }
    return trackOfEdges(world, edges, start);
  };
  const pathCells = (fromCell, toPoint) => { // squares walked from a square to a lat/lng by the shortest street path
    const a = cellXY(world, fromCell);
    const from = nearestNode(world, a.x, a.y, FOOT);
    const b = toXY(world, toPoint.lat, toPoint.lng);
    const to = nearestNode(world, b.x, b.y, FOOT);
    const run = shortestFrom(world, from, FOOT);
    const way = pathTo(world, run, to);
    return way ? { cells: trackOfEdges(world, way.edges, way.nodes[0]), meters: run.dist[to] } : null;
  };

  // The old area list: one 200 m area with its routeFor route.
  // The old area list: one 200 m area with its routeFor route. A volunteer gives an area a
  // turn of 20 to 30 minutes (the old app's default is 20): a short route is walked again, back
  // and forth, until the turn is up; a long one is left unfinished at 30 minutes.
  const sectorJob = (v, now, sectorId, prediction) => {
    if (setup.noRoute.has(sectorId)) return false; // an area with (almost) no streets in it
    const route = routeFor(area, prediction, sectorId);
    if (route.points.length < 2 || route.lengthM < MIN_ROUTE_M) { setup.noRoute.add(sectorId); return false; }
    const travel = pathCells(here(v, now), route.points[0]);
    if (!travel) return false;
    const once = trackFromLatLngs(area, caseInput, route.points);
    const turnMin = Math.min(30, Math.max(TURN_MIN, route.minutes));
    let planned = [];
    if (route.minutes > turnMin) planned = once.slice(0, Math.max(1, Math.floor((once.length * turnMin) / route.minutes)));
    else {
      const wanted = Math.ceil((once.length * turnMin) / Math.max(route.minutes, 0.5));
      for (let lap = 0; planned.length < wanted; lap++) planned = planned.concat(lap % 2 ? [...once].reverse() : once);
      planned = planned.slice(0, wanted);
    }
    const followed = random() >= NOT_AS_PLANNED;
    const searchMin = turnMin / v.speed;
    let t = lay(tl, v.s, travel.cells, now, travel.meters / DEFAULTS.TRAVEL_SPEED_MPS / 60 / v.speed, PACE.travel);
    const walked = followed ? planned : wander(planned[0], DEFAULTS.SEARCH_SPEED_MPS * searchMin * 60);
    t = lay(tl, v.s, walked, t, searchMin, PACE.search);
    v.freeAt = t; v.cell = walked.length ? walked[walked.length - 1] : here(v, now);
    v.visited.add(sectorId);
    busy.set(sectorId, v.id);
    // Half of those who did something else still press "done".
    const reports = followed || random() < 0.5;
    pending.push({ at: t, sectorId, by: v.id, searchedEvent: reports ? { id: nextId(), type: 'searched', sectorId, minutes: Math.max(1, Math.round(turnMin)), by: v.id, at: NOON + t * 60000 } : null });
    tl.jobs += 1; tl.types.area = (tl.types.area || 0) + 1;
    return true;
  };

  const plannerJob = (v, now, option, partnerOf) => {
    const points = option.route.points;
    const travelCells = trackFromLatLngs(area, caseInput, points.slice(0, option.route.searchFrom + 1));
    let t = lay(tl, v.s, travelCells, now, option.travelMin / v.speed, PACE.travel);
    const followed = partnerOf ? partnerOf.followed : random() >= NOT_AS_PLANNED;
    const searchMin = option.searchMin / v.speed;
    const k0 = Math.ceil((t * 60) / STEP_S);
    const entry = travelCells.length ? travelCells[travelCells.length - 1] : here(v, now);
    let endCell = entry;
    if (!followed) {
      const walked = wander(entry, DEFAULTS.SEARCH_SPEED_MPS * searchMin * 60);
      t = lay(tl, v.s, walked, t, searchMin, partnerOf ? PACE.noLook : PACE.search);
      if (walked.length) endCell = walked[walked.length - 1];
    } else if (option.type === 'park') {
      t = lay(tl, v.s, [entry], t, searchMin, PACE.noLook); // found by the sweep itself, below
      const areaIndex = pw.segs.areas.indexOf(pw.segs.tasks.get(option.taskId));
      const lineMeters = pw.segs.tasks.get(option.taskId).lineMetersDay;
      tl.sweeps.push({ area: areaIndex, k0, k1: Math.min(STEPS, Math.floor((t * 60) / STEP_S)), coverage: (option.searchMin * 60 * DEFAULTS.SEARCH_SPEED_MPS) / lineMeters });
    } else if (option.type === 'containment') {
      t = lay(tl, v.s, [entry], t, searchMin, PACE.still);
    } else {
      const track = Array.from(option.route.track);
      // A pair walks together and is one look: the partner's eyes are not counted twice.
      t = lay(tl, v.s, track, t, searchMin, partnerOf ? PACE.noLook : option.type === 'hasty' ? PACE.hasty : PACE.search);
      if (track.length) endCell = track[track.length - 1];
      if (option.type === 'yards' && option.canvass && strategy !== 'planner-no-doors') {
        tl.knocks.push({ area: pw.segs.areas.indexOf(pw.segs.tasks.get(option.taskId)), k0, k1: Math.min(STEPS, Math.floor((t * 60) / STEP_S)) });
      }
    }
    v.freeAt = t; v.cell = endCell;
    const accepted = { id: nextId(), ...assignedEvent(option, v.id, NOON + now * 60000) };
    events.push(accepted);
    const reports = followed || random() < 0.5;
    pending.push({
      at: t,
      event: reports
        ? { id: nextId(), type: 'completed', searcherId: v.id, taskId: option.taskId, at: NOON + t * 60000, ...(option.partnerId ? { partnerId: option.partnerId } : {}) }
        : { id: nextId(), type: 'released', searcherId: v.id, taskId: option.taskId, at: NOON + t * 60000 },
    });
    tl.jobs += 1; tl.types[option.type] = (tl.types[option.type] || 0) + 1;
    tl.trace.push({ at: Math.round(now), who: v.id, type: option.type, task: option.taskId, gainPct: Math.round(option.posGain * 1000) / 10, travel: Math.round(option.travelMin), search: Math.round(option.searchMin), followed, pair: option.partnerId || '' });
    return { followed };
  };

  for (let guard = 0; guard < 5000; guard++) {
    const now = Math.min(...team.map((v) => v.freeAt));
    if (now >= HORIZON_MIN) break;
    // What has finished by now is reported.
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= now + 1e-9) {
      const item = pending.shift();
      if (item.event) events.push(item.event);
      if (item.sectorId) {
        if (busy.get(item.sectorId) === item.by) busy.delete(item.sectorId);
        if (item.searchedEvent) {
          searched.push(item.searchedEvent);
          if (belief) {
            belief.set(item.sectorId, belief.get(item.sectorId) * (1 - podForMinutes(item.searchedEvent.minutes)));
            let total = 0;
            for (const p of belief.values()) total += p;
            for (const [id, p] of belief) belief.set(id, p / total);
          }
        }
      }
    }
    const free = team.filter((v) => v.freeAt <= now + 1e-9);
    const tick = Math.floor(now / 5); // the app re-runs the engine every 5 minutes of clock time

    if (isPlanner) {
      const prediction = strategy === 'planner-stats-map' ? setup.statsPrediction : setup.predictionAt(tick);
      const map = plannerMap(pw.world, prediction, withParams(params));
      const plan = planOnWorld(pw.world, pw.segs, {
        p: map.p, restOfWorld: map.restOfWorld, hazard: map.hazard, events,
        searchers: team.map((v) => ({ id: v.id, ...cellXY(pw.world, here(v, now)), mode: 'foot', updatedAgoMin: 0 })),
        clock: { nowMs: NOON + now * 60000, minutesSinceLastSeen: setup.sinceMin + now },
      }, params);
      const done = new Map();
      for (const v of free) {
        const mine = plan.searchers.find((x) => x.searcherId === v.id);
        if (!mine || !mine.primary || mine.keep) { v.freeAt = now + 5; continue; } // nothing useful: wait
        const partner = mine.primary.partnerId ? done.get(mine.primary.partnerId) : null;
        done.set(v.id, plannerJob(v, now, mine.primary, partner));
      }
      continue;
    }

    for (const v of free) {
      let given = false;
      if (strategy === 'own') {
        // Picks a nearby area at random (closer is likelier), never one they searched before.
        let pool = setup.nearby.filter((x) => !v.visited.has(x.id));
        if (pool.length === 0) { v.visited.clear(); pool = setup.nearby; }
        for (let tries = 0; tries < 8 && !given; tries++) {
          let r = random() * pool.reduce((sum, x) => sum + x.weight, 0);
          let pick = pool[pool.length - 1];
          for (const x of pool) { r -= x.weight; if (r <= 0) { pick = x; break; } }
          given = sectorJob(v, now, pick.id, setup.prediction0);
          v.visited.add(pick.id);
        }
      } else if (strategy === 'ring') {
        // Nearest areas first, each once; at the end of the list, start again.
        for (let tries = 0; tries < setup.byDistance.length && !given; tries++) {
          const id = setup.byDistance[ringNext % setup.byDistance.length].id;
          ringNext += 1;
          given = sectorJob(v, now, id, setup.prediction0);
        }
      } else if (strategy === 'stats') {
        // The likeliest area on the statistics map that nobody is in.
        const order = [...belief.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
        for (const [id] of order) { if (busy.has(id) || setup.noRoute.has(id)) continue; given = sectorJob(v, now, id, setup.prediction0); if (given) break; }
      } else {
        // The old app: the engine's own list of the 3 next areas. A volunteer takes the first
        // one nobody else has taken; if all three are taken, the top one anyway.
        const prediction = replay(area, { ...caseInput, minutes: setup.sinceMin + 5 * tick }, searched);
        const list = nextSectors(prediction, 20, 12);
        for (let attempt = 0; attempt < 6 && !given; attempt++) {
          const top = list.filter((x) => !setup.noRoute.has(x.sectorId)).slice(0, 3); // areas with no streets are skipped
          const pick = top.find((x) => !busy.has(x.sectorId)) || top[0];
          if (!pick) break;
          given = sectorJob(v, now, pick.sectorId, prediction);
        }
      }
      if (!given) v.freeAt = now + 5;
    }
  }
  return tl;
}

// ---- Was the person found, and when? -----------------------------------------------------------------------

// Minutes into the search at which each person is found (Infinity = not within the run).
function findTimes(setup, tl, people, seed) {
  const { world, truth } = setup;
  const segs = tl.segs;
  const { n, vis } = world;
  const range = LOOK_RANGE_M / world.cellM;
  const paceFactor = [DEFAULTS.HASTY_W_FACTOR, 1, DEFAULTS.HASTY_W_FACTOR, 1, 0]; // travelling counts as a hasty look
  return people.map((person, i) => {
    const random = makeRandom((seed + 7919 * (i + 1)) >>> 0);
    let found = Infinity;
    const minDist = new Float64Array(TEAM).fill(Infinity);
    const minTick = new Int32Array(TEAM);
    const minW = new Float64Array(TEAM);
    const settle = (s) => { // the searcher has gone past: did they see the person?
      if (minDist[s] === Infinity) return;
      const p = minW[s] > 0 ? DEFAULTS.P0 * Math.exp((-2 * DEFAULTS.P0 * minDist[s]) / minW[s]) : 0;
      if (random() < p) found = Math.min(found, (minTick[s] * STEP_S) / 60);
      minDist[s] = Infinity;
    };
    for (let k = 0; k <= STEPS; k++) {
      const at = person.cells[k];
      for (let s = 0; s < TEAM; s++) {
        const cell = tl.cell[s][k];
        const pace = tl.pace[s][k];
        if (at < 0 || cell < 0 || pace === PACE.noLook) { settle(s); continue; }
        const d = Math.hypot(Math.floor(at / n) - Math.floor(cell / n), (at % n) - (cell % n));
        if (d > range) { settle(s); continue; }
        if (d * world.cellM < minDist[s]) {
          minDist[s] = d * world.cellM; minTick[s] = k;
          minW[s] = DEFAULTS.W_DAY[vis[at]] * truth.width[vis[at]] * paceFactor[pace];
        }
      }
    }
    for (let s = 0; s < TEAM; s++) settle(s);
    // Door-knocking: only for a person in a building or a back yard of that block at the time.
    // Whether that household answers and finds them is fixed for the run: asking twice gets
    // the same answer.
    for (const knock of tl.knocks) {
      const at = person.cells[Math.round((knock.k0 + knock.k1) / 2)];
      if (at < 0 || segs.label[at] !== knock.area) continue;
      const pod = vis[at] === V.BUILDING ? truth.podBuilding : vis[at] === V.YARD ? truth.podYard : 0;
      const door = makeRandom((seed + 104729 * (i + 1) + 31 * knock.area) >>> 0);
      if (door() < pod) found = Math.min(found, ((knock.k0 + door() * (knock.k1 - knock.k0)) * STEP_S) / 60);
    }
    for (const sweep of tl.sweeps) {
      const at = person.cells[Math.round((sweep.k0 + sweep.k1) / 2)];
      if (at < 0 || segs.label[at] !== sweep.area) continue;
      if (random() < 1 - Math.exp(-sweep.coverage * truth.width[V.OPEN])) found = Math.min(found, ((sweep.k0 + random() * (sweep.k1 - sweep.k0)) * STEP_S) / 60);
    }
    return found;
  });
}

// ---- A setup: one start point, one "time since last seen" ----------------------------------------------------

function makeSetup(area, start, sinceMin, index, peopleCount) {
  const caseInput = { lastSeen: { lat: start.lat, lng: start.lng }, minutes: sinceMin, direction: null, mobility: 'normal', familiarPlaces: [], seed: 4000 + index };
  const { world, segs } = plannerWorld(area, caseInput);
  const random = makeRandom(90000 + index);
  const predictions = new Map();
  const predictionAt = (tick) => {
    if (!predictions.has(tick)) predictions.set(tick, replay(area, { ...caseInput, minutes: sinceMin + 5 * tick }, []));
    return predictions.get(tick);
  };
  const setup = {
    index, area, caseInput, sinceMin, world, segs, predictionAt, prediction0: predictionAt(0),
    bands: placeIndex(world), tree: shortestFrom(world, world.lastSeenNode, FOOT), noRoute: new Set(),
    // The world as it really is, which the planner does not know: sweep widths and door-knock
    // values off by up to ±TRUE_SPREAD from what it assumes.
    truth: {
      width: Array.from({ length: 6 }, () => 1 + TRUE_SPREAD * (2 * random() - 1)),
      podBuilding: Math.min(0.95, DEFAULTS.POD_CANVASS_BUILDING * (1 + TRUE_SPREAD * (2 * random() - 1))),
      podYard: Math.min(0.95, DEFAULTS.POD_CANVASS_YARD * (1 + TRUE_SPREAD * (2 * random() - 1))),
    },
  };
  // The old 200 m areas near the last-seen point, for the baselines.
  const ls = world.lastSeen;
  const sectors = setup.prediction0.grid.sectors.map((s) => {
    const c = toXY(world, s.center.lat, s.center.lng);
    return { id: s.id, distance: Math.hypot(c.x - ls.x, c.y - ls.y) };
  });
  const within = sectors.filter((s) => s.distance <= 1609).sort((a, b) => (a.distance - b.distance) || (a.id < b.id ? -1 : 1));
  setup.byDistance = within;
  setup.nearby = within.map((s) => ({ id: s.id, weight: Math.exp(-s.distance / 800) }));
  // The plain statistics map: where 60,000 people drawn from the ISRID recipe end up. Per old
  // 200 m area for the "statistics map" baseline, and per 25 m square (the engine's own map
  // format) for the planner run on the same map.
  const counts = new Map(sectors.map((s) => [s.id, 0.5]));
  const cols = 32; const size = 200; const halfM = world.half;
  const fine = new Float64Array(256 * 256);
  const statsRandom = makeRandom(70000 + index);
  const DRAWS = 60000;
  let onMap = 0;
  for (let i = 0; i < DRAWS; i++) {
    const place = drawPlace(setup, statsRandom);
    if (place.final < 0) continue;
    onMap += 1;
    const p = cellXY(world, place.final);
    const sc = Math.floor((p.x + halfM) / size); const sr = Math.floor((p.y + halfM) / size);
    if (sc >= 0 && sr >= 0 && sc < cols && sr < cols) counts.set(`r${sr}c${sc}`, (counts.get(`r${sr}c${sc}`) || 0.5) + 1);
    fine[Math.floor((p.y + halfM) / 25) * 256 + Math.floor((p.x + halfM) / 25)] += 1 / DRAWS;
  }
  let total = 0;
  for (const v of counts.values()) total += v;
  setup.statsSectors = [...counts.entries()].map(([id, v]) => [id, v / total]);
  setup.statsPrediction = { grid: { p: fine, cols: 256, rows: 256, cellSize: 25 }, restOfWorld: 1 - onMap / DRAWS };
  const peopleRandom = makeRandom(50000 + index);
  setup.people = Array.from({ length: peopleCount }, () => drawPerson(setup, peopleRandom));
  return setup;
}

// One strategy on one setup, with the list of tasks it gave (for a close look; not used by the report).
export function traceOne({ setupIndex = 1, strategy = 'planner', people = 250 } = {}) {
  const area = prepareArea(JSON.parse(fs.readFileSync(new URL('../tests/fixtures/demo-area.json', import.meta.url))));
  const start = STARTS[(setupIndex - 1) % STARTS.length];
  const sinceMin = SINCE_MIN[Math.floor((setupIndex - 1) / STARTS.length)];
  const setup = makeSetup(area, start, sinceMin, setupIndex, people);
  const tl = runSearch(setup, strategy, 1000 * setupIndex + 7);
  return { setup, tl, times: findTimes(setup, tl, setup.people, 31 * setupIndex) };
}

// ---- The whole evaluation -----------------------------------------------------------------------------------

export function runEval({ setups = STARTS.length * SINCE_MIN.length, peoplePerSetup = 250, strategies = STRATEGIES, osm = null, log = () => {} } = {}) {
  const data = osm || JSON.parse(fs.readFileSync(new URL('../tests/fixtures/demo-area.json', import.meta.url)));
  const area = prepareArea(data);
  const results = []; // one per setup: { people: [{ type, moving, offMap }], times: { strategy: [minutes] }, notes }
  let index = 0;
  for (const sinceMin of SINCE_MIN) {
    for (const start of STARTS) {
      if (index >= setups) break;
      index += 1;
      const t0 = Date.now();
      const setup = makeSetup(area, start, sinceMin, index, peoplePerSetup);
      const times = {}; const notes = {};
      for (const strategy of strategies) {
        const tl = runSearch(setup, strategy, 1000 * index + 7);
        times[strategy] = findTimes(setup, tl, setup.people, 31 * index);
        notes[strategy] = { jobs: tl.jobs, travelShare: tl.travelTicks / (TEAM * (STEPS + 1)), types: tl.types };
      }
      results.push({
        index, start, sinceMin, times, notes,
        people: setup.people.map((p) => ({ type: p.type, moving: p.moving, offMap: p.final < 0 })),
      });
      log(`setup ${index}: ${sinceMin} min since last seen, ${(Date.now() - t0) / 1000 | 0} s; found by ${HORIZON_MIN} min: ` + strategies.map((s) => `${s} ${Math.round(100 * times[s].filter((t) => t <= HORIZON_MIN).length / peoplePerSetup)}%`).join(', '));
    }
  }
  return { results, strategies, peoplePerSetup };
}

// Share found by `minutes`, and expected time to find capped at the run length, over a list of
// [setup, person] picks. `keep` chooses a group of people (all of them if absent).
function measure(results, picks, strategy, keep) {
  const found = CHECKPOINTS.map(() => 0);
  let count = 0; let time = 0;
  for (const [r, i] of picks) {
    if (keep && !keep(results[r].people[i])) continue;
    const t = results[r].times[strategy][i];
    count += 1;
    time += Math.min(t, HORIZON_MIN);
    CHECKPOINTS.forEach((c, k) => { if (t <= c) found[k] += 1; });
  }
  return { count, share: found.map((f) => (count ? f / count : NaN)), meanMin: count ? time / count : NaN };
}

// 95% intervals by resampling setups, then people inside each setup (a "cluster bootstrap").
// With S setups the interval mostly reflects how different the setups are from each other.
export function summarize({ results, strategies }, { boots = 1000, keep = null, seed = 1 } = {}) {
  const all = [];
  results.forEach((res, r) => res.people.forEach((_, i) => all.push([r, i])));
  const point = Object.fromEntries(strategies.map((s) => [s, measure(results, all, s, keep)]));
  const random = makeRandom(seed);
  const draws = Object.fromEntries(strategies.map((s) => [s, []]));
  for (let b = 0; b < boots; b++) {
    const picks = [];
    for (let k = 0; k < results.length; k++) {
      const r = Math.floor(random() * results.length);
      const size = results[r].people.length;
      for (let j = 0; j < size; j++) picks.push([r, Math.floor(random() * size)]);
    }
    for (const s of strategies) draws[s].push(measure(results, picks, s, keep));
  }
  const interval = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? [sorted[Math.floor(0.025 * (sorted.length - 1))], sorted[Math.ceil(0.975 * (sorted.length - 1))]] : [NaN, NaN];
  };
  const out = {};
  for (const s of strategies) {
    out[s] = {
      count: point[s].count,
      share: point[s].share.map((v, k) => ({ value: v, ci: interval(draws[s].map((d) => d.share[k])) })),
      meanMin: { value: point[s].meanMin, ci: interval(draws[s].map((d) => d.meanMin)) },
    };
  }
  // Differences are taken draw by draw on the same resampled people, so shared luck cancels.
  const versus = (a, b) => ({
    share: CHECKPOINTS.map((_, k) => ({ value: point[a].share[k] - point[b].share[k], ci: interval(draws[a].map((d, j) => d.share[k] - draws[b][j].share[k])) })),
    meanMin: { value: point[a].meanMin - point[b].meanMin, ci: interval(draws[a].map((d, j) => d.meanMin - draws[b][j].meanMin)) },
  });
  return { stats: out, versus };
}

// ---- The report ---------------------------------------------------------------------------------------------

const pct = (v) => (Number.isFinite(v) ? `${Math.round(100 * v)}%` : 'n/a');
const signed = (v, digits = 0) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}` : 'n/a');
const ptsCI = (x) => `${signed(100 * x.value)} (${signed(100 * x.ci[0])} to ${signed(100 * x.ci[1])})`;
const minCI = (x) => `${signed(x.value)} (${signed(x.ci[0])} to ${signed(x.ci[1])})`;

export function reportMarkdown(run, { seconds = 0, date = '' } = {}) {
  const { results, strategies, peoplePerSetup } = run;
  const total = results.length * peoplePerSetup;
  const everyone = summarize(run);
  const lines = [];
  const table = (summary, list = strategies) => {
    lines.push(`| Strategy | ${CHECKPOINTS.map((c) => `Found by ${c} min`).join(' | ')} | Expected minutes to find (capped at ${HORIZON_MIN}) |`);
    lines.push(`|---|${CHECKPOINTS.map(() => '---').join('|')}|---|`);
    for (const s of list) {
      const x = summary.stats[s];
      lines.push(`| ${NAMES[s]} | ${x.share.map((v) => `${pct(v.value)} (${pct(v.ci[0])}–${pct(v.ci[1])})`).join(' | ')} | ${x.meanMin.value.toFixed(0)} (${x.meanMin.ci[0].toFixed(0)}–${x.meanMin.ci[1].toFixed(0)}) |`);
    }
    lines.push('');
  };
  const group = (keep) => summarize(run, { keep });
  const people = results.flatMap((r) => r.people);
  const share = (f) => pct(people.filter(f).length / people.length);

  lines.push('# Search planner: benchmark report', '');
  lines.push(`Made by \`node bench/planner-eval.js\`${date ? ` on ${date}` : ''}${seconds ? ` (${Math.round(seconds / 60)} min)` : ''}. ${results.length} setups (${new Set(results.map((r) => `${r.start.lat},${r.start.lng}`)).size} start points × ${new Set(results.map((r) => r.sinceMin)).size} times since last seen) × ${peoplePerSetup} simulated people = ${total.toLocaleString('en-US')} cases, each played by every strategy. ${TEAM} searchers on foot, ${HORIZON_MIN} minutes of searching, in daylight.`, '');
  lines.push('**Read this first.** Everything here is simulated. The people come from ISRID statistics, the searchers and the chance of spotting someone are modeled, and no real search was run. The numbers say how the strategies compare under these assumptions, not how many people a real team would find. Ranges in brackets are 95% intervals from resampling setups; with this few setups they are wide.', '');

  lines.push('## Everyone', '');
  table(everyone);
  lines.push(`Who they are: ${share((p) => p.offMap)} end up off the map and can only be found on their way out; ${share((p) => p.moving)} are still walking when the search starts; ${share((p) => p.type === 'structure')} end up in or at a structure; ${share((p) => p.type === 'water' || p.type === 'drainage')} in water or a drainage.`, '');

  lines.push('## Planner against each baseline (same people, paired)', '');
  lines.push(`| Planner minus … | ${CHECKPOINTS.map((c) => `Found by ${c} min, points`).join(' | ')} | Minutes to find |`);
  lines.push(`|---|${CHECKPOINTS.map(() => '---').join('|')}|---|`);
  for (const s of strategies.filter((x) => !x.startsWith('planner'))) {
    const v = everyone.versus('planner', s);
    lines.push(`| ${NAMES[s]} | ${v.share.map(ptsCI).join(' | ')} | ${minCI(v.meanMin)} |`);
  }
  lines.push('', 'A range that does not include 0 is a difference this run can tell from chance. Negative minutes mean the planner is faster.', '');

  lines.push('## What each part of the planner is worth', '');
  lines.push(`| Planner minus … | ${CHECKPOINTS.map((c) => `Found by ${c} min, points`).join(' | ')} | Minutes to find |`);
  lines.push(`|---|${CHECKPOINTS.map(() => '---').join('|')}|---|`);
  for (const s of strategies.filter((x) => x.startsWith('planner-'))) {
    const v = everyone.versus('planner', s);
    lines.push(`| ${NAMES[s]} | ${v.share.map(ptsCI).join(' | ')} | ${minCI(v.meanMin)} |`);
  }
  lines.push('');

  const hazard = group((p) => p.type === 'water' || p.type === 'drainage');
  lines.push('## The hazard-first rule (ASSUMPTION), tested', '');
  lines.push(`People who end up in water or a drainage (${hazard.stats.planner.count} of ${total.toLocaleString('en-US')}):`, '');
  table(hazard, strategies.filter((s) => s === 'planner' || s === 'planner-no-hazard-first' || s === 'old'));
  if (strategies.includes('planner-no-hazard-first')) {
    const h = hazard.versus('planner', 'planner-no-hazard-first');
    const e = everyone.versus('planner', 'planner-no-hazard-first');
    lines.push(`Rule on minus rule off, for these people: ${CHECKPOINTS.map((c, k) => `${ptsCI(h.share[k])} points by ${c} min`).join('; ')}; ${minCI(h.meanMin)} minutes to find.`, '');
    lines.push(`Rule on minus rule off, for everyone: ${CHECKPOINTS.map((c, k) => `${ptsCI(e.share[k])} points by ${c} min`).join('; ')}; ${minCI(e.meanMin)} minutes to find.`, '');
  }

  lines.push('## By where the person ends up (planner and old app)', '');
  lines.push(`| Group | People | Planner, found by ${HORIZON_MIN} min | Old app, found by ${HORIZON_MIN} min | Planner, minutes | Old app, minutes |`, '|---|---|---|---|---|---|');
  const last = CHECKPOINTS.length - 1;
  const groups = [
    ['In or at a structure', (p) => p.type === 'structure'], ['On a road', (p) => p.type === 'road'],
    ['Path or other linear feature', (p) => p.type === 'linear'], ['Field or open ground', (p) => p.type === 'field'],
    ['Water or drainage', (p) => p.type === 'water' || p.type === 'drainage'], ['Woods or brush', (p) => p.type === 'woods' || p.type === 'brush'],
    ['Still walking when the search starts', (p) => p.moving], ['Already stopped', (p) => !p.moving && !p.offMap],
    ['Ends up off the map', (p) => p.offMap],
  ];
  for (const [name, keep] of groups) {
    const x = group(keep);
    if (!x.stats.planner.count) continue;
    const a = x.stats.planner; const b = x.stats.old || a;
    lines.push(`| ${name} | ${a.count} | ${pct(a.share[last].value)} (${pct(a.share[last].ci[0])}–${pct(a.share[last].ci[1])}) | ${pct(b.share[last].value)} (${pct(b.share[last].ci[0])}–${pct(b.share[last].ci[1])}) | ${a.meanMin.value.toFixed(0)} | ${b.meanMin.value.toFixed(0)} |`);
  }
  lines.push('');

  lines.push('## What the searchers did', '');
  lines.push('| Strategy | Tasks per search | Share of time travelling | Task types |', '|---|---|---|---|');
  for (const s of strategies) {
    const notes = results.map((r) => r.notes[s]);
    const types = {};
    for (const note of notes) for (const [k, v] of Object.entries(note.types)) types[k] = (types[k] || 0) + v;
    const sum = Object.values(types).reduce((a, b) => a + b, 0) || 1;
    lines.push(`| ${NAMES[s]} | ${(notes.reduce((a, x) => a + x.jobs, 0) / notes.length).toFixed(0)} | ${pct(notes.reduce((a, x) => a + x.travelShare, 0) / notes.length)} | ${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / sum)}`).join(', ')} |`);
  }
  lines.push('');

  lines.push('## Setup by setup: found by the end', '');
  lines.push(`| Setup | Since last seen | ${strategies.map((s) => NAMES[s]).join(' | ')} |`, `|---|---|${strategies.map(() => '---').join('|')}|`);
  for (const r of results) lines.push(`| ${r.index} (${r.start.lat}, ${r.start.lng}) | ${r.sinceMin} min | ${strategies.map((s) => pct(r.times[s].filter((t) => t <= HORIZON_MIN).length / r.people.length)).join(' | ')} |`);
  lines.push('');

  lines.push('## How it works', '');
  lines.push(
    '- **People.** Distance from the last-seen point and kind of place are drawn from ISRID urban dementia statistics (0.3 / 1.1 / 3.2 / 12.6 km at 25 / 50 / 75 / 95%; structure 35, road 36, linear 9, field 6, water 6, drainage 4, woods 3, brush 1), then a real square of that kind at that distance is picked on the Fremont map. None of this uses the app\'s walkers.',
    `- **Movement.** Each person walks to their place along the shortest street path at a pace drawn from Toots et al. 2019 (0.62 ± 0.23 m/s), moving ${Math.round(MOVE_SHARE * 100)}% of the time (ASSUMPTION), starting when they were last seen. Those who have not arrived are on the way while the search runs. A quarter of ISRID's distances are beyond this 6.4 km map: those people walk off it and can only be found before they leave.`,
    `- **Searchers.** ${TEAM} on foot, starting within about 300 m of the last-seen point. Travel is walked on the street graph at 1.3 m/s times each searcher's own pace (±15%). ${Math.round(NOT_AS_PLANNED * 100)}% of tasks are not done as planned: the searcher wanders nearby for the same time, and half of those still report the task done, so the plan is credited with work that did not happen.`,
    `- **Detection.** A searcher passing within ${LOOK_RANGE_M} m spots the person with probability 0.9 · e^(−1.8 d / W) at their closest approach, where W is the TRUE sweep width for the kind of ground the person is on: the planner's value times a factor drawn per setup between ${1 - TRUE_SPREAD} and ${1 + TRUE_SPREAD}. Travelling counts as a hasty look. A person inside a building is never seen from outside. Door-knocking finds a person in that block's buildings or back yards with the true door-knock value (the planner's ± ${Math.round(TRUE_SPREAD * 100)}%), and a household gives the same answer every time it is asked.`,
    '- **The map each strategy sees.** The planner and the old app both get the engine\'s real map, re-run every 5 minutes of clock time as the app does. The planner is given no GPS trails: it believes its routes were walked as planned.',
    '- **Planner variants.** "On the plain statistics map": the planner is given the statistics baseline\'s map instead of the app\'s, so the two differ only in method. "Split evenly": the app\'s 25 m map is shared out evenly over 10 m squares instead of by ISRID find-location shares. The others switch one rule off.',
    '- **Baselines.** "On their own": each volunteer picks a 200 m area within a mile at random, closer being likelier, never one they searched themselves. "Ring sweep": areas within a mile, nearest first, starting over at the end. "Statistics map": the old greedy rule on a map made from the ISRID recipe itself (60,000 draws per setup), with Bayes after each empty search. "Old app": the engine\'s `nextSectors` top three; a volunteer takes the first one nobody else is in. All four walk the old `routeFor` routes, giving each area a turn of 20 to 30 minutes (a short route is walked again until 20 minutes are up) and skipping areas with under 150 m of street.',
    '- **Intervals.** 1,000 resamples of setups with replacement, then of people inside each resampled setup. Differences are computed inside each resample on the same people.',
    '');
  lines.push('## Limits', '');
  lines.push(
    '- One town. Every setup is in Fremont, on one map download.',
    '- The "statistics map" baseline is given the same recipe that placed the people, so it is the best any map could be for people who have stopped. The planner uses the app\'s map, which does not know that recipe, except in the "on the plain statistics map" row.',
    '- The detection model has the same shape as the planner\'s own. Its numbers are shifted per setup, but a real search could differ in shape too.',
    '- Searchers in cars and searches at night are not in this run.',
    '- A found person ends the case. Nothing here models a sighting, a phone call, or the person coming home.',
    '- Each setup uses one team start and one draw of who does not follow the plan.',
    '');
  return lines.join('\n');
}

// ---- Command line -----------------------------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const quick = process.argv.includes('--quick');
  const t0 = Date.now();
  const run = runEval({ setups: quick ? 2 : undefined, peoplePerSetup: quick ? 100 : 250, log: (m) => console.log(m) });
  const seconds = (Date.now() - t0) / 1000;
  const md = reportMarkdown(run, { seconds, date: new Date().toISOString().slice(0, 10) });
  if (quick) console.log(`\n${md}`);
  else {
    fs.writeFileSync(new URL('./planner-report.md', import.meta.url), md);
    fs.writeFileSync(new URL('./planner-results.json', import.meta.url), JSON.stringify({ results: run.results.map((r) => ({ ...r, times: Object.fromEntries(Object.entries(r.times).map(([k, v]) => [k, v.map((t) => (Number.isFinite(t) ? Math.round(t * 10) / 10 : null))])) })), strategies: run.strategies, peoplePerSetup: run.peoplePerSetup }));
    console.log(`\nWrote bench/planner-report.md and bench/planner-results.json (${Math.round(seconds)} s)`);
  }
}
