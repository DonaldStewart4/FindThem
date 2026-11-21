// engine/routes.js — a walking route through one search area (sector) for a volunteer.
//
// The route walks the streets and paths inside the sector, starting on the street the most
// simulated walkers used and always taking the busiest unwalked street next. When it reaches a
// spot with no unwalked street, it walks back the way it came until it finds one (like a real
// person retracing their steps), so the route is one continuous line.
//
// Driveways and parking aisles ("service" ways) are left out unless the sector has nothing else.

import { sectorBoundsXY, SEARCH_SPEED_MPS } from './grid.js';

export function routeFor(area, prediction, sectorId) {
  const { nodes, edges } = area.graph;
  const counts = prediction.sim.edgeCounts || [];
  const sector = prediction.grid.sectors.find((s) => s.id === sectorId);
  const probability = sector ? sector.probability : 0;
  const empty = { sectorId, points: [], edgeIndices: [], lengthM: 0, minutes: 0, probability };
  const b = sectorBoundsXY(sectorId);
  if (!b) return empty;

  // Streets whose middle is inside the sector.
  const inside = (e) => {
    const mx = (nodes[e.a].x + nodes[e.b].x) / 2;
    const my = (nodes[e.a].y + nodes[e.b].y) / 2;
    return mx >= b.minX && mx < b.maxX && my >= b.minY && my < b.maxY;
  };
  let chosen = [];
  edges.forEach((e, i) => { if (inside(e) && e.highway !== 'service') chosen.push(i); });
  if (chosen.length === 0) edges.forEach((e, i) => { if (inside(e)) chosen.push(i); });
  if (chosen.length === 0) return empty;

  // Which chosen streets touch each node.
  const touching = new Map();
  for (const i of chosen) {
    for (const n of [edges[i].a, edges[i].b]) {
      if (!touching.has(n)) touching.set(n, []);
      touching.get(n).push(i);
    }
  }
  const busier = (i, j) => (counts[j] || 0) - (counts[i] || 0) || i - j;

  // Start on the busiest street.
  const startEdge = [...chosen].sort(busier)[0];
  const walked = new Set();
  const pathNodes = [edges[startEdge].a];
  const pathEdges = [];
  const trail = [];  // stack of { node, edge } to walk back along
  let node = edges[startEdge].a;
  let lengthM = 0;
  let lastNewIndex = 0; // where the route last walked a new street (later steps are just walking back)

  for (let guard = 0; guard < chosen.length * 4; guard++) {
    const next = (touching.get(node) || []).filter((i) => !walked.has(i)).sort(busier)[0];
    if (next !== undefined) {
      const e = edges[next];
      const other = e.a === node ? e.b : e.a;
      walked.add(next);
      trail.push({ node, edge: next });
      node = other;
      pathNodes.push(node);
      pathEdges.push(next);
      lengthM += e.length;
      lastNewIndex = pathEdges.length;
    } else if (trail.length) {
      const back = trail.pop(); // retrace the last street
      node = back.node;
      pathNodes.push(node);
      pathEdges.push(back.edge);
      lengthM += edges[back.edge].length;
    } else {
      break; // walked everything reachable from the start
    }
  }

  // Drop the walking-back at the very end: the route can stop at the last new street.
  const keptEdges = pathEdges.slice(0, lastNewIndex);
  const keptNodes = pathNodes.slice(0, lastNewIndex + 1);
  const keptLength = keptEdges.reduce((sum, i) => sum + edges[i].length, 0);

  return {
    sectorId,
    points: keptNodes.map((n) => ({ lat: nodes[n].lat, lng: nodes[n].lng })),
    edgeIndices: keptEdges,
    lengthM: keptLength,
    minutes: keptLength / SEARCH_SPEED_MPS / 60,
    probability,
  };
}
