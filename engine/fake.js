// engine/fake.js — a FAKE engine for building the screen. NOT the real engine.
//
// Jev is hand-writing the real engine in engine/ (graph.js, sim.js, grid.js, routes.js,
// index.js). Until it's ready, app.js imports this file instead. It has the same
// exports and returns data in the same shapes (see INTERFACES.md), but the numbers
// are made up: walkers scatter in straight lines and ignore the streets.
//
// Delete this file at integration, and change the import in app.js to './engine/index.js'.

export const IS_FAKE = true; // the real engine won't export this; app.js shows a "practice" note

const CELL_SIZE_M = 25;
const GRID_RADIUS_M = 3200;
const SECTOR_CELLS = 8;
const N_WALKERS = 5000;
const SPEED = { normal: 1.0, slow: 0.7, walker: 0.45 };
const DIRECTIONS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

// ---- helpers ----

// Small seeded random number generator, so the fake gives the same picture each time.
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 111320;
function toXY(origin, lat, lng) {
  return {
    x: (lng - origin.lng) * M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180),
    y: (lat - origin.lat) * M_PER_DEG_LAT,
  };
}
function toLatLng(origin, x, y) {
  return {
    lat: origin.lat + y / M_PER_DEG_LAT,
    lng: origin.lng + x / (M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

// ---- exports (same names as the real engine) ----

export function prepareArea(osm) {
  // A bare-bones street list so the screen can test drawing colored streets.
  // (The real graph.js does this properly: bearings, nearest node, trap index...)
  const origin = osm.center;
  const indexById = new Map();
  const nodes = osm.nodes.map((n, i) => {
    indexById.set(n.id, i);
    return { id: n.id, lat: n.lat, lng: n.lng, ...toXY(origin, n.lat, n.lng), edges: [] };
  });
  const edges = [];
  for (const w of osm.ways) {
    for (let k = 1; k < w.nodeIds.length; k++) {
      const a = indexById.get(w.nodeIds[k - 1]);
      const b = indexById.get(w.nodeIds[k]);
      if (a === undefined || b === undefined) continue;
      const length = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y);
      nodes[a].edges.push(edges.length);
      nodes[b].edges.push(edges.length);
      edges.push({ a, b, length, bearingAB: 0, wayId: w.id, name: w.name });
    }
  }
  // Bucket edge midpoints into 50 m squares, to find streets near a point quickly.
  const buckets = new Map();
  edges.forEach((e, i) => {
    const x = (nodes[e.a].x + nodes[e.b].x) / 2;
    const y = (nodes[e.a].y + nodes[e.b].y) / 2;
    const key = `${Math.floor(x / 50)},${Math.floor(y / 50)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  return { origin, graph: { nodes, edges }, traps: osm.features, _osm: osm, _buckets: buckets };
}

// Edges whose midpoint is within ~75 m of (x, y).
function edgesNear(area, x, y) {
  const out = [];
  const bx = Math.floor(x / 50);
  const by = Math.floor(y / 50);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) out.push(...(area._buckets.get(`${bx + dx},${by + dy}`) || []));
  }
  return out;
}

export function replay(area, caseInput, events) {
  const random = makeRandom(caseInput.seed);
  const { origin } = area;
  const start = toXY(origin, caseInput.lastSeen.lat, caseInput.lastSeen.lng);
  const budget = (SPEED[caseInput.mobility] || 1) * caseInput.minutes * 60 * 0.6;
  const heading = caseInput.direction ? DIRECTIONS[caseInput.direction] : null;

  // Scatter fake walkers.
  const endpoints = [];
  for (let i = 0; i < N_WALKERS; i++) {
    const normal = Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
    const giveUp = 850 * Math.exp(0.52 * normal);
    const dist = Math.min(giveUp, budget) * (0.3 + 0.7 * random());
    const bearing = heading === null ? random() * 360 : heading + (random() - 0.5) * 120;
    const rad = (bearing * Math.PI) / 180;
    const p = toLatLng(origin, start.x + dist * Math.sin(rad), start.y + dist * Math.cos(rad));
    endpoints.push({ lat: p.lat, lng: p.lng, edgeIndex: -1, trapType: null, trapId: null });
  }

  // Bin them onto the grid.
  const cols = Math.round((2 * GRID_RADIUS_M) / CELL_SIZE_M);
  const rows = cols;
  const counts = new Float64Array(cols * rows);
  for (const e of endpoints) {
    const { x, y } = toXY(origin, e.lat, e.lng);
    const col = Math.floor((x + GRID_RADIUS_M) / CELL_SIZE_M);
    const row = Math.floor((y + GRID_RADIUS_M) / CELL_SIZE_M);
    if (col >= 0 && col < cols && row >= 0 && row < rows) counts[row * cols + col] += 1;
  }
  let p = new Float64Array(cols * rows).fill(1e-6);
  for (let i = 0; i < p.length; i++) p[i] += counts[i];

  // Fake sighting update: blend in a blob around each sighting. (The real one reruns walkers.)
  for (const ev of events || []) {
    if (ev.type !== 'sighting') continue;
    const s = toXY(origin, ev.lat, ev.lng);
    const blob = new Float64Array(cols * rows);
    let blobTotal = 0;
    for (let i = 0; i < blob.length; i++) {
      const cx = (i % cols + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
      const cy = (Math.floor(i / cols) + 0.5) * CELL_SIZE_M - GRID_RADIUS_M;
      blob[i] = Math.exp(-((cx - s.x) ** 2 + (cy - s.y) ** 2) / (2 * 250 ** 2));
      blobTotal += blob[i];
    }
    const pTotal = p.reduce((sum, v) => sum + v, 0);
    const r = ev.reliability;
    for (let i = 0; i < p.length; i++) p[i] = (1 - r) * (p[i] / pTotal) + r * (blob[i] / blobTotal);
  }

  // Fake "searched" update: halve the sector. (The real one uses Bayes + detection.)
  const searchedMinutes = {};
  for (const ev of events || []) {
    if (ev.type !== 'searched') continue;
    searchedMinutes[ev.sectorId] = (searchedMinutes[ev.sectorId] || 0) + ev.minutes;
    forEachCellInSector(ev.sectorId, cols, (i) => { p[i] *= 0.5; });
  }
  const total = p.reduce((s, v) => s + v, 0);
  p = p.map((v) => v / total);

  // Sectors.
  const sectors = [];
  const sectorCols = cols / SECTOR_CELLS;
  for (let sr = 0; sr < rows / SECTOR_CELLS; sr++) {
    for (let sc = 0; sc < sectorCols; sc++) {
      const id = `r${sr}c${sc}`;
      let prob = 0;
      forEachCellInSector(id, cols, (i) => { prob += p[i]; });
      const size = SECTOR_CELLS * CELL_SIZE_M;
      const sw = toLatLng(origin, sc * size - GRID_RADIUS_M, sr * size - GRID_RADIUS_M);
      const ne = toLatLng(origin, (sc + 1) * size - GRID_RADIUS_M, (sr + 1) * size - GRID_RADIUS_M);
      sectors.push({
        id,
        bounds: [[sw.lat, sw.lng], [ne.lat, ne.lng]],
        center: { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 },
        probability: prob,
        searchedMinutes: searchedMinutes[id] || 0,
        pod: searchedMinutes[id] ? 0.5 : 0,
      });
    }
  }

  // Fake edge counts: each walker "used" the streets near where it stopped.
  const edgeCounts = new Array(area.graph.edges.length).fill(0);
  for (const e of endpoints) {
    const { x, y } = toXY(origin, e.lat, e.lng);
    for (const i of edgesNear(area, x, y)) edgeCounts[i] += 1;
  }

  return {
    sim: { nWalkers: N_WALKERS, endpoints, edgeCounts },
    grid: { cellSize: CELL_SIZE_M, cols, rows, p, sectors },
  };
}

function forEachCellInSector(sectorId, cols, fn) {
  const [, sr, sc] = /r(\d+)c(\d+)/.exec(sectorId).map(Number);
  for (let r = sr * SECTOR_CELLS; r < (sr + 1) * SECTOR_CELLS; r++) {
    for (let c = sc * SECTOR_CELLS; c < (sc + 1) * SECTOR_CELLS; c++) fn(r * cols + c);
  }
}

export function cellToLatLng(area, grid, cellIndex) {
  const row = Math.floor(cellIndex / grid.cols);
  const col = cellIndex % grid.cols;
  return toLatLng(area.origin, (col + 0.5) * grid.cellSize - GRID_RADIUS_M, (row + 0.5) * grid.cellSize - GRID_RADIUS_M);
}

export function nextSectors(prediction, searcherMinutes, count) {
  return [...prediction.grid.sectors]
    .sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id))
    .slice(0, count)
    .map((s) => ({ sectorId: s.id, gain: s.probability * 0.5, probability: s.probability }));
}

export function routeFor(area, prediction, sectorId) {
  const s = prediction.grid.sectors.find((x) => x.id === sectorId);
  const [[south, west], [north, east]] = s.bounds;
  const points = [
    { lat: south, lng: west }, { lat: north, lng: west }, { lat: north, lng: east },
    { lat: south, lng: east }, { lat: south, lng: west },
  ];
  return { sectorId, points, edgeIndices: [], lengthM: 800, minutes: 15, probability: s.probability };
}

export function topSpots(area, prediction, count) {
  const osm = area._osm;
  const nodeById = new Map(osm.nodes.map((n) => [n.id, n]));
  const best = [...prediction.grid.sectors].sort((a, b) => b.probability - a.probability).slice(0, count);

  return best.map((s) => {
    const here = toXY(area.origin, s.center.lat, s.center.lng);
    const dist = (pt) => { const q = toXY(area.origin, pt.lat, pt.lng); return Math.hypot(q.x - here.x, q.y - here.y); };

    // Nearest trap feature (by its nearest point) within ~150 m.
    let trap = null;
    let trapD = 150;
    for (const f of osm.features) {
      for (const pt of f.points) {
        const d = dist(pt);
        if (d < trapD) { trapD = d; trap = f; }
      }
    }

    // Nearest named street.
    let street = null;
    let streetD = Infinity;
    for (const w of osm.ways) {
      if (!w.name) continue;
      for (const id of w.nodeIds) {
        const d = dist(nodeById.get(id));
        if (d < streetD) { streetD = d; street = w.name; }
      }
    }

    const walkers = prediction.sim.endpoints.filter((e) => {
      const [[so, we], [no, ea]] = s.bounds;
      return e.lat >= so && e.lat < no && e.lng >= we && e.lng < ea;
    }).length;

    return {
      lat: s.center.lat,
      lng: s.center.lng,
      probability: s.probability,
      walkerShare: walkers / prediction.sim.nWalkers,
      trapType: trap ? trap.type : null,
      trapName: trap ? trap.name : null,
      streetName: street,
      distanceToStreetM: Number.isFinite(streetD) ? streetD : null,
      hazard: trap ? ['creek', 'river', 'water', 'wetland'].includes(trap.type) : false,
    };
  });
}
