// engine/planner/routes.js — walkable routes over the street graph.
//
//   postmanTour   "search this block": the shortest closed walk that covers every street piece
//                 of a segment (the rural postman problem: Orloff 1974). Method: join the pieces
//                 into one network, pair up the corners where an odd number of pieces meet by
//                 the shortest walk between them, then follow the resulting circuit (Hierholzer).
//                 Pairing is exact for up to 12 odd corners and greedy-with-improvement above.
//   orienteer     "within the time you have, collect the most probability": the orienteering
//                 problem (Golden, Levy & Vohra 1987). Method: keep going to the street piece
//                 with the best prize per minute, improve the visiting order with 2-opt
//                 (Croes 1958), then spend any time saved on more pieces.
// Both are heuristics for problems with no fast exact method; tests/planner.test.js compares
// them with brute force on small graphs and reports how close they get.

import { FOOT, shortestFrom, pathTo } from './world.js';

// ---- A small network made of chosen street pieces ---------------------------------------------------

// `edges` are street-piece numbers of the big graph. Inside the local network they are known by
// their position in that list ("slot"), and street points get small local numbers.
export function localGraph(world, edges) {
  const { ea, eb, elen } = world.g;
  const index = new Map();
  const nodes = [];
  const local = (v) => {
    let i = index.get(v);
    if (i === undefined) { i = nodes.length; index.set(v, i); nodes.push(v); }
    return i;
  };
  const K = edges.length;
  const la = new Int32Array(K);
  const lb = new Int32Array(K);
  const len = new Float64Array(K);
  for (let k = 0; k < K; k++) { la[k] = local(ea[edges[k]]); lb[k] = local(eb[edges[k]]); len[k] = elen[edges[k]]; }
  const m = nodes.length;
  const off = new Int32Array(m + 1);
  for (let k = 0; k < K; k++) { off[la[k] + 1] += 1; off[lb[k] + 1] += 1; }
  for (let i = 0; i < m; i++) off[i + 1] += off[i];
  const fill = off.slice(0, m);
  const to = new Int32Array(2 * K);
  const via = new Int32Array(2 * K);
  for (let k = 0; k < K; k++) {
    to[fill[la[k]]] = lb[k]; via[fill[la[k]]++] = k;
    to[fill[lb[k]]] = la[k]; via[fill[lb[k]]++] = k;
  }
  return {
    edges: Int32Array.from(edges), nodes: Int32Array.from(nodes), index, K, m, la, lb, len, off, to, via,
    dist: new Float64Array(m).fill(Infinity), prev: new Int32Array(m).fill(-1),
    touched: new Int32Array(m), nTouched: 0, // points reached by the last localShortest() run
    heapNode: new Int32Array(Math.max(16, 2 * K + 2)), heapDist: new Float64Array(Math.max(16, 2 * K + 2)),
  };
}

// Shortest distances inside a local network from local point `src`, into lg.dist / lg.prev
// (prev = the slot the shortest way arrives by, -1 at the start). Overwritten by the next call.
export function localShortest(lg, src, maxDist = Infinity) {
  const { dist, prev, off, to, via, len, heapNode, heapDist, touched } = lg;
  // Wipe only what the previous run wrote (a short walk touches a few points out of thousands).
  for (let i = 0; i < lg.nTouched; i++) { dist[touched[i]] = Infinity; prev[touched[i]] = -1; }
  let count = 0;
  let size = 0;
  dist[src] = 0;
  touched[count++] = src;
  heapNode[size] = src; heapDist[size++] = 0;
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
    if (d > dist[node]) continue;
    if (d > maxDist) break;
    for (let k = off[node]; k < off[node + 1]; k++) {
      const nd = d + len[via[k]];
      const t = to[k];
      if (nd < dist[t]) {
        if (dist[t] === Infinity) touched[count++] = t;
        dist[t] = nd; prev[t] = via[k];
        let i = size++;
        while (i > 0) {
          const parent = (i - 1) >> 1;
          if (heapDist[parent] <= nd) break;
          heapNode[i] = heapNode[parent]; heapDist[i] = heapDist[parent];
          i = parent;
        }
        heapNode[i] = t; heapDist[i] = nd;
      }
    }
  }
  lg.nTouched = count;
}

