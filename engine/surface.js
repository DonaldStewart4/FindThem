// engine/surface.js — the ground map the simulated walkers move on.
//
// A square picture of the ground, 640 × 640 squares of 10 m, reaching 3.2 km each way from the
// CASE's grid origin (the last-seen point, rounded; see grid.js). Because it is anchored to the
// case and not to whatever map download a phone happens to hold, two phones looking at the same
// search cut the ground into exactly the same squares.
//
// Every square gets one ground class (road, path, building, water, yard, ...), made only from
// OpenStreetMap data: the streets and "trap" features the app always had, plus the newer
// OsmData.layers (buildings, fences, rail, land use, bus stops) when the saved area has them.
// An area saved before those layers existed still works: its map is streets, water and parks on
// plain ground.
//
// Also worked out per square, for the walkers and the probability map:
//   exposure      how likely a person standing there is to be noticed by the public (0–100)
//   dRoad         meters to the nearest road, path or service way
//   dWater        meters to the nearest water, creek or wetland
//   nearBuilding  1 = open ground touching a building ("at a structure")
//   region        1 = joined to the main street network on foot
//
// No page (DOM) code and no randomness: the same inputs give the same map on every phone.

const M_PER_DEG_LAT = 111320; // meters in one degree of latitude (same value as graph.js)

// ---- Size of the map (fixed: sector ids depend on it) --------------------------------------

export const SURFACE_CELL_M = 10;                 // ASSUMPTION: 10 m squares; small enough for a
                                                  // house or a creek, big enough for a phone
export const SURFACE_RADIUS_M = 3200;             // same reach as the Overpass download
export const SURFACE_N = (2 * SURFACE_RADIUS_M) / SURFACE_CELL_M; // 640 squares across

// ---- Ground classes ------------------------------------------------------------------------

export const C = {
  NODATA: 0,     // outside the downloaded area: unknown ground
  DEVELOPED: 1,  // inside the download but nothing mapped there
  ROAD: 2,       // streets (residential ... primary)
  PATH: 3,       // footways, paths, cycleways, steps, tracks, pedestrian streets
  SERVICE: 4,    // driveways and parking aisles
  BUILDING: 5,   // blocked
  BARRIER: 6,    // fence, wall, hedge, rail line, motorway: blocked
  WATER: 7,      // lakes, ponds, rivers
  CREEK: 8,      // streams, ditches, drains, canals (lines)
  WETLAND: 9,
  WOODS: 10,
  BRUSH: 11,
  GRASS: 12,     // meadow, grass, pitches, playgrounds, gardens, golf, cemeteries
  PARK: 13,
  YARD: 14,      // residential land around houses
  LOT: 15,       // parking, shops, schools: open built-up ground
};
export const CLASS_NAMES = ['nodata', 'developed', 'road', 'path', 'service', 'building', 'barrier',
  'water', 'creek', 'wetland', 'woods', 'brush', 'grass', 'park', 'yard', 'lot'];
export const N_CLASSES = CLASS_NAMES.length;

const PATH_HIGHWAYS = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track']);

// How likely the public is to notice a person on each kind of way, relative to a main road (= 1).
// ASSUMPTION. Reasoning: being noticed grows with the number of passers-by, but less than in
// proportion (the tenth driver adds less than the first), so we take the square root of typical
// daily traffic relative to a main road: main road ~25,000 vehicles/day → 1; secondary ~10,000
// → 0.63; collector ~4,000 → 0.4; residential street ~800 → 0.18; driveway ~100 → 0.06.
// Foot-only ways are set by judgment. tools/calibrate.js tunes only the overall rate
// (SPOT_RATE_PER_MIN in params.js), not this table.
export const EXPOSURE_BY_HIGHWAY = {
  primary: 1.0, secondary: 0.63, tertiary: 0.4, unclassified: 0.14, residential: 0.18,
  living_street: 0.1, pedestrian: 0.3, cycleway: 0.15, footway: 0.1, path: 0.05, steps: 0.05,
  track: 0.03, service: 0.06,
};
export const EXPOSURE_DEFAULT = 0.1;   // ASSUMPTION: a way type missing from the table
export const EXPOSURE_BUS_STOP = 0.5;  // ASSUMPTION: people wait at bus stops, so a person on the
                                       // road beside one is noticed about as on a secondary road

