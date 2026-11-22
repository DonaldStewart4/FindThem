// engine/planner/world.js — the planner's own picture of the ground and the streets.
//
// Everything is in flat number arrays (no objects per street or per square), for two reasons:
// it is fast on a phone, and it can be handed to a Web Worker without copying thousands of
// objects. Nothing here imports the engine: engine/planner/adapter.js fills in the `spec` from
// the engine's ground map and street graph, and the tests fill it in by hand for tiny maps.
//
//   spec = {
//     n, cellM,                 the ground map is n × n squares of cellM meters
//     origin: { lat, lng },     the middle of the map (the case's grid origin)
//     cls: Uint8Array(n*n),     ground class per square (params.js G), row-major, row 0 = south
//     special: Uint8Array(n*n), optional: 1 = rail line, 2 = motorway (params.js SPECIAL)
//     nodes: { x, y },          street points in meters east / north of the origin
//     edges: { a, b, highway }, street pieces: node indices and street type (name or number)
//     busStops: [[x, y], ...],  optional
//     lastSeen: { x, y },
//   }
//
// No page (DOM) code, no clock, no random numbers: the same inputs give the same world.

import { G, V, HW, HIGHWAYS, CAR_HIGHWAYS, SPECIAL, DEFAULTS } from './params.js';

const M_PER_DEG_LAT = 111320;

// Marks on a street piece (world.g.eflags).
export const FOOT = 1;      // a searcher on foot may walk it
export const CAR = 2;       // a searcher in a car may drive it
export const RAIL_X = 4;    // it crosses a rail line (bridge or level crossing: the data can't tell)
export const BRIDGE = 8;    // it crosses water or a creek
export const PRIVATE = 16;  // a driveway: never walked

const FOOT_TYPES = new Set(HIGHWAYS.filter((h) => h !== 'other'));
const CAR_TYPES = new Set(CAR_HIGHWAYS);