// The slots walked from the start of the last localShortest() run to local point `node`.
function localPath(lg, prev, node) {
  const slots = [];
  let at = node;
  while (prev[at] >= 0) {
    const k = prev[at];
    slots.push(k);
    at = lg.la[k] === at ? lg.lb[k] : lg.la[k];
  }
  return slots.reverse();
}

// ---- Rural postman: cover every street piece of a segment ----------------------------------------------

// Returns { nodes, edges, length }: a closed walk (nodes[0] === nodes[last]) in the big graph's
// numbers, or null if the segment has no public street. Kept on the task once worked out.
export function postmanTour(world, task) {
  if (task.tour !== undefined) return task.tour;
  let required = connectPieces(world, Array.from(task.edges));
  if (required.length === 0) { task.tour = null; return null; }
  const lg = localGraph(world, required);
  const degree = new Int32Array(lg.m);
  const walk = []; // slots to walk; a slot appears twice if its street is walked twice
  for (let k = 0; k < lg.K; k++) { degree[lg.la[k]] += 1; degree[lg.lb[k]] += 1; walk.push(k); }
  const odd = [];
  for (let i = 0; i < lg.m; i++) if (degree[i] % 2) odd.push(i);
  if (odd.length) {
    // Shortest walk between every two odd corners, along the segment's own streets.
    const D = []; const prevs = [];
    for (const i of odd) {
      localShortest(lg, i);
      D.push(odd.map((j) => lg.dist[j]));
      prevs.push(lg.prev.slice());
    }
    for (const [a, b] of matchOdd(D)) for (const k of localPath(lg, prevs[a], odd[b])) walk.push(k);
  }
  // Hierholzer: follow unused pieces until stuck, then back up; the points come out as a circuit.
  const first = new Int32Array(lg.m + 1);
  for (const k of walk) { first[lg.la[k] + 1] += 1; first[lg.lb[k] + 1] += 1; }
  for (let i = 0; i < lg.m; i++) first[i + 1] += first[i];
  const pos = first.slice(0, lg.m);
  const item = new Int32Array(2 * walk.length);
  walk.forEach((k, q) => { item[pos[lg.la[k]]++] = q; item[pos[lg.lb[k]]++] = q; });
  const next = first.slice(0, lg.m);
  const used = new Uint8Array(walk.length);
  const stackNode = [0]; const stackVia = [-1];
  const outNode = []; const outVia = [];
  while (stackNode.length) {
    const v = stackNode[stackNode.length - 1];
    while (next[v] < first[v + 1] && used[item[next[v]]]) next[v] += 1;
    if (next[v] < first[v + 1]) {
      const q = item[next[v]++];
      used[q] = 1;
      const k = walk[q];
      stackNode.push(lg.la[k] === v ? lg.lb[k] : lg.la[k]);
      stackVia.push(k);
    } else {
      outNode.push(stackNode.pop());
      const k = stackVia.pop();
      if (k >= 0) outVia.push(k);
    }
  }
  outNode.reverse(); outVia.reverse();
  let length = 0;
  for (const k of outVia) length += lg.len[k];
  task.tour = {
    nodes: Int32Array.from(outNode, (i) => lg.nodes[i]),
    edges: Int32Array.from(outVia, (k) => lg.edges[k]),
    length,
  };
  return task.tour;
}

