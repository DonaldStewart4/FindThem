// data.js — gets the street and terrain data for an area.
//
// What it does:
//   1. Asks the Overpass API (free OpenStreetMap data) for every walkable street/path
//      and every "trap" feature (creeks, woods, brush, water, parks) around a point.
//   2. Turns Overpass's answer into the simple OsmData shape described in INTERFACES.md.
//   3. Saves the result in IndexedDB (a small database inside the browser), so the same
//      area works next time with no signal.
//
// No page (DOM) code lives here, so tools/make-fixture.js can also run it in Node.

// ---- Settings ----------------------------------------------------------------

export const DEFAULT_RADIUS_M = 3200; // ~2 miles around the last-seen point

// Overpass servers to try, in order. If the first is busy, we try the next one.
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Streets and paths a person can walk on (no motorways or trunk roads).
const WALKABLE =
  'footway|path|pedestrian|residential|living_street|service|tertiary|secondary|' +
  'primary|unclassified|track|steps|cycleway';

// Which waterway values are real open water. Everything else is skipped, including
// waterway=pressurised (underground pipes, e.g. Fremont's Bay Division Pipelines).
const CREEK_WATERWAYS = ['stream', 'ditch', 'drain', 'canal'];

// IndexedDB names.
const DB_NAME = 'findthem';
const DB_STORE = 'areas';

// ---- Building the Overpass query ----------------------------------------------

// Returns the Overpass QL text for one area. "out body geom" gives each way its tags,
// its node ids AND the coordinates of those nodes, so one request is enough.
export function buildQuery(lat, lng, radiusM = DEFAULT_RADIUS_M) {
  const around = `(around:${radiusM},${lat},${lng})`;
  return `[out:json][timeout:90];
(
  way${around}[highway~"^(${WALKABLE})$"];
)->.walk;
(
  way${around}[waterway~"^(${CREEK_WATERWAYS.join('|')}|river)$"][tunnel!=culvert];
  way${around}[natural~"^(wood|scrub|wetland|water)$"];
  way${around}[landuse~"^(forest|meadow|grass)$"];
  way${around}[leisure=park];
)->.trap;
.walk out body geom qt;
.trap out body geom qt;`;
}

// ---- Turning Overpass JSON into OsmData ---------------------------------------

// Works out the trap type (see the table in INTERFACES.md) from a way's tags.
// Returns null if the way isn't a trap feature.
function trapType(tags) {
  if (CREEK_WATERWAYS.includes(tags.waterway)) return 'creek';
  if (tags.waterway === 'river') return 'river';
  if (tags.natural === 'water') return 'water';
  if (tags.natural === 'wetland') return 'wetland';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'woods';
  if (tags.natural === 'scrub') return 'brush';
  if (tags.landuse === 'meadow' || tags.landuse === 'grass') return 'grass';
  if (tags.leisure === 'park') return 'park';
  return null;
}

// Rounds a coordinate to 7 decimals (~1 cm) so the saved data stays small.
const r7 = (x) => Math.round(x * 1e7) / 1e7;

export function parseOverpass(json, center, radiusM = DEFAULT_RADIUS_M) {
  const nodesById = new Map(); // node id -> { id, lat, lng }
  const ways = [];
  const features = [];

  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.geometry || !el.tags) continue;
    const tags = el.tags;

    if (tags.highway) {
      // A walkable way. Remember each node's position, and the order of nodes.
      const nodeIds = [];
      el.nodes.forEach((id, i) => {
        const g = el.geometry[i];
        if (!g) return; // Overpass leaves out nodes far outside the area
        if (!nodesById.has(id)) nodesById.set(id, { id, lat: r7(g.lat), lng: r7(g.lon) });
        nodeIds.push(id);
      });
      if (nodeIds.length >= 2) {
        ways.push({ id: el.id, highway: tags.highway, name: tags.name || null, nodeIds });
      }
      continue;
    }

    const type = trapType(tags);
    if (!type) continue;
    const points = el.geometry.map((g) => ({ lat: r7(g.lat), lng: r7(g.lon) }));
    const first = el.nodes[0];
    const last = el.nodes[el.nodes.length - 1];
    // Creeks and rivers are lines. Everything else is an area when the way is closed.
    const isLine = type === 'creek' || type === 'river' || first !== last;
    features.push({
      id: 'w' + el.id,
      type,
      name: tags.name || null,
      shape: isLine ? 'line' : 'area',
      points,
    });
  }

  return { center, radiusM, nodes: [...nodesById.values()], ways, features };
}

// ---- Downloading ---------------------------------------------------------------

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Overpass servers are often busy ("at capacity"). So we take turns between the
// servers, and wait a little longer after each failure: 3 s, 6 s, 12 s, ...
// `extraHeaders` lets the Node fixture script send a User-Agent (browsers send their own).
export async function fetchOverpass(lat, lng, radiusM = DEFAULT_RADIUS_M, { attempts = 5, extraHeaders = {} } = {}) {
  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radiusM));
  let lastError;
  let delayMs = 3000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = OVERPASS_URLS[attempt % OVERPASS_URLS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders },
        body,
      });
      if (res.ok) return await res.json();
      lastError = new Error(`Overpass ${res.status} from ${url}`);
    } catch (err) {
      lastError = err; // no signal, or the server dropped the connection
    }
    if (attempt < attempts - 1) {
      await wait(delayMs);
      delayMs *= 2;
    }
  }
  throw lastError;
}

// ---- Saving in the browser (IndexedDB) ------------------------------------------

// The cache key is the point rounded to 3 decimals (~100 m), so tapping almost the
// same spot again reuses the saved data.
export function areaKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Bundled demo data -------------------------------------------------------------

// The Demo button uses a copy of the Fremont data that ships with the app
// (made by tools/make-fixture.js), so the demo works even when Overpass is busy.
// The same file is the engine's test fixture.
export const DEMO_AREA_URL = 'tests/fixtures/demo-area.json';

export async function loadBundledArea(url = DEMO_AREA_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  const osm = await res.json();
  return { osm, fromCache: false, savedAt: osm.savedAt || null };
}

// ---- The one function app.js calls ----------------------------------------------

// Returns { osm, fromCache, savedAt }.
// Order: saved copy first (fast, works offline), otherwise download and save.
// If saving fails (private browsing, full storage) the app still works, it just
// won't have the area offline next time.
export async function loadArea(lat, lng, { radiusM = DEFAULT_RADIUS_M } = {}) {
  const key = areaKey(lat, lng);

  try {
    const saved = await dbGet(key);
    if (saved && saved.osm && saved.osm.radiusM >= radiusM) {
      return { osm: saved.osm, fromCache: true, savedAt: saved.savedAt };
    }
  } catch (err) {
    console.warn('Could not read saved map data', err);
  }

  const json = await fetchOverpass(lat, lng, radiusM);
  const osm = parseOverpass(json, { lat, lng }, radiusM);
  const savedAt = new Date().toISOString();
  try {
    await dbPut(key, { osm, savedAt });
  } catch (err) {
    console.warn('Could not save map data', err);
  }
  return { osm, fromCache: false, savedAt };
}