// ---- Cache: one surface per (area, grid origin) -----------------------------------------------

const cache = new WeakMap(); // area → Map("lat,lng" → surface)

export function surfaceFor(area, origin) {
  if (!cache.has(area)) cache.set(area, new Map());
  const byOrigin = cache.get(area);
  const key = `${origin.lat},${origin.lng}`;
  if (!byOrigin.has(key)) {
    if (byOrigin.size >= 3) byOrigin.clear(); // keep memory small: a phone works on one case
    byOrigin.set(key, buildSurface(area.osm, origin));
  }
  return byOrigin.get(key);
}

// ---- Building the surface -----------------------------------------------------------------------

export function buildSurface(osm, origin) {
  const n = SURFACE_N;
  const cls = new Uint8Array(n * n);
  const exposure = new Uint8Array(n * n);
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  // lat/lng → position in squares (fractions allowed): column grows east, row grows north.
  const colOf = (lng) => ((lng - origin.lng) * mPerDegLng + SURFACE_RADIUS_M) / SURFACE_CELL_M;
  const rowOf = (lat) => ((lat - origin.lat) * M_PER_DEG_LAT + SURFACE_RADIUS_M) / SURFACE_CELL_M;

  // 1. Where we have data at all. Downloads are squares (osm.bounds) since Nov 22; an area
  //    saved before that is a circle of radiusM around its center.
  const center = osm.center || origin;
  const radiusM = osm.radiusM || SURFACE_RADIUS_M;
  if (osm.bounds) {
    const cFrom = Math.max(0, Math.ceil(colOf(osm.bounds.west) - 0.5));
    const cTo = Math.min(n - 1, Math.floor(colOf(osm.bounds.east) - 0.5));
    const rFrom = Math.max(0, Math.ceil(rowOf(osm.bounds.south) - 0.5));
    const rTo = Math.min(n - 1, Math.floor(rowOf(osm.bounds.north) - 0.5));
    for (let r = rFrom; r <= rTo; r++) if (cTo >= cFrom) cls.fill(C.DEVELOPED, r * n + cFrom, r * n + cTo + 1);
  } else {
    const cc = colOf(center.lng);
    const cr = rowOf(center.lat);
    const rCells2 = (radiusM / SURFACE_CELL_M) ** 2;
    for (let r = 0; r < n; r++) {
      // The part of this row inside the circle: columns within `half` of the circle's center.
      const half2 = rCells2 - (r + 0.5 - cr) ** 2;
      if (half2 <= 0) continue;
      const half = Math.sqrt(half2);
      const from = Math.max(0, Math.ceil(cc - half - 0.5));
      const to = Math.min(n - 1, Math.floor(cc + half - 0.5));
      if (to >= from) cls.fill(C.DEVELOPED, r * n + from, r * n + to + 1);
    }
  }
  const set = (value) => (c, r) => { if (c >= 0 && c < n && r >= 0 && r < n) cls[r * n + c] = value; };

  // 2. Land use and green areas, most general first (later ones overwrite earlier ones).
  const layers = osm.layers || null;
  const xs = [];
  const ys = [];
  const loadPacked = (pts) => {
    // Reverse of data.js packPoints(): steps of 0.00001° from the download's center.
    xs.length = 0; ys.length = 0;
    const unit = layers.unitDeg;
    let lat = Math.round(center.lat / unit);
    let lng = Math.round(center.lng / unit);
    for (let i = 0; i + 1 < pts.length; i += 2) {
      lat += pts[i]; lng += pts[i + 1];
      xs.push(colOf(lng * unit)); ys.push(rowOf(lat * unit));
    }
  };
  const loadPoints = (points) => {
    xs.length = 0; ys.length = 0;
    for (const p of points) { xs.push(colOf(p.lng)); ys.push(rowOf(p.lat)); }
  };

  if (layers) {
    for (const [kind, value] of [['yard', C.YARD], ['lot', C.LOT], ['green', C.GRASS]]) {
      const paint = set(value);
      for (const a of layers.areas) if (a.kind === kind) { loadPacked(a.pts); fillPolygon(xs, ys, n, paint); }
    }
  }
  const features = osm.features || [];
  const areaOrder = [['park', C.PARK], ['grass', C.GRASS], ['woods', C.WOODS], ['brush', C.BRUSH],
    ['wetland', C.WETLAND], ['water', C.WATER]];
  for (const [type, value] of areaOrder) {
    const paint = set(value);
    for (const f of features) {
      if (f.type !== type || f.shape !== 'area') continue;
      loadPoints(f.points);
      fillPolygon(xs, ys, n, paint);
    }
  }

  // 3. Water lines. A creek is one square wide; a river also wets the squares beside it.
  //    An unclosed "water" outline (part of a big lake's edge) is drawn as a line of water.
  const paintCreek = set(C.CREEK);
  const paintWater = set(C.WATER);
  const paintRiver = (c, r) => { paintWater(c, r); paintWater(c + 1, r); paintWater(c - 1, r); paintWater(c, r + 1); paintWater(c, r - 1); };
  for (const f of features) {
    if (f.shape !== 'line') continue;
    const paint = f.type === 'creek' ? paintCreek : f.type === 'river' ? paintRiver : f.type === 'water' ? paintWater : null;
    if (!paint) continue;
    loadPoints(f.points);
    for (let i = 1; i < xs.length; i++) traceLine(xs[i - 1], ys[i - 1], xs[i], ys[i], paint);
  }

  // 4. Things nobody walks through: fences, walls, hedges, rail lines, motorways, buildings.
  if (layers) {
    const paintBarrier = set(C.BARRIER);
    for (const l of layers.lines) {
      loadPacked(l.pts);
      for (let i = 1; i < xs.length; i++) traceLine(xs[i - 1], ys[i - 1], xs[i], ys[i], paintBarrier);
    }
    const paintBuilding = set(C.BUILDING);
    for (const b of layers.buildings) {
      loadPacked(b);
      if (!fillPolygon(xs, ys, n, paintBuilding)) {
        // Too small to cover the middle of any square (a shed): mark the square it sits in.
        let sx = 0; let sy = 0;
        for (let i = 0; i < xs.length; i++) { sx += xs[i]; sy += ys[i]; }
        paintBuilding(Math.floor(sx / xs.length), Math.floor(sy / ys.length));
      }
    }
  }

  // 5. Streets and paths, drawn LAST: a road over a creek is a bridge, a road through a fence
  //    line is a gate, a path through a building is a passage. Service ways first, then paths,
  //    then roads, so the more important way wins a shared square. Exposure keeps the highest.
  const nodeById = new Map();
  for (const node of osm.nodes || []) nodeById.set(node.id, node);
  const drawWays = (wanted, value) => {
    for (const way of osm.ways || []) {
      const isPath = PATH_HIGHWAYS.has(way.highway);
      const kind = way.highway === 'service' ? C.SERVICE : isPath ? C.PATH : C.ROAD;
      if (kind !== wanted) continue;
      const level = Math.round(100 * (EXPOSURE_BY_HIGHWAY[way.highway] ?? EXPOSURE_DEFAULT));
      const paint = (c, r) => {
        if (c < 0 || c >= n || r < 0 || r >= n) return;
        const i = r * n + c;
        cls[i] = value;
        if (level > exposure[i]) exposure[i] = level;
      };
      let prev = null;
      for (const id of way.nodeIds) {
        const node = nodeById.get(id);
        if (!node) continue;
        const x = colOf(node.lng);
        const y = rowOf(node.lat);
        if (prev) traceLine(prev.x, prev.y, x, y, paint);
        prev = { x, y };
      }
    }
  };
  drawWays(C.SERVICE, C.SERVICE);
  drawWays(C.PATH, C.PATH);
  drawWays(C.ROAD, C.ROAD);

  // 6. Exposure spreads one square: a sidewalk beside a main road is as visible as the road.
  //    Bus stops raise the ways right beside them.
  const isWay = (v) => v === C.ROAD || v === C.PATH || v === C.SERVICE;
  const spread = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (!isWay(cls[i])) continue;
      let best = exposure[i];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr; const c2 = c + dc;
          if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
          const v = exposure[rr * n + c2];
          if (v > best) best = v;
        }
      }
      spread[i] = best;
    }
  }
  if (layers) {
    const busLevel = Math.round(100 * EXPOSURE_BUS_STOP);
    for (const [lat, lng] of layers.busStops) {
      const c0 = Math.floor(colOf(lng));
      const r0 = Math.floor(rowOf(lat));
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r0 + dr; const c2 = c0 + dc;
          if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
          const i = rr * n + c2;
          if (isWay(cls[i]) && spread[i] < busLevel) spread[i] = busLevel;
        }
      }
    }
  }

  // 7. Neighbors of buildings. (The two distance layers are only worked out when first asked
  //    for, further down: the walkers themselves don't need them.)
  const nearBuilding = new Uint8Array(n * n);
  if (layers) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (cls[i] !== C.BUILDING) continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr; const c2 = c + dc;
            if (rr < 0 || rr >= n || c2 < 0 || c2 >= n) continue;
            const j = rr * n + c2;
            if (!isWay(cls[j]) && isWalkable(cls[j]) && cls[j] !== C.CREEK) nearBuilding[j] = 1;
          }
        }
      }
    }
  }

  const surface = {
    origin: { lat: origin.lat, lng: origin.lng },
    n, cellM: SURFACE_CELL_M, radiusM: SURFACE_RADIUS_M,
    cls, exposure: spread, nearBuilding,
    region: mainRegion(cls, n),
    hasLayers: !!layers,
    noDataShare: noDataShare(cls),
    colOf, rowOf,
  };
  // dRoad and dWater are computed the first time they are read, then kept.
  lazy(surface, 'dRoad', () => distanceTo(cls, n, (v) => isWay(v)));
  lazy(surface, 'dWater', () => distanceTo(cls, n, (v) => v === C.WATER || v === C.CREEK || v === C.WETLAND));
  return surface;
}

