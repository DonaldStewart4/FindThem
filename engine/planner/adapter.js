// engine/planner/adapter.js — the ONE file that connects the planner to the engine.
//
// The planner itself (world.js, segments.js, routes.js, detect.js, plan.js) never imports the
// engine. This file turns the engine's objects into the planner's input:
//
//   area + caseInput   → the planner's world (ground classes, street graph in flat arrays,
//                         rail and motorway marks, bus stops) and its search segments, built
//                         once per case and kept
//   prediction         → probability per 10 m square (+ the hazard layer)
//   searchers, events  → passed on
//
// When the engine changes (a 10 m map, a hazard layer, reading `completed` events itself),
// this is the file to edit. See the notes marked MERGE.

import { surfaceFor, SURFACE_N, SURFACE_CELL_M, C } from '../surface.js';
import { gridOriginFor } from '../grid.js';
import { buildWorld, toXY, cellAtXY } from './world.js';
import { buildSegments } from './segments.js';
import { planSearch as plan, posterior, readEvents, assignedEvent } from './plan.js';
import { withParams, SPECIAL, G } from './params.js';

export { C as ENGINE_CLASSES, G as PLANNER_CLASSES };

const worlds = new WeakMap(); // the engine's ground map → Map(key → { world, segs })
const maps = new WeakMap();   // prediction → { p, restOfWorld, hazard }