// Makes one joined-up network of the pieces: separate groups are linked to the biggest group by
// the shortest public walk (up to 400 m). A group that can't be reached is left out.
function connectPieces(world, edges) {
  if (edges.length === 0) return edges;
  const { ea, eb, elen } = world.g;
  const parent = new Map();
  const find = (v) => { let r = v; while (parent.get(r) !== r) r = parent.get(r); parent.set(v, r); return r; };
  for (const e of edges) { for (const v of [ea[e], eb[e]]) if (!parent.has(v)) parent.set(v, v); }
  for (const e of edges) parent.set(find(ea[e]), find(eb[e]));
  const groups = new Map(); // root → { edges, length }
  for (const e of edges) {
    const root = find(ea[e]);
    if (!groups.has(root)) groups.set(root, { edges: [], length: 0 });
    const group = groups.get(root);
    group.edges.push(e); group.length += elen[e];
  }
  if (groups.size === 1) return edges;
  const list = [...groups.values()].sort((a, b) => (b.length - a.length) || (a.edges[0] - b.edges[0]));
  const kept = new Set(list[0].edges);
  const keptNodes = new Set();
  for (const e of kept) { keptNodes.add(ea[e]); keptNodes.add(eb[e]); }
  for (const group of list.slice(1)) {
    const run = shortestFrom(world, ea[group.edges[0]], FOOT, 400);
    let best = -1;
    for (const v of keptNodes) if (run.dist[v] < Infinity && (best < 0 || run.dist[v] < run.dist[best] || (run.dist[v] === run.dist[best] && v < best))) best = v;
    if (best < 0) continue;
    for (const e of [...pathTo(world, run, best).edges, ...group.edges]) {
      kept.add(e); keptNodes.add(ea[e]); keptNodes.add(eb[e]);
    }
  }
  return [...kept].sort((a, b) => a - b);
}

// Pairs up the odd corners so the total walking between partners is as small as possible.
// D[i][j] = distance between corners i and j. Returns [[i, j], ...].
export function matchOdd(D) {
  const k = D.length;
  if (k <= 12) {
    // Exact: best[mask] = cheapest way to pair up the corners in `mask`.
    const full = (1 << k) - 1;
    const best = new Float64Array(full + 1).fill(Infinity);
    const choice = new Int32Array(full + 1);
    best[0] = 0;
    for (let mask = 1; mask <= full; mask++) {
      let i = 0;
      while (!(mask & (1 << i))) i += 1;
      for (let j = i + 1; j < k; j++) {
        if (!(mask & (1 << j))) continue;
        const rest = mask & ~(1 << i) & ~(1 << j);
        const cost = best[rest] + D[i][j];
        if (cost < best[mask]) { best[mask] = cost; choice[mask] = j; }
      }
    }
    const pairs = [];
    let mask = full;
    while (mask) {
      let i = 0;
      while (!(mask & (1 << i))) i += 1;
      const j = choice[mask];
      pairs.push([i, j]);
      mask &= ~(1 << i) & ~(1 << j);
    }
    return pairs;
  }
  // Greedy: closest two free corners first...
  const all = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) all.push([i, j]);
  all.sort((p, q) => (D[p[0]][p[1]] - D[q[0]][q[1]]) || (p[0] - q[0]) || (p[1] - q[1]));
  const taken = new Uint8Array(k);
  const pairs = [];
  for (const [i, j] of all) if (!taken[i] && !taken[j]) { taken[i] = 1; taken[j] = 1; pairs.push([i, j]); }
  // ...then keep swapping partners between two pairs while that shortens the total.
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let x = 0; x < pairs.length; x++) {
      for (let y = x + 1; y < pairs.length; y++) {
        const [a, b] = pairs[x]; const [c, d] = pairs[y];
        const now = D[a][b] + D[c][d];
        if (D[a][c] + D[b][d] < now - 1e-9 && D[a][c] + D[b][d] <= D[a][d] + D[b][c]) { pairs[x] = [a, c]; pairs[y] = [b, d]; improved = true; }
        else if (D[a][d] + D[b][c] < now - 1e-9) { pairs[x] = [a, d]; pairs[y] = [b, c]; improved = true; }
      }
    }
    if (!improved) break;
  }
  return pairs;
}