// Share of the map (0–1) with no downloaded data under it.
function noDataShare(cls) {
  let count = 0;
  for (let i = 0; i < cls.length; i++) if (cls[i] === C.NODATA) count += 1;
  return count / cls.length;
}

// Defines object[name] so that make() runs only on first use.
function lazy(object, name, make) {
  let value;
  Object.defineProperty(object, name, { enumerable: true, get() { if (value === undefined) value = make(); return value; } });
}

// Ground a person can stand on without having chosen to wade in.
export function isWalkable(v) {
  return v !== C.BUILDING && v !== C.BARRIER && v !== C.WATER;
}

// ---- Helpers for coordinates ----------------------------------------------------------------------

// The square holding (lat, lng), as an index (row * n + column), or -1 if it is off the map.
export function cellAt(surface, lat, lng) {
  const c = Math.floor(surface.colOf(lng));
  const r = Math.floor(surface.rowOf(lat));
  if (c < 0 || c >= surface.n || r < 0 || r >= surface.n) return -1;
  return r * surface.n + c;
}

// Meters east (x) and north (y) of the grid origin for the middle of a square.
export function cellXY(surface, cell) {
  const r = Math.floor(cell / surface.n);
  const c = cell % surface.n;
  return {
    x: (c + 0.5) * surface.cellM - surface.radiusM,
    y: (r + 0.5) * surface.cellM - surface.radiusM,
  };
}