// The planner's world and segments for a case. Built on first use (about a second on a laptop
// for the Fremont map), then kept for as long as the engine keeps its ground map.
export function plannerWorld(area, caseInput, overrides) {
  const P = withParams(overrides);
  const origin = gridOriginFor(caseInput);
  const surface = surfaceFor(area, origin);
  if (!worlds.has(surface)) worlds.set(surface, new Map());
  const cache = worlds.get(surface);
  const key = `${caseInput.lastSeen.lat},${caseInput.lastSeen.lng}|${JSON.stringify(overrides || null)}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size >= 2) cache.clear();

  const n = SURFACE_N;
  const frame = { origin, half: (n * SURFACE_CELL_M) / 2, cellM: SURFACE_CELL_M, n };
  const { nodes, edges } = area.graph;
  const x = new Float64Array(nodes.length);
  const y = new Float64Array(nodes.length);
  nodes.forEach((node, i) => { const p = toXY(frame, node.lat, node.lng); x[i] = p.x; y[i] = p.y; });

  // Rail lines and motorways, from the map download's ground layers. They are drawn one square
  // thick plus the squares beside them, so a street crossing one always shares a square with it.
  const special = new Uint8Array(n * n);
  const busStops = [];
  const layers = area.osm && area.osm.layers;
  if (layers) {
    const unit = layers.unitDeg;
    for (const line of layers.lines || []) {
      const mark = line.kind === 'rail' ? SPECIAL.RAIL : line.kind === 'motorway' ? SPECIAL.MOTORWAY : 0;
      if (!mark) continue;
      // Reverse of data.js packPoints(): steps of `unit` degrees from the download's center.
      let lat = Math.round(area.osm.center.lat / unit);
      let lng = Math.round(area.osm.center.lng / unit);
      let prev = null;
      for (let i = 0; i + 1 < line.pts.length; i += 2) {
        lat += line.pts[i]; lng += line.pts[i + 1];
        const p = toXY(frame, lat * unit, lng * unit);
        if (prev) {
          const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (SURFACE_CELL_M / 2)));
          for (let s = 0; s <= steps; s++) {
            const cell = cellAtXY(frame, prev.x + ((p.x - prev.x) * s) / steps, prev.y + ((p.y - prev.y) * s) / steps);
            if (cell < 0) continue;
            for (const j of [cell, cell - 1, cell + 1, cell - n, cell + n]) {
              if (j >= 0 && j < special.length && Math.abs((j % n) - (cell % n)) <= 1) special[j] = mark;
            }
          }
        }
        prev = p;
      }
    }
    for (const [lat, lng] of layers.busStops || []) { const p = toXY(frame, lat, lng); busStops.push([p.x, p.y]); }
  }

  const world = buildWorld({
    n, cellM: SURFACE_CELL_M, origin, cls: surface.cls, special,
    nodes: { x, y },
    edges: { a: edges.map((e) => e.a), b: edges.map((e) => e.b), highway: edges.map((e) => e.highway) },
    busStops,
    lastSeen: toXY(frame, caseInput.lastSeen.lat, caseInput.lastSeen.lng),
  }, P);
  world.findWeight = findWeights(world, surface.nearBuilding, P);
  const built = { world, segs: buildSegments(world, P) };
  cache.set(key, built);
  return built;
}

// How often people are found on each 10 m square's kind of ground, per square of that kind:
// ISRID's find-location share for the kind ÷ how many squares of that kind the map has.
//   structure  building squares and the open ground touching a building (the engine's own
//              "at a structure" layer); road; linear = paths and service ways; field = grass,
//              parks, lots, yards and plain ground away from buildings; water = the water's
//              edge; drainage = creeks and channels; woods; brush.
// Spreading "structure" evenly over inside and beside the building is an ASSUMPTION.
function findWeights(world, nearBuilding, P) {
  const { n, cls, hazardCell } = world;
  const kinds = Object.keys(P.FIND_SHARE);
  const kindOf = new Int8Array(n * n).fill(-1);
  const counts = new Float64Array(kinds.length);
  const K = Object.fromEntries(kinds.map((k, i) => [k, i]));
  for (let i = 0; i < cls.length; i++) {
    const v = cls[i];
    let kind = -1;
    if (v === G.BUILDING || (nearBuilding && nearBuilding[i])) kind = K.structure;
    else if (v === G.ROAD) kind = K.road;
    else if (v === G.PATH || v === G.SERVICE) kind = K.linear;
    else if (v === G.CREEK) kind = K.drainage;
    else if (v === G.WATER || v === G.WETLAND) {
      const c = i % n; // only the water's edge: a square of water with dry ground beside it
      const dry = (c > 0 && !hazardCell[i - 1]) || (c < n - 1 && !hazardCell[i + 1]) || (i >= n && !hazardCell[i - n]) || (i + n < cls.length && !hazardCell[i + n]);
      if (dry) kind = K.water;
    } else if (v === G.WOODS) kind = K.woods;
    else if (v === G.BRUSH) kind = K.brush;
    else if (v === G.GRASS || v === G.PARK || v === G.LOT || v === G.DEVELOPED || v === G.YARD) kind = K.field;
    kindOf[i] = kind;
    if (kind >= 0) counts[kind] += 1;
  }
  const weight = new Float32Array(n * n);
  for (let i = 0; i < weight.length; i++) if (kindOf[i] >= 0) weight[i] = P.FIND_SHARE[kinds[kindOf[i]]] / counts[kindOf[i]];
  return weight;
}

// The engine's map as the planner needs it: probability per 10 m square.
// MERGE: today grid.p is on 25 m squares. Each square's value is shared among the 10 m squares
// whose middle falls in it, in proportion to findWeights() above (MAP_SPLIT 'find-location';
// the total is unchanged), or evenly (MAP_SPLIT 'even'). When the engine gives a 10 m map
// (p.length === 640 × 640) it is passed through as it is and none of this is used.
export function plannerMap(world, prediction, P = withParams()) {
  if (!maps.has(prediction)) maps.set(prediction, new Map());
  const made = maps.get(prediction);
  if (made.has(P.MAP_SPLIT)) return made.get(P.MAP_SPLIT);
  const { n, cellM } = world;
  const grid = prediction.grid;
  let p;
  let coarse = null; // which engine square each 10 m square belongs to
  if (grid.p.length === n * n) {
    p = Float64Array.from(grid.p);
  } else {
    if (!world.coarse || world.coarse.cols !== grid.cols) {
      const index = new Int32Array(n * n);
      const count = new Uint16Array(grid.cols * grid.rows);
      for (let r = 0; r < n; r++) {
        const row = Math.floor(((r + 0.5) * cellM) / grid.cellSize);
        for (let c = 0; c < n; c++) {
          const k = row * grid.cols + Math.floor(((c + 0.5) * cellM) / grid.cellSize);
          index[r * n + c] = k; count[k] += 1;
        }
      }
      world.coarse = { cols: grid.cols, index, count };
    }
    coarse = world.coarse;
    p = new Float64Array(n * n);
    const weight = P.MAP_SPLIT === 'find-location' ? world.findWeight : null;
    if (weight) {
      const sum = new Float64Array(grid.cols * grid.rows); // total weight inside each engine square
      for (let i = 0; i < p.length; i++) sum[coarse.index[i]] += weight[i];
      for (let i = 0; i < p.length; i++) {
        const k = coarse.index[i];
        // A square with no findable ground in it (the middle of a lake) is split evenly.
        p[i] = sum[k] > 0 ? (grid.p[k] * weight[i]) / sum[k] : grid.p[k] / coarse.count[k];
      }
    } else {
      for (let i = 0; i < p.length; i++) p[i] = grid.p[coarse.index[i]] / coarse.count[coarse.index[i]];
    }
  }
  // The hazard layer. MERGE: the prior session's grid.hazard is on the engine's squares; it is
  // read per 10 m square. Without it, the same statistic is worked out here: for each water,
  // creek or wetland square, the probability within HAZARD_REACH_M (a square box, as grid.js does).
  const hazard = new Float32Array(n * n);
  if (grid.hazard && coarse) {
    for (let i = 0; i < hazard.length; i++) if (world.hazardCell[i]) hazard[i] = grid.hazard[coarse.index[i]];
  } else if (grid.hazard && grid.hazard.length === n * n) {
    hazard.set(grid.hazard);
  } else {
    const sums = new Float64Array((n + 1) * (n + 1)); // sums[r][c] = total of p above-left of (r, c)
    for (let r = 0; r < n; r++) {
      let rowSum = 0;
      for (let c = 0; c < n; c++) {
        rowSum += p[r * n + c];
        sums[(r + 1) * (n + 1) + c + 1] = sums[r * (n + 1) + c + 1] + rowSum;
      }
    }
    const reach = Math.round(P.HAZARD_REACH_M / cellM);
    for (let i = 0; i < hazard.length; i++) {
      if (!world.hazardCell[i]) continue;
      const r = Math.floor(i / n); const c = i % n;
      const r1 = Math.max(0, r - reach); const r2 = Math.min(n, r + reach + 1);
      const c1 = Math.max(0, c - reach); const c2 = Math.min(n, c + reach + 1);
      hazard[i] = sums[r2 * (n + 1) + c2] - sums[r1 * (n + 1) + c2] - sums[r2 * (n + 1) + c1] + sums[r1 * (n + 1) + c1];
    }
  }
  const out = { p, restOfWorld: Number(prediction.restOfWorld) || 0, hazard };
  made.set(P.MAP_SPLIT, out);
  return out;
}

// Minutes since the person was last seen, at clock time nowMs. A shared case carries
// `minutesAt`, the moment its `minutes` value was true (INTERFACES.md, "Known limits").
export function minutesSinceLastSeen(caseInput, nowMs) {
  const base = Math.max(0, Number(caseInput.minutes) || 0);
  const at = Number(caseInput.minutesAt);
  return Number.isFinite(at) && at > 0 ? Math.max(0, base + (nowMs - at) / 60000) : base;
}

// THE CALL THE SCREEN MAKES.
//   searchers  [ { id, lat, lng, mode: 'foot' | 'car', at } ]   `at` = ms of their last position
//              update (sync.js already stores it); or pass updatedAgoMin directly
//   events     the search's events (the planner uses assigned / released / completed)
//   nowMs      the clock (the planner never reads the time itself)
// MERGE: `engineReadsCompleted` — once grid.js applies `completed` events to the map itself,
// pass true so the planner does not apply them a second time.
export function planSearch(area, caseInput, prediction, { searchers = [], events = [], nowMs, params, engineReadsCompleted = false } = {}) {
  const P = withParams(params);
  const { world, segs } = plannerWorld(area, caseInput, params);
  const map = plannerMap(world, prediction, P);
  const people = searchers.map((s) => ({
    ...s,
    updatedAgoMin: s.updatedAgoMin !== undefined ? s.updatedAgoMin : Number.isFinite(Number(s.at)) ? Math.max(0, (nowMs - Number(s.at)) / 60000) : 0,
  }));
  const used = engineReadsCompleted ? events.filter((e) => e && e.type !== 'completed') : events;
  return plan(world, segs, {
    p: map.p, restOfWorld: map.restOfWorld, hazard: map.hazard, searchers: people, events: used,
    clock: { nowMs, minutesSinceLastSeen: minutesSinceLastSeen(caseInput, nowMs) },
  }, params);
}

// A GPS trail (or any list of { lat, lng }) as the list of 10 m squares it passes through: the
// `track` a completed or released event can carry.
export function trackFromLatLngs(area, caseInput, points) {
  const { world } = plannerWorld(area, caseInput);
  const track = [];
  let prev = null;
  for (const pt of points) {
    const p = toXY(world, pt.lat, pt.lng);
    const steps = prev ? Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (world.cellM / 2))) : 1;
    for (let s = prev ? 1 : steps; s <= steps; s++) {
      const cell = prev ? cellAtXY(world, prev.x + ((p.x - prev.x) * s) / steps, prev.y + ((p.y - prev.y) * s) / steps) : cellAtXY(world, p.x, p.y);
      if (cell >= 0 && track[track.length - 1] !== cell) track.push(cell);
    }
    prev = p;
  }
  return track;
}

export { posterior, readEvents, assignedEvent };