// A closed tour, started at its position `at` and walked once round. The walking-back at the
// very end (streets already covered earlier) is dropped: the searcher can stop there.
export function openTour(world, tour, at) {
  const count = tour.edges.length;
  const edges = [];
  const nodes = [tour.nodes[at]];
  for (let i = 0; i < count; i++) {
    edges.push(tour.edges[(at + i) % count]);
    nodes.push(tour.nodes[(at + i + 1) % count === 0 ? count : (at + i + 1) % count]);
  }
  const times = new Map();
  for (const e of edges) times.set(e, (times.get(e) || 0) + 1);
  while (edges.length && times.get(edges[edges.length - 1]) > 1) {
    times.set(edges[edges.length - 1], times.get(edges[edges.length - 1]) - 1);
    edges.pop(); nodes.pop();
  }
  let length = 0;
  for (const e of edges) length += world.g.elen[e];
  return { edges, nodes, length };
}

// ---- Orienteering: the most probability within a time budget ----------------------------------------------

const MAX_TARGETS = 80;  // street pieces considered as places to go
const DETOUR = 1.3;      // streets are about this much longer than the straight line (ASSUMPTION,
                         // only used to choose and order targets; the walk itself is exact)

// lg is the network the searcher may move on (localGraph); prize[slot] is the probability a
// look along that piece would find now (0 for pieces that are only there to walk through).
// `run` is a shortestFrom() result from the searcher's street point, for the travel to the
// first piece. Options:
//   budgetM        meters of searching the time budget allows if there were no travel
//   travelFactor   search meters that one meter of travel costs (search speed ÷ travel speed)
//   offsetM        meters from where the searcher stands to their street point
// Returns { travel: { edges, nodes }, travelM, startNode, edges, nodes, searchM } or null.
//
// Method:
//   1. Targets: the pieces with the most prize per meter.
//   2. Start at the target with the best prize per meter, counting the real travel to it.
//   3. Choose more targets, each time the best prize per meter of straight-line distance from
//      the last one, until the budget is used up (on straight-line estimates).
//   4. 2-opt: reverse stretches of that order while it shortens the straight-line path.
//   5. Walk it for real: shortest street path from each target to the next. Pieces passed on
//      the way are searched too. A target that no longer fits the budget is skipped.
//   6. If time is left over, choose again from where the walk ended (steps 3–5).
// The caller scores the finished walk from the squares it really passes.
export function orienteer(world, lg, prize, run, { budgetM, travelFactor, offsetM = 0 }) {
  const order = [];
  for (let k = 0; k < lg.K; k++) if (prize[k] > 0 && lg.len[k] > 0) order.push(k);
  if (order.length === 0) return null;
  order.sort((a, b) => (prize[b] / lg.len[b] - prize[a] / lg.len[a]) || (a - b));
  const targets = order.slice(0, MAX_TARGETS);
  const { nx, ny } = world.g;
  if (!lg.midX) { // the middle of every piece: worked out once per network
    lg.midX = new Float64Array(lg.K); lg.midY = new Float64Array(lg.K);
    for (let k = 0; k < lg.K; k++) {
      lg.midX[k] = (nx[lg.nodes[lg.la[k]]] + nx[lg.nodes[lg.lb[k]]]) / 2;
      lg.midY[k] = (ny[lg.nodes[lg.la[k]]] + ny[lg.nodes[lg.lb[k]]]) / 2;
    }
  }
  const mx = lg.midX; const my = lg.midY;
  const midX = (k) => mx[k];
  const midY = (k) => my[k];

  let first = -1; let firstEnd = -1; let firstCost = 0; let bestRatio = 0;
  for (const k of targets) {
    const da = run.dist[lg.nodes[lg.la[k]]];
    const db = run.dist[lg.nodes[lg.lb[k]]];
    const reach = Math.min(da, db);
    if (reach === Infinity) continue;
    const cost = (reach + offsetM) * travelFactor + lg.len[k];
    if (cost > budgetM) continue;
    const ratio = prize[k] / cost;
    if (ratio > bestRatio) { bestRatio = ratio; first = k; firstEnd = da <= db ? lg.la[k] : lg.lb[k]; firstCost = cost; }
  }
  if (first < 0) return null;
  const travelM = run.dist[lg.nodes[firstEnd]] + offsetM;
  const searchBudget = budgetM - (firstCost - lg.len[first]);

  const walked = new Uint8Array(lg.K);
  const slots = [];
  let at = firstEnd; let length = 0; let collected = 0;
  const step = (k) => {
    slots.push(k); length += lg.len[k];
    if (!walked[k]) { walked[k] = 1; collected += prize[k]; }
    at = lg.la[k] === at ? lg.lb[k] : lg.la[k];
  };
  // Walks to target k by the shortest street path and along it. False if it doesn't fit.
  const goTo = (k) => {
    const left = searchBudget - length;
    const ax = nx[lg.nodes[at]]; const ay = ny[lg.nodes[at]];
    const straight = Math.hypot(midX(k) - ax, midY(k) - ay) + lg.len[k];
    for (const radius of [Math.min(left, 2 * straight + 60), Math.min(left, 5 * straight + 200)]) {
      localShortest(lg, at, radius);
      const near = lg.dist[lg.la[k]] <= lg.dist[lg.lb[k]] ? lg.la[k] : lg.lb[k];
      if (lg.dist[near] === Infinity) continue;
      if (lg.dist[near] + lg.len[k] > left) return false;
      for (const s of localPath(lg, lg.prev, near)) step(s);
      step(k);
      return true;
    }
    return false;
  };
  goTo(first);

  for (let round = 0; round < 3; round++) {
    // 3. Choose targets on straight-line estimates.
    const chosen = [];
    let x = nx[lg.nodes[at]]; let y = ny[lg.nodes[at]];
    let estimate = length;
    const picked = new Uint8Array(lg.K);
    for (;;) {
      let pick = -1; let ratio = 0; let pickCost = 0;
      for (const k of targets) {
        if (walked[k] || picked[k]) continue;
        const cost = DETOUR * Math.sqrt((mx[k] - x) * (mx[k] - x) + (my[k] - y) * (my[k] - y)) + lg.len[k];
        if (estimate + cost > searchBudget) continue;
        if (prize[k] / cost > ratio) { ratio = prize[k] / cost; pick = k; pickCost = cost; }
      }
      if (pick < 0) break;
      picked[pick] = 1; chosen.push(pick); estimate += pickCost;
      x = midX(pick); y = midY(pick);
    }
    if (chosen.length === 0) break;
    // 4. 2-opt on the straight-line path (it starts where the walk is now).
    const px = [nx[lg.nodes[at]], ...chosen.map(midX)];
    const py = [ny[lg.nodes[at]], ...chosen.map(midY)];
    const seq = [-1, ...chosen];
    const gap = (i, j) => Math.sqrt((px[i] - px[j]) * (px[i] - px[j]) + (py[i] - py[j]) * (py[i] - py[j]));
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let i = 1; i < seq.length - 1; i++) {
        for (let j = i + 1; j < seq.length; j++) {
          const before = gap(i - 1, i) + (j + 1 < seq.length ? gap(j, j + 1) : 0);
          const after = gap(i - 1, j) + (j + 1 < seq.length ? gap(i, j + 1) : 0);
          if (after < before - 1e-6) {
            for (let a = i, b = j; a < b; a++, b--) {
              [seq[a], seq[b]] = [seq[b], seq[a]]; [px[a], px[b]] = [px[b], px[a]]; [py[a], py[b]] = [py[b], py[a]];
            }
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    // 5. Walk it.
    const before = length;
    for (let i = 1; i < seq.length; i++) if (!walked[seq[i]]) goTo(seq[i]);
    if (length === before || searchBudget - length < 0.1 * searchBudget) break;
  }

  const travel = pathTo(world, run, lg.nodes[firstEnd]);
  const nodes = [lg.nodes[firstEnd]];
  let node = firstEnd;
  for (const s of slots) { node = lg.la[s] === node ? lg.lb[s] : lg.la[s]; nodes.push(lg.nodes[node]); }
  return { travel, travelM, startNode: lg.nodes[firstEnd], edges: slots.map((s) => lg.edges[s]), nodes, searchM: length, collected };
}
