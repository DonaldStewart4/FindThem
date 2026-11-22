// engine/graph.js — turns the map data (OsmData from data.js) into a street network the
// simulated walkers can move on, plus a fast "is there a creek / woods / park nearby?" lookup.
//
// Everything inside the engine works in METERS on a flat local map:
//   x = meters east of the area's center, y = meters north of it.
// At the scale of a town (a few km) treating the Earth as flat is accurate to well under 1%.
//
// Exports (see INTERFACES.md section 2):
//   prepareArea(osm)                → Area { origin, graph: { nodes, edges }, traps }
//   nearestNode(area, lat, lng)     → index of the closest street node
//   nearestTrap(area, x, y, maxM)   → the closest trap feature within maxM meters, or null
//   toXY(origin, lat, lng), toLatLng(origin, x, y)   → convert between lat/lng and meters
//
// No page (DOM) code and no randomness here, so it runs the same in the browser and in Node.

// ---- Tunable numbers ------------------------------------------------------------------

const M_PER_DEG_LAT = 111320; // meters in one degree of latitude (about the same everywhere)
const TRAP_CELL_M = 50;       // size of the squares used to look up nearby trap features quickly
const TRAP_STEP_M = 10;       // extra points are added along creeks and edges this far apart,
                              // so a creek drawn with only a few points is still found everywhere

// ---- Converting between lat/lng and meters ------------------------------------------------

// Meters east (x) and north (y) of `origin`. One degree of longitude is shorter the farther
// you are from the equator, which is what the cosine accounts for.
export function toXY(origin, lat, lng) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (lng - origin.lng) * mPerDegLng, y: (lat - origin.lat) * M_PER_DEG_LAT };
}

// The reverse of toXY.
export function toLatLng(origin, x, y) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat + y / M_PER_DEG_LAT, lng: origin.lng + x / mPerDegLng };
}

// Compass bearing in degrees from (x1, y1) to (x2, y2): 0 = north, 90 = east, 180 = south,
// 270 = west. Note atan2 gets (dx, dy), not (dy, dx): that's what makes 0 point north.
export function bearing(x1, y1, x2, y2) {
  const deg = (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

// ---- Building the area ----------------------------------------------------------------------

export function prepareArea(osm) {
  const origin = { lat: osm.center.lat, lng: osm.center.lng };

  // 1. Nodes: every street point, with its position in meters and a list of the edges
  //    that touch it. indexById lets us find a node's place in the array from its OSM id.
  const nodes = [];
  const indexById = new Map();
  for (const n of osm.nodes) {
    const { x, y } = toXY(origin, n.lat, n.lng);
    indexById.set(n.id, nodes.length);
    nodes.push({ id: n.id, lat: n.lat, lng: n.lng, x, y, edges: [] });
  }

  // 2. Edges: each pair of neighboring points along a way is one straight piece of street.
  const edges = [];
  for (const way of osm.ways) {
    for (let k = 1; k < way.nodeIds.length; k++) {
      const a = indexById.get(way.nodeIds[k - 1]);
      const b = indexById.get(way.nodeIds[k]);
      if (a === undefined || b === undefined || a === b) continue; // missing or repeated point
      const na = nodes[a];
      const nb = nodes[b];
      const index = edges.length;
      edges.push({
        a,
        b,
        length: Math.hypot(nb.x - na.x, nb.y - na.y),
        bearingAB: bearing(na.x, na.y, nb.x, nb.y),
        wayId: way.id,
        name: way.name,
        highway: way.highway, // street type (residential, footway, service...), used by the walkers
      });
      na.edges.push(index); // both ends know about this edge, so walkers can go either way
      nb.edges.push(index);
    }
  }

  // `osm` is kept (not copied) so surface.js can draw the 10 m ground map for a case later;
  // the ground map depends on the case's grid origin, which isn't known yet here.
  return { origin, graph: { nodes, edges }, traps: buildTrapIndex(origin, osm.features), osm };
}

// ---- Trap features: creeks, water, wetlands, woods, brush, grass, parks ----------------------

// Builds two things:
//   cells:    a Map from a 50 m square ("cx,cy") to the trap points inside it. Points are added
//             every TRAP_STEP_M along each feature's outline, so long straight creeks count too.
//   polygons: closed areas (a park, a pond...) with a bounding box, so we can also tell when a
//             point is INSIDE one, far from its edge.
function buildTrapIndex(origin, features) {
  const cells = new Map();
  const polygons = [];

  const addPoint = (x, y, feature) => {
    const key = cellKey(x, y);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ x, y, type: feature.type, id: feature.id, name: feature.name });
  };

  for (const f of features || []) {
    const pts = f.points.map((p) => toXY(origin, p.lat, p.lng));
    if (pts.length === 0) continue;
    addPoint(pts[0].x, pts[0].y, f);
    for (let i = 1; i < pts.length; i++) {
      // Walk along the segment from pts[i-1] to pts[i], dropping a point every TRAP_STEP_M.
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / TRAP_STEP_M));
      for (let s = 1; s <= steps; s++) addPoint(pts[i - 1].x + (dx * s) / steps, pts[i - 1].y + (dy * s) / steps, f);
    }
    if (f.shape === 'area' && pts.length >= 4) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      polygons.push({
        pts,
        minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
        type: f.type, id: f.id, name: f.name,
      });
    }
  }
  return { cells, polygons };
}

function cellKey(x, y) {
  return `${Math.floor(x / TRAP_CELL_M)},${Math.floor(y / TRAP_CELL_M)}`;
}

// Is (x, y) inside the polygon? Counts how many edges a ray going right from the point
// crosses: an odd number means inside (the standard "ray casting" test).
function insidePolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const crosses = (pts[i].y > y) !== (pts[j].y > y) &&
      x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x;
    if (crosses) inside = !inside;
  }
  return inside;
}

// The closest trap feature to (x, y) within maxM meters (maxM up to TRAP_CELL_M), as
// { x, y, type, id, name, distance }, where (x, y) is the closest point on the feature.
// A point inside a park or pond counts as distance 0. Returns null if nothing is close.
export function nearestTrap(area, x, y, maxM) {
  const { cells, polygons } = area.traps;
  let best = null;
  const cx = Math.floor(x / TRAP_CELL_M);
  const cy = Math.floor(y / TRAP_CELL_M);
  // The 3×3 block of squares around the point covers everything within TRAP_CELL_M.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const p of cells.get(`${cx + dx},${cy + dy}`) || []) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= maxM && (!best || d < best.distance)) best = { ...p, distance: d };
      }
    }
  }
  if (best) return best;
  for (const poly of polygons) {
    if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) continue; // quick reject
    if (insidePolygon(x, y, poly.pts)) return { x, y, type: poly.type, id: poly.id, name: poly.name, distance: 0 };
  }
  return null;
}

// ---- Nearest street node -------------------------------------------------------------------------

// Index of the street node closest to (lat, lng). A simple loop over all nodes: it runs once
// per prediction (to start the walkers), so it doesn't need to be clever.
export function nearestNode(area, lat, lng) {
  const { x, y } = toXY(area.origin, lat, lng);
  let best = -1;
  let bestD2 = Infinity;
  area.graph.nodes.forEach((n, i) => {
    const d2 = (n.x - x) ** 2 + (n.y - y) ** 2; // squared distance: same order, no square root
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  });
  return best;
}