export function buildWorld(spec, P = DEFAULTS) {
  const { n, cellM, cls } = spec;
  const half = (n * cellM) / 2;
  const special = spec.special || new Uint8Array(n * n);
  const world = {
    n, cellM, half, origin: { ...spec.origin }, cls, special,
    lastSeen: { ...spec.lastSeen },
    busStops: (spec.busStops || []).map((p) => [p[0], p[1]]),
  };

  // ---- Squares: what can be seen of each, and which are beside water -------------------------
  const isHazard = (v) => v === G.WATER || v === G.CREEK || v === G.WETLAND;
  const publicWay = new Uint8Array(n * n);
  for (let i = 0; i < cls.length; i++) if (cls[i] === G.ROAD || cls[i] === G.PATH) publicWay[i] = 1;
  const front = dilate(publicWay, n, P.FRONT_DEPTH_CELLS);
  const vis = new Uint8Array(n * n);
  for (let i = 0; i < cls.length; i++) {
    const v = cls[i];
    if (v === G.ROAD || v === G.PATH || v === G.SERVICE) vis[i] = V.STREET;
    else if (v === G.BUILDING) vis[i] = V.BUILDING;
    else if (isHazard(v) || v === G.WOODS || v === G.BRUSH) vis[i] = V.COVER;
    else if (v === G.BARRIER) vis[i] = V.NONE;
    else if (front[i]) vis[i] = V.STREET;
    else if (v === G.YARD) vis[i] = V.YARD;
    else vis[i] = V.OPEN;
  }
  world.vis = vis;
  const hazardCell = new Uint8Array(n * n);
  for (let i = 0; i < cls.length; i++) if (isHazard(cls[i])) hazardCell[i] = 1;
  world.hazardCell = hazardCell;
  world.nearWater = dilate(hazardCell, n, P.WATER_NEAR_CELLS);

  // ---- Streets ---------------------------------------------------------------------------------
  const N = spec.nodes.x.length;
  const E = spec.edges.a.length;
  const nx = Float64Array.from(spec.nodes.x);
  const ny = Float64Array.from(spec.nodes.y);
  const ea = Int32Array.from(spec.edges.a);
  const eb = Int32Array.from(spec.edges.b);
  const etype = new Uint8Array(E);
  const elen = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    const h = spec.edges.highway[e];
    etype[e] = typeof h === 'number' ? h : (HW[h] ?? HW.other);
    elen[e] = Math.hypot(nx[eb[e]] - nx[ea[e]], ny[eb[e]] - ny[ea[e]]);
  }

  // The squares each street piece passes through, in order from a to b.
  const cellOff = new Int32Array(E + 1);
  const cellList = [];
  for (let e = 0; e < E; e++) {
    const x0 = nx[ea[e]]; const y0 = ny[ea[e]];
    const dx = nx[eb[e]] - x0; const dy = ny[eb[e]] - y0;
    const steps = Math.max(1, Math.ceil(elen[e] / (cellM / 2)));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const c = cellAtXY(world, x0 + (dx * s) / steps, y0 + (dy * s) / steps);
      if (c >= 0 && c !== last) { cellList.push(c); last = c; }
    }
    cellOff[e + 1] = cellList.length;
  }
  const ecells = Int32Array.from(cellList);

  // Marks on each piece.
  const eflags = new Uint8Array(E);
  for (let e = 0; e < E; e++) {
    const name = HIGHWAYS[etype[e]];
    let flags = 0;
    let privateVotes = 0; let publicVotes = 0;
    let left = false; let right = false;
    const dx = nx[eb[e]] - nx[ea[e]]; const dy = ny[eb[e]] - ny[ea[e]];
    for (let k = cellOff[e]; k < cellOff[e + 1]; k++) {
      const cell = ecells[k];
      if (special[cell] === SPECIAL.RAIL) flags |= RAIL_X;
      const r = Math.floor(cell / n); const c = cell % n;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr; const c2 = c + dc;
          if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
          const v = cls[rr * n + c2];
          if (v === G.YARD || v === G.BUILDING) privateVotes += 1;
          else if (v === G.LOT || v === G.PARK || v === G.GRASS || v === G.DEVELOPED || v === G.WOODS || v === G.BRUSH) publicVotes += 1;
          if (isHazard(v)) {
            const side = dx * dr - dy * dc; // which side of the street this square is on
            if (side > 0) left = true; else if (side < 0) right = true;
          }
        }
      }
    }
    if (name === 'service' && privateVotes > publicVotes) flags |= PRIVATE;
    if (FOOT_TYPES.has(name) && !(flags & PRIVATE)) flags |= FOOT;
    if (CAR_TYPES.has(name)) flags |= CAR;
    if (left && right && name !== 'service') flags |= BRIDGE;
    eflags[e] = flags;
  }

  // Which pieces touch each street point ("adjacency"), as one long list with an offset per point.
  const adjOff = new Int32Array(N + 1);
  for (let e = 0; e < E; e++) { adjOff[ea[e] + 1] += 1; adjOff[eb[e] + 1] += 1; }
  for (let i = 0; i < N; i++) adjOff[i + 1] += adjOff[i];
  const fill = adjOff.slice(0, N);
  const adjNode = new Int32Array(2 * E);
  const adjEdge = new Int32Array(2 * E);
  const nodeModes = new Uint8Array(N);
  for (let e = 0; e < E; e++) {
    adjNode[fill[ea[e]]] = eb[e]; adjEdge[fill[ea[e]]++] = e;
    adjNode[fill[eb[e]]] = ea[e]; adjEdge[fill[eb[e]]++] = e;
    nodeModes[ea[e]] |= eflags[e]; nodeModes[eb[e]] |= eflags[e];
  }
  world.g = { N, E, nx, ny, ea, eb, etype, elen, eflags, cellOff, ecells, adjOff, adjNode, adjEdge, nodeModes };

  // Street points sorted into 100 m boxes, to find the nearest one quickly.
  const boxM = 100;
  const nb = Math.max(1, Math.ceil((2 * half) / boxM));
  const boxOf = (x, y) => {
    const bx = Math.min(nb - 1, Math.max(0, Math.floor((x + half) / boxM)));
    const by = Math.min(nb - 1, Math.max(0, Math.floor((y + half) / boxM)));
    return by * nb + bx;
  };
  const boxOff = new Int32Array(nb * nb + 1);
  for (let i = 0; i < N; i++) boxOff[boxOf(nx[i], ny[i]) + 1] += 1;
  for (let i = 0; i < nb * nb; i++) boxOff[i + 1] += boxOff[i];
  const boxFill = boxOff.slice(0, nb * nb);
  const boxNodes = new Int32Array(N);
  for (let i = 0; i < N; i++) boxNodes[boxFill[boxOf(nx[i], ny[i])]++] = i;
  world.boxes = { boxM, nb, boxOff, boxNodes };

  // Working space reused by footprint() and the planner (never read between calls).
  world.tmp = { dist: new Float32Array(n * n).fill(Infinity), det: new Float32Array(n * n) };
  world.kernel = makeKernel(P.FOOTPRINT_CELLS, cellM);
  world.lastSeenNode = nearestNode(world, world.lastSeen.x, world.lastSeen.y, FOOT);
  world.cache = new Map(); // shortest-path runs, kept between re-plans
  return world;
}