export function xyToLatLng(origin, x, y) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat + y / M_PER_DEG_LAT, lng: origin.lng + x / mPerDegLng };
}

export function latLngToXY(origin, lat, lng) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (lng - origin.lng) * mPerDegLng, y: (lat - origin.lat) * M_PER_DEG_LAT };
}

// The walkable square, joined to the main street network, closest to `cell`. This is where the
// walkers start: a last-seen point inside a house, on an island or on a cut-off scrap of path
// would otherwise trap every walker in one spot. Returns -1 only on a map with no walkable ground.
export function snapToNetwork(surface, cell) {
  const { n, region } = surface;
  if (cell < 0) return -1;
  if (region[cell]) return cell;
  const r0 = Math.floor(cell / n);
  const c0 = cell % n;
  let best = -1;
  let bestD2 = Infinity;
  // Search growing square rings; stop once a ring is farther than the best found so far.
  for (let ring = 1; ring < n; ring++) {
    if (best >= 0 && (ring - 1) * (ring - 1) > bestD2) break;
    for (let dr = -ring; dr <= ring; dr++) {
      const edgeRow = Math.abs(dr) === ring;
      for (let dc = -ring; dc <= ring; dc += edgeRow ? 1 : 2 * ring) {
        const r = r0 + dr; const c = c0 + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const i = r * n + c;
        if (!region[i]) continue;
        const d2 = dr * dr + dc * dc;
        // Ties go to the lower index, so every phone picks the same square.
        if (d2 < bestD2 || (d2 === bestD2 && i < best)) { bestD2 = d2; best = i; }
      }
    }
  }
  return best;
}

