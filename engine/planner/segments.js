// engine/planner/segments.js — cuts the map into search segments ("tasks") with real edges.
//
// Done once per case from the ground map and the street graph, then kept. Task types:
//   yards        the built-up ground of one block, enclosed by streets, water or rail. The
//                "ask permission" task: walk every street of the block and knock at each door.
//   park         joined-up park, grass, woods and brush, swept in lines.
//   hazard_check a stretch of creek, pond edge or wetland, looked at from the paths and streets
//                beside it. Never entered.
//   containment  a bridge, transit stop or junction of main roads to stand and watch.
//   hasty        roads and paths leading away from the last-seen point, in 8 compass wedges.
//   drive        drivable roads in 4 quadrants, for a searcher in a car.
// A segment that would take longer than TASK_MAX_MIN is cut in two across its longer side,
// again and again. Ids are made from the lowest square in the segment, so every phone with the
// same map gives the same segment the same name.

import { G, HW, DEFAULTS } from './params.js';
import { FOOT, CAR, BRIDGE, nearestNode, cellXY, cellAtXY } from './world.js';

const BUILT = 1;
const OPEN = 2;
export const WEDGES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const QUADRANTS = ['NE', 'SE', 'SW', 'NW'];

export function buildSegments(world, P = DEFAULTS) {
  const { n, cellM, cls, special, vis, hazardCell } = world;
  const total = n * n;
  const cellArea = cellM * cellM;
  const g = world.g;

  // ---- 1. Which squares can belong to a block or a park ---------------------------------------
  const group = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (special[i]) continue; // rail line or motorway: a boundary
    const v = cls[i];
    if (v === G.YARD || v === G.BUILDING || v === G.DEVELOPED || v === G.LOT || v === G.SERVICE || v === G.BARRIER) group[i] = BUILT;
    else if (v === G.PARK || v === G.GRASS || v === G.WOODS || v === G.BRUSH) group[i] = OPEN;
  }
  // A path belongs to whatever it runs through: a park path to the park, a sidewalk to the block.
  const pathGroup = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (cls[i] !== G.PATH || special[i]) continue;
    let open = 0; let built = 0;
    forNeighbors8(i, n, (j) => { if (group[j] === OPEN) open += 1; else if (group[j] === BUILT) built += 1; });
    pathGroup[i] = open > 0 && open >= built ? OPEN : built > 0 ? BUILT : 0;
  }
  for (let i = 0; i < total; i++) if (pathGroup[i]) group[i] = pathGroup[i];

  // Squares of a block that face a road: the frontage a canvasser walks along.
  const facesRoad = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (group[i] !== BUILT) continue;
    forNeighbors4(i, n, (j) => { if (cls[j] === G.ROAD) facesRoad[i] = 1; });
  }
  const wDay = P.W_DAY; const wNight = P.W_NIGHT;

  // ---- 2. Blocks and parks ------------------------------------------------------------------------
  const doorsOf = (cells) => {
    let building = 0;
    for (const c of cells) if (cls[c] === G.BUILDING) building += 1;
    return Math.ceil((building * cellArea) / P.M2_PER_DOOR);
  };
  const blockMinutes = (cells) => {
    let front = 0;
    for (const c of cells) front += facesRoad[c];
    return (front * cellM) / P.SEARCH_SPEED_MPS / 60 + doorsOf(cells) * P.KNOCK_MIN;
  };
  const lineMeters = (cells, widths) => {
    let sum = 0;
    for (const c of cells) { const w = widths[vis[c]]; if (w > 0) sum += cellArea / w; }
    return sum;
  };
  const parkMinutes = (cells) => (P.PARK_COVERAGE * lineMeters(cells, wDay)) / P.SEARCH_SPEED_MPS / 60;

  const areas = []; // yards and park tasks; segs.label[square] indexes this list
  const addAreas = (value, type, minutesOf) => {
    for (const whole of components(group, value, n, false, P.MIN_SEGMENT_CELLS)) {
      const parts = [];
      split(whole, n, minutesOf, P.TASK_MAX_MIN, P.MIN_SEGMENT_CELLS, parts, 0);
      for (const cells of parts) {
        const task = newTask(world, type, (type === 'yards' ? 'y' : 'p') + cells[0], cells);
        task.baseMin = minutesOf(cells);
        if (type === 'yards') task.doors = doorsOf(cells);
        else { task.lineMetersDay = lineMeters(cells, wDay); task.lineMetersNight = lineMeters(cells, wNight); }
        areas.push(task);
      }
    }
  };
  addAreas(BUILT, 'yards', blockMinutes);
  addAreas(OPEN, 'park', parkMinutes);
  const label = new Int32Array(total).fill(-1);
  areas.forEach((task, k) => { for (const c of task.cells) label[c] = k; });

  // ---- 3. Hazard stretches: joined-up water, creek and wetland ---------------------------------------
  const shore = new Uint8Array(total); // hazard squares touching dry ground
  for (let i = 0; i < total; i++) {
    if (!hazardCell[i]) continue;
    forNeighbors4(i, n, (j) => { if (!hazardCell[j]) shore[i] = 1; });
  }
  const shoreMinutes = (cells) => {
    let count = 0;
    for (const c of cells) count += shore[c];
    return (count * cellM) / P.SEARCH_SPEED_MPS / 60;
  };
  const hazards = [];
  for (const whole of components(hazardCell, 1, n, true, P.HAZARD_MIN_CELLS)) {
    const parts = [];
    split(whole, n, shoreMinutes, P.TASK_MAX_MIN, P.HAZARD_MIN_CELLS, parts, 0);
    for (const cells of parts) {
      const task = newTask(world, 'hazard_check', 'h' + cells[0], cells);
      task.baseMin = shoreMinutes(cells);
      let water = 0; let creek = 0;
      for (const c of cells) { if (cls[c] === G.CREEK) creek += 1; else water += 1; }
      task.kind = creek >= water ? 'creek' : 'water';
      hazards.push(task);
    }
  }
  const hazardLabel = new Int32Array(total).fill(-1);
  hazards.forEach((task, k) => { for (const c of task.cells) hazardLabel[c] = k; });

  // ---- 4. Which streets go with which segment ----------------------------------------------------------
  // A block's or park's streets: public street pieces passing through it or right beside it.
  // A hazard stretch's streets: public pieces within HAZARD_BANK_CELLS of its water.
  const areaEdges = areas.map(() => []);
  const hazardEdges = hazards.map(() => []);
  const lastHazard = new Int32Array(hazards.length).fill(-1);
  const reach = P.HAZARD_BANK_CELLS;
  const touching = new Map(); // for one street piece: block or park → how many of its squares touch it
  for (let e = 0; e < g.E; e++) {
    if (!(g.eflags[e] & FOOT)) continue;
    touching.clear();
    const count = g.cellOff[e + 1] - g.cellOff[e];
    for (let k = g.cellOff[e]; k < g.cellOff[e + 1]; k++) {
      const cell = g.ecells[k];
      const r = Math.floor(cell / n); const c = cell % n;
      for (let dr = -reach; dr <= reach; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= n) continue;
        for (let dc = -reach; dc <= reach; dc++) {
          const c2 = c + dc;
          if (c2 < 0 || c2 >= n) continue;
          const h = hazardLabel[rr * n + c2];
          if (h >= 0 && lastHazard[h] !== e) { lastHazard[h] = e; hazardEdges[h].push(e); }
        }
      }
      // The square itself and the four beside it (not the corners: a street that only meets a
      // block at its corner belongs to the next block).
      const seen = [];
      for (const j of [cell, cell - 1, cell + 1, cell - n, cell + n]) {
        if (j < 0 || j >= total || Math.abs((j % n) - c) > 1) continue;
        const a = label[j];
        if (a >= 0 && !seen.includes(a)) { seen.push(a); touching.set(a, (touching.get(a) || 0) + 1); }
      }
    }
    // A piece goes with a segment when at least two of its squares touch it (or its only one).
    for (const [a, touches] of touching) if (touches >= Math.min(2, count)) areaEdges[a].push(e);
  }
  areas.forEach((task, k) => { task.edges = Int32Array.from(areaEdges[k]); });
  hazards.forEach((task, k) => { task.edges = Int32Array.from(hazardEdges[k]); });

  // ---- 5. Containment points ---------------------------------------------------------------------------
  const { nx, ny, ea, etype, eflags, adjOff, adjEdge } = g;
  const ls = world.lastSeen;
  const candidates = [];
  const far = (i) => Math.hypot(nx[i] - ls.x, ny[i] - ls.y);
  for (let e = 0; e < g.E; e++) {
    if ((eflags[e] & BRIDGE) && (eflags[e] & FOOT)) candidates.push({ node: ea[e], kind: 'bridge', order: 0 });
  }
  for (const [x, y] of world.busStops) {
    const node = nearestNode(world, x, y, FOOT);
    if (node >= 0 && Math.hypot(nx[node] - x, ny[node] - y) <= 40) candidates.push({ node, kind: 'transit', order: 1 });
  }
  const main = (t) => t === HW.tertiary || t === HW.secondary || t === HW.primary;
  for (let i = 0; i < g.N; i++) {
    let count = 0;
    for (let k = adjOff[i]; k < adjOff[i + 1]; k++) if (main(etype[adjEdge[k]])) count += 1;
    if (count >= 3) candidates.push({ node: i, kind: 'intersection', order: 2 });
  }
  const posts = [];
  candidates
    .filter((c) => far(c.node) <= P.CONTAIN_RADIUS_M && cellAtXY(world, nx[c.node], ny[c.node]) >= 0)
    .sort((a, b) => (a.order - b.order) || (far(a.node) - far(b.node)) || (a.node - b.node))
    .forEach((c) => {
      const x = nx[c.node]; const y = ny[c.node];
      if (posts.some((p) => Math.hypot(p.x - x, p.y - y) < P.CONTAIN_SPACING_M)) return;
      const cell = cellAtXY(world, x, y);
      posts.push({ id: 'c' + cell, type: 'containment', kind: c.kind, node: c.node, cell, x, y, cells: Int32Array.of(cell), edges: new Int32Array(0), baseMin: P.POST_MIN });
    });

  // ---- 6. Hasty wedges and drive quadrants ----------------------------------------------------------------
  // A hasty searcher may walk any public street near the last-seen point (walkEdges), but is
  // only credited for looking along the roads and paths of the wedge they were given. The same
  // for a driver and their quadrant. task.slots are the task's pieces as positions in the
  // shared list, which is what routes.js localGraph() numbers them by.
  const walkEdges = []; const driveEdges = [];
  const wedgeSlots = WEDGES.map(() => []);
  const quadSlots = QUADRANTS.map(() => []);
  for (let e = 0; e < g.E; e++) {
    const mx = (nx[g.ea[e]] + nx[g.eb[e]]) / 2 - ls.x;
    const my = (ny[g.ea[e]] + ny[g.eb[e]]) / 2 - ls.y;
    const d = Math.hypot(mx, my);
    if ((eflags[e] & FOOT) && d <= P.HASTY_RADIUS_M + 200) {
      if (etype[e] !== HW.service && d <= P.HASTY_RADIUS_M) {
        const deg = ((Math.atan2(mx, my) * 180) / Math.PI + 360 + 22.5) % 360;
        wedgeSlots[Math.floor(deg / 45) % 8].push(walkEdges.length);
      }
      walkEdges.push(e);
    }
    if ((eflags[e] & CAR) && d <= P.DRIVE_RADIUS_M) {
      quadSlots[my >= 0 ? (mx >= 0 ? 0 : 3) : (mx >= 0 ? 1 : 2)].push(driveEdges.length);
      driveEdges.push(e);
    }
  }
  const linear = (type, name, slots, shared, minutes) => ({
    id: `${type}:${name}`, type, kind: name, slots: Int32Array.from(slots), edges: Int32Array.from(slots, (k) => shared[k]),
    cells: new Int32Array(0), baseMin: minutes, x: ls.x, y: ls.y,
  });
  const hasty = WEDGES.map((name, k) => linear('hasty', name, wedgeSlots[k], walkEdges, P.HASTY_BUDGET_MIN)).filter((t) => t.edges.length > 0);
  const drive = QUADRANTS.map((name, k) => linear('drive', name, quadSlots[k], driveEdges, P.DRIVE_BUDGET_MIN)).filter((t) => t.edges.length > 0);

  const tasks = new Map();
  for (const t of [...areas, ...hazards, ...posts, ...hasty, ...drive]) tasks.set(t.id, t);
  return { tasks, areas, label, hazards, hazardLabel, posts, hasty, drive, walkEdges: Int32Array.from(walkEdges), driveEdges: Int32Array.from(driveEdges) };
}