// 1 for every square within `radius` squares (straight or diagonal) of a marked square.
function dilate(mask, n, radius) {
  const out = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!mask[r * n + c]) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= n) continue;
        for (let dc = -radius; dc <= radius; dc++) {
          const c2 = c + dc;
          if (c2 >= 0 && c2 < n) out[rr * n + c2] = 1;
        }
      }
    }
  }
  return out;
}

// The squares within `radius` squares of a point, with their distance in meters.
function makeKernel(radius, cellM) {
  const dr = []; const dc = []; const d = [];
  for (let r = -radius; r <= radius; r++) {
    for (let c = -radius; c <= radius; c++) {
      const dist = Math.hypot(r, c);
      if (dist <= radius + 1e-9) { dr.push(r); dc.push(c); d.push(dist * cellM); }
    }
  }
  return { dr: Int32Array.from(dr), dc: Int32Array.from(dc), d: Float32Array.from(d) };
}

// ---- Coordinates --------------------------------------------------------------------------------

// The square holding the point (x east, y north of the origin, in meters), or -1 off the map.
export function cellAtXY(world, x, y) {
  const c = Math.floor((x + world.half) / world.cellM);
  const r = Math.floor((y + world.half) / world.cellM);
  if (c < 0 || c >= world.n || r < 0 || r >= world.n) return -1;
  return r * world.n + c;
}

export function cellXY(world, cell) {
  return {
    x: ((cell % world.n) + 0.5) * world.cellM - world.half,
    y: (Math.floor(cell / world.n) + 0.5) * world.cellM - world.half,
  };
}

export function toLatLng(world, x, y) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((world.origin.lat * Math.PI) / 180);
  return { lat: world.origin.lat + y / M_PER_DEG_LAT, lng: world.origin.lng + x / mPerDegLng };
}

export function toXY(world, lat, lng) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((world.origin.lat * Math.PI) / 180);
  return { x: (lng - world.origin.lng) * mPerDegLng, y: (lat - world.origin.lat) * M_PER_DEG_LAT };
}

// The nearest street point a searcher of this kind (FOOT or CAR) can use, or -1.
export function nearestNode(world, x, y, bit) {
  const { boxM, nb, boxOff, boxNodes } = world.boxes;
  const { nx, ny, nodeModes } = world.g;
  const bx = Math.floor((x + world.half) / boxM);
  const by = Math.floor((y + world.half) / boxM);
  let best = -1;
  let bestD2 = Infinity;
  for (let ring = 0; ring <= nb; ring++) {
    // Nothing in a farther ring can beat a point already found closer than the ring's inner edge.
    if (best >= 0 && ((ring - 1) * boxM) ** 2 > bestD2) break;
    for (let dy = -ring; dy <= ring; dy++) {
      const yy = by + dy;
      if (yy < 0 || yy >= nb) continue;
      const edgeRow = Math.abs(dy) === ring;
      for (let dx = -ring; dx <= ring; dx += edgeRow ? 1 : Math.max(1, 2 * ring)) {
        const xx = bx + dx;
        if (xx < 0 || xx >= nb) continue;
        const box = yy * nb + xx;
        for (let k = boxOff[box]; k < boxOff[box + 1]; k++) {
          const i = boxNodes[k];
          if (!(nodeModes[i] & bit)) continue;
          const d2 = (nx[i] - x) ** 2 + (ny[i] - y) ** 2;
          if (d2 < bestD2 || (d2 === bestD2 && i < best)) { bestD2 = d2; best = i; }
        }
      }
    }
  }
  return best;
}

// ---- Shortest paths (Dijkstra's algorithm with a binary heap) --------------------------------------

let heapNode = new Int32Array(1024);
let heapDist = new Float64Array(1024);