// ---- Drawing shapes onto the grid ----------------------------------------------------------------

// Calls paint(col, row) for every square whose MIDDLE is inside the polygon (xs, ys in squares).
// Returns how many squares were painted. Works row by row: find where the row's middle line
// crosses the polygon's edges, and fill between each pair of crossings.
function fillPolygon(xs, ys, n, paint) {
  const count = xs.length;
  if (count < 3) return 0;
  let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < count; i++) { if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i]; }
  const rowFrom = Math.max(0, Math.ceil(minY - 0.5));
  const rowTo = Math.min(n - 1, Math.floor(maxY - 0.5));
  let painted = 0;
  const crossings = [];
  for (let r = rowFrom; r <= rowTo; r++) {
    const y = r + 0.5;
    crossings.length = 0;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y)) crossings.push(xs[i] + ((y - ys[i]) * (xs[j] - xs[i])) / (ys[j] - ys[i]));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const cFrom = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const cTo = Math.min(n - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let c = cFrom; c <= cTo; c++) { paint(c, r); painted++; }
    }
  }
  return painted;
}

// Calls paint(col, row) for EVERY square the straight line from (x0, y0) to (x1, y1) passes
// through, moving one square sideways or up/down at a time (never diagonally). That matters for
// fences and creeks: a line drawn with diagonal jumps would leave gaps a walker could slip through.
function traceLine(x0, y0, x1, y1, paint) {
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity; // how far along the line one column is
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity; // next column crossing
  let ty = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity; // next row crossing
  paint(cx, cy);
  let steps = Math.abs(ex - cx) + Math.abs(ey - cy);
  if (steps > 4000) steps = 4000; // a way reaching far outside the map: the rest is off it anyway
  while (steps-- > 0) {
    if (tx < ty) { cx += sx; tx += tdx; } else { cy += sy; ty += tdy; }
    paint(cx, cy);
  }
}