function newTask(world, type, id, cells) {
  let sx = 0; let sy = 0;
  for (const c of cells) { const p = cellXY(world, c); sx += p.x; sy += p.y; }
  return { id, type, cells, edges: new Int32Array(0), baseMin: 0, x: sx / cells.length, y: sy / cells.length };
}

function forNeighbors4(i, n, fn) {
  const c = i % n;
  if (c > 0) fn(i - 1);
  if (c < n - 1) fn(i + 1);
  if (i >= n) fn(i - n);
  if (i + n < n * n) fn(i + n);
}

function forNeighbors8(i, n, fn) {
  const r = Math.floor(i / n); const c = i % n;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr; const c2 = c + dc;
      if (rr >= 0 && rr < n && c2 >= 0 && c2 < n) fn(rr * n + c2);
    }
  }
}

// Joined-up patches of squares whose `map` value equals `value` (joined by their sides, or
// also by corners when `eight`), each as a sorted Int32Array. Patches under minCells are dropped.
function components(map, value, n, eight, minCells) {
  const seen = new Uint8Array(map.length);
  const queue = new Int32Array(map.length);
  const out = [];
  const visit = eight ? forNeighbors8 : forNeighbors4;
  for (let start = 0; start < map.length; start++) {
    if (map[start] !== value || seen[start]) continue;
    let head = 0; let tail = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      visit(queue[head++], n, (j) => { if (map[j] === value && !seen[j]) { seen[j] = 1; queue[tail++] = j; } });
    }
    if (tail >= minCells) out.push(Int32Array.from(queue.subarray(0, tail)).sort());
  }
  return out;
}

// Cuts a patch in two across its longer side until each part takes no more than maxMin.
function split(cells, n, minutesOf, maxMin, minCells, out, depth) {
  if (depth >= 10 || cells.length < 2 * minCells || minutesOf(cells) <= maxMin) { out.push(cells); return; }
  let rMin = Infinity; let rMax = -1; let cMin = Infinity; let cMax = -1;
  for (const c of cells) {
    const r = Math.floor(c / n); const col = c % n;
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (col < cMin) cMin = col; if (col > cMax) cMax = col;
  }
  const key = rMax - rMin >= cMax - cMin ? (c) => Math.floor(c / n) : (c) => c % n;
  const sorted = Array.from(cells).sort((a, b) => (key(a) - key(b)) || (a - b));
  const cut = key(sorted[sorted.length >> 1]);
  let left = sorted.filter((c) => key(c) < cut);
  let right = sorted.filter((c) => key(c) >= cut);
  if (left.length === 0) { left = sorted.slice(0, sorted.length >> 1); right = sorted.slice(sorted.length >> 1); }
  split(Int32Array.from(left).sort(), n, minutesOf, maxMin, minCells, out, depth + 1);
  split(Int32Array.from(right).sort(), n, minutesOf, maxMin, minCells, out, depth + 1);
}