// Shortest walking (bit = FOOT) or driving (bit = CAR) distance from street point `src` to every
// point within maxDist meters. Returns { dist, prev }: dist[i] is Infinity if not reached;
// prev[i] is the street piece the shortest way arrives by (-1 at the start).
// `allowed`, if given, limits the search to pieces with allowed[e] === 1.
export function shortestFrom(world, src, bit, maxDist = Infinity, allowed = null) {
  const { N, adjOff, adjNode, adjEdge, elen, eflags } = world.g;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  if (src < 0) return { dist, prev, src };
  let size = 0;
  const push = (node, d) => {
    if (size === heapNode.length) {
      const hn = new Int32Array(size * 2); hn.set(heapNode); heapNode = hn;
      const hd = new Float64Array(size * 2); hd.set(heapDist); heapDist = hd;
    }
    let i = size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapDist[parent] <= d) break;
      heapNode[i] = heapNode[parent]; heapDist[i] = heapDist[parent];
      i = parent;
    }
    heapNode[i] = node; heapDist[i] = d;
  };
  dist[src] = 0;
  push(src, 0);
  while (size > 0) {
    const node = heapNode[0];
    const d = heapDist[0];
    size -= 1;
    if (size > 0) {
      const lastNode = heapNode[size]; const lastDist = heapDist[size];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && heapDist[child + 1] < heapDist[child]) child += 1;
        if (heapDist[child] >= lastDist) break;
        heapNode[i] = heapNode[child]; heapDist[i] = heapDist[child];
        i = child;
      }
      heapNode[i] = lastNode; heapDist[i] = lastDist;
    }
    if (d > dist[node]) continue; // an older, longer entry
    if (d > maxDist) break;
    for (let k = adjOff[node]; k < adjOff[node + 1]; k++) {
      const e = adjEdge[k];
      if (!(eflags[e] & bit) || (allowed && !allowed[e])) continue;
      const nd = d + elen[e];
      const to = adjNode[k];
      // Strictly shorter only: the first way found wins a tie, the same on every phone.
      if (nd < dist[to]) { dist[to] = nd; prev[to] = e; push(to, nd); }
    }
  }
  if (maxDist < Infinity) for (let i = 0; i < N; i++) if (dist[i] > maxDist) { dist[i] = Infinity; prev[i] = -1; }
  return { dist, prev, src };
}

// The same, kept between re-plans (a searcher who hasn't moved asks the same question again).
export function shortestCached(world, src, bit, maxDist) {
  const key = `${src}:${bit}:${maxDist}`;
  let hit = world.cache.get(key);
  if (!hit) {
    if (world.cache.size >= 48) world.cache.delete(world.cache.keys().next().value);
    hit = shortestFrom(world, src, bit, maxDist);
    world.cache.set(key, hit);
  }
  return hit;
}

// The street pieces from the start of a shortestFrom() run to `node`, in walking order, as
// { edges, nodes } (nodes has one more entry than edges). Null if the node wasn't reached.
export function pathTo(world, run, node) {
  if (node < 0 || run.dist[node] === Infinity) return null;
  const { ea, eb } = world.g;
  const edges = [];
  const nodes = [node];
  let at = node;
  while (run.prev[at] >= 0) {
    const e = run.prev[at];
    edges.push(e);
    at = ea[e] === at ? eb[e] : ea[e];
    nodes.push(at);
  }
  edges.reverse(); nodes.reverse();
  return { edges, nodes };
}

// ---- Tracks and footprints ---------------------------------------------------------------------------

// The squares walked when following these street pieces from `startNode`, in order.
export function trackOfEdges(world, edges, startNode) {
  const { ea, eb, cellOff, ecells } = world.g;
  const track = [];
  let at = startNode;
  for (const e of edges) {
    const forward = ea[e] === at;
    if (forward) for (let k = cellOff[e]; k < cellOff[e + 1]; k++) { if (track[track.length - 1] !== ecells[k]) track.push(ecells[k]); }
    else for (let k = cellOff[e + 1] - 1; k >= cellOff[e]; k--) { if (track[track.length - 1] !== ecells[k]) track.push(ecells[k]); }
    at = forward ? eb[e] : ea[e];
  }
  return track;
}

// Every square within reach of a track, with its closest distance to the track (meters):
// { cells: Int32Array, dist: Float32Array }, cells in ascending order.
export function footprint(world, track) {
  const { n, kernel } = world;
  const scratch = world.tmp.dist;
  const touched = [];
  let lastCell = -1;
  for (const cell of track) {
    if (cell === lastCell || cell < 0) continue;
    lastCell = cell;
    const r = Math.floor(cell / n); const c = cell % n;
    for (let k = 0; k < kernel.d.length; k++) {
      const rr = r + kernel.dr[k]; const c2 = c + kernel.dc[k];
      if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
      const j = rr * n + c2;
      if (scratch[j] === Infinity) touched.push(j);
      if (kernel.d[k] < scratch[j]) scratch[j] = kernel.d[k];
    }
  }
  touched.sort((a, b) => a - b);
  const cells = Int32Array.from(touched);
  const dist = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i++) { dist[i] = scratch[cells[i]]; scratch[cells[i]] = Infinity; }
  return { cells, dist };
}