// Meters from every square to the nearest square whose class passes `isTarget`, capped at
// 65,000. Two sweeps over the grid ("chamfer" distance): accurate to a few percent, which is
// plenty next to 10 m squares.
function distanceTo(cls, n, isTarget) {
  const INF = 65000;
  const d = new Uint16Array(n * n);
  const STRAIGHT = SURFACE_CELL_M;                      // 10 m to a side neighbor
  const DIAGONAL = Math.round(SURFACE_CELL_M * 1.4142); // 14 m to a corner neighbor
  for (let i = 0; i < d.length; i++) d[i] = isTarget(cls[i]) ? 0 : INF;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      let v = d[i];
      if (v === 0) continue;
      if (c > 0 && d[i - 1] + STRAIGHT < v) v = d[i - 1] + STRAIGHT;
      if (r > 0) {
        if (d[i - n] + STRAIGHT < v) v = d[i - n] + STRAIGHT;
        if (c > 0 && d[i - n - 1] + DIAGONAL < v) v = d[i - n - 1] + DIAGONAL;
        if (c < n - 1 && d[i - n + 1] + DIAGONAL < v) v = d[i - n + 1] + DIAGONAL;
      }
      d[i] = v > INF ? INF : v;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let c = n - 1; c >= 0; c--) {
      const i = r * n + c;
      let v = d[i];
      if (v === 0) continue;
      if (c < n - 1 && d[i + 1] + STRAIGHT < v) v = d[i + 1] + STRAIGHT;
      if (r < n - 1) {
        if (d[i + n] + STRAIGHT < v) v = d[i + n] + STRAIGHT;
        if (c < n - 1 && d[i + n + 1] + DIAGONAL < v) v = d[i + n + 1] + DIAGONAL;
        if (c > 0 && d[i + n - 1] + DIAGONAL < v) v = d[i + n - 1] + DIAGONAL;
      }
      d[i] = v > INF ? INF : v;
    }
  }
  return d;
}

// Marks (1) every walkable square that can be reached on foot from the biggest street network.
// Squares are joined to their 8 neighbors, but never diagonally between two blocked squares.
// "Biggest" = the joined-up patch holding the most road squares. If the map has no roads at
// all, the biggest walkable patch is used.
function mainRegion(cls, n) {
  const walk = new Uint8Array(n * n);
  for (let i = 0; i < walk.length; i++) walk[i] = isWalkable(cls[i]) ? 1 : 0;
  const label = new Int32Array(n * n); // 0 = not visited
  const queue = new Int32Array(n * n);
  let bestLabel = 0;
  let bestScore = -1;
  let next = 0;
  for (let start = 0; start < walk.length; start++) {
    if (label[start] || !walk[start]) continue;
    next += 1;
    let head = 0; let tail = 0;
    queue[tail++] = start;
    label[start] = next;
    let roads = 0;
    while (head < tail) {
      const i = queue[head++];
      if (cls[i] === C.ROAD) roads += 1;
      const c = i % n;
      const up = i + n < walk.length;   // a row to the north exists
      const down = i >= n;              // a row to the south exists
      const left = c > 0;
      const right = c < n - 1;
      // Side neighbors.
      if (left && walk[i - 1] && !label[i - 1]) { label[i - 1] = next; queue[tail++] = i - 1; }
      if (right && walk[i + 1] && !label[i + 1]) { label[i + 1] = next; queue[tail++] = i + 1; }
      if (up && walk[i + n] && !label[i + n]) { label[i + n] = next; queue[tail++] = i + n; }
      if (down && walk[i - n] && !label[i - n]) { label[i - n] = next; queue[tail++] = i - n; }
      // Corner neighbors: only if at least one of the two squares beside the corner is open.
      if (up && left && walk[i + n - 1] && !label[i + n - 1] && (walk[i + n] || walk[i - 1])) { label[i + n - 1] = next; queue[tail++] = i + n - 1; }
      if (up && right && walk[i + n + 1] && !label[i + n + 1] && (walk[i + n] || walk[i + 1])) { label[i + n + 1] = next; queue[tail++] = i + n + 1; }
      if (down && left && walk[i - n - 1] && !label[i - n - 1] && (walk[i - n] || walk[i - 1])) { label[i - n - 1] = next; queue[tail++] = i - n - 1; }
      if (down && right && walk[i - n + 1] && !label[i - n + 1] && (walk[i - n] || walk[i + 1])) { label[i - n + 1] = next; queue[tail++] = i - n + 1; }
    }
    // Roads decide; size only breaks a tie (and covers a map with no roads).
    const score = roads * 1e7 + tail;
    if (score > bestScore) { bestScore = score; bestLabel = next; }
  }
  const region = new Uint8Array(n * n);
  if (bestLabel) for (let i = 0; i < region.length; i++) if (label[i] === bestLabel) region[i] = 1;
  return region;
}
