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


// Overpass servers are often busy ("at capacity"). So we take turns between the
// servers, and wait a little longer after each failure: 3 s, 6 s, 12 s, ...
// `extraHeaders` lets the Node fixture script send a User-Agent (browsers send their own).
// Downloads the area from Overpass, trying the mirrors in turn with growing waits.
// Two kinds of failure, told apart so the screen says the right thing:
//   - the server answered with an error (429 "too many requests", 504 "too busy"): 'busy'
//   - fetch itself failed (no internet, or the connection dropped):          'offline'
// If the phone says it's offline, we stop at once instead of waiting through retries, and
// after MAX_CONNECTION_FAILURES failed connections in a row we stop too (e.g. Wi-Fi with no
// internet, which the phone can't detect). The error then has `offline: true`.
export async function fetchOverpass(lat, lng, radiusM = DEFAULT_RADIUS_M, { attempts = 5, extraHeaders = {}, onProgress = () => {}, firstDelayMs = 3000 } = {}) {
  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radiusM));
  let lastError;
  let delayMs = firstDelayMs; // doubles after each failed try (tests pass a tiny one)
  let connectionFailures = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isOffline()) throw offlineError(lastError);
    const url = OVERPASS_URLS[attempt % OVERPASS_URLS.length];
    let reason;
    try {
      // 'waiting': the server is collecting the streets (often 5–40 s before any data arrives).
      onProgress({ stage: 'waiting', attempt: attempt + 1, attempts });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders },
        body,
      });
      if (res.ok) return await readJsonWithProgress(res, onProgress);
      lastError = new Error(`Overpass ${res.status} from ${url}`);
      reason = 'busy';
      connectionFailures = 0;
    } catch (err) {
      lastError = offlineError(err); // no internet, or the server dropped the connection
      reason = 'offline';
      connectionFailures += 1;
    }
    if (isOffline() || connectionFailures >= MAX_CONNECTION_FAILURES) throw offlineError(lastError);
    if (attempt < attempts - 1) {
      onProgress({ stage: 'retry', reason, attempt: attempt + 2, attempts, waitMs: delayMs });
      await waitUnlessOffline(delayMs);
      delayMs *= 2;
    }
  }
  throw lastError;
}

const MAX_CONNECTION_FAILURES = 2;

// True when the browser knows there's no connection (airplane mode, Wi-Fi off).
// (It can't tell "connected to Wi-Fi that has no internet"; fetch failing tells us that.)
function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// Waits `ms`, but stops early if the phone goes offline, so we don't sit through a retry
// countdown that can't work.
function waitUnlessOffline(ms) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('offline', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (typeof window !== 'undefined') window.addEventListener('offline', done);
  });
}

// Reads a response's JSON piece by piece, reporting how many bytes have arrived so far
// ({ stage: 'download', bytes }), so the screen can move its loading bar.
async function readJsonWithProgress(res, onProgress) {
  if (!res.body || !res.body.getReader) return res.json(); // very old browsers
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
    onProgress({ stage: 'download', bytes });
  }
  return JSON.parse(await new Blob(chunks).text());
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

// ---- Saved areas near a point -------------------------------------------------------

// Straight-line distance in meters between two points (the "haversine" formula).
export function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// The saved area whose center is closest to (lat, lng), if it's within maxM meters.
// Lets a home area saved ahead of time cover a last-seen point a few streets away.
export async function findSavedAreaNear(lat, lng, maxM) {
  let best = null;
  let bestD = maxM;
  for (const saved of await dbGetAll()) {
    if (!saved || !saved.osm) continue;
    const d = distanceM({ lat, lng }, saved.osm.center);
    if (d <= bestD) { best = saved; bestD = d; }
  }
  return best;
}

// ---- Address search (Nominatim) ---------------------------------------------------------

// Turns an address into a point using OpenStreetMap's free Nominatim service.
// Their rules: at most 1 request per second, so this is only called on a button tap.
// Returns { lat, lng, label } or null if nothing was found. Needs signal.
export async function geocode(query) {
  const results = await searchPlaces(query, { limit: 1 });
  return results[0] || null;
}

// Address / place search for the map's magnifying glass. Returns up to `limit` results
// [{ lat, lng, label }]. `near` = { south, west, north, east } prefers places in that box
// (the part of the map on screen) without excluding others. `lang` asks for names in that
// language. Nominatim's rules: one search at a time, only when the person asks (no search-as-you-type).
export async function searchPlaces(query, { limit = 5, near = null, lang = '' } = {}) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: String(limit), q: query });
  if (near) params.set('viewbox', [near.west, near.north, near.east, near.south].join(','));
  const headers = { Accept: 'application/json' };
  if (lang) headers['Accept-Language'] = lang;
  let res;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers });
  } catch (err) {
    throw offlineError(err);
  }
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const results = await res.json();
  return results.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name }));
}

// Marks an error as "no connection" (fetch itself failed), so the screen can say
// "no internet" instead of "the server is busy".
export function offlineError(err) {
  const e = new Error('offline: ' + (err && err.message));
  e.offline = true;
  return e;
}

// ---- The one function app.js calls ----------------------------------------------

// How far a saved area's center may be from the last-seen point and still be used.
// The walkers need ~2 km around the last-seen point, and an area covers 3.2 km around its center.
const NEAR_ONLINE_M = 1000;   // with signal: reuse a saved area only if it's this close
const NEAR_OFFLINE_M = 2500;  // no signal: accept a looser fit rather than nothing

// Returns { osm, fromCache, savedAt }.
// Order: a saved copy of this exact spot → a saved area close by → download (and save)
// → if the download fails (no signal), any saved area that roughly covers the spot.
// If saving fails (private browsing, full storage) the app still works, it just won't
// have the area offline next time.
// onProgress gets { stage: 'waiting' | 'download' | 'retry', ... } while downloading (see fetchOverpass).
export async function loadArea(lat, lng, { radiusM = DEFAULT_RADIUS_M, onProgress } = {}) {
  const key = areaKey(lat, lng);

  try {
    const saved = (await dbGet(key)) || (await findSavedAreaNear(lat, lng, NEAR_ONLINE_M));
    if (saved && saved.osm && saved.osm.radiusM >= radiusM) {
      return { osm: saved.osm, fromCache: true, savedAt: saved.savedAt };
    }
  } catch (err) {
    console.warn('Could not read saved map data', err);
  }

  let json;
  try {
    json = await fetchOverpass(lat, lng, radiusM, { onProgress });
  } catch (err) {
    const fallback = await findSavedAreaNear(lat, lng, NEAR_OFFLINE_M).catch(() => null);
    if (fallback) return { osm: fallback.osm, fromCache: true, savedAt: fallback.savedAt };
    throw err; // err.offline is true when there was no connection
  }
  const osm = parseOverpass(json, { lat, lng }, radiusM);
  const savedAt = new Date().toISOString();
  try {
    await dbPut(key, { osm, savedAt });
  } catch (err) {
    console.warn('Could not save map data', err);
  }
  return { osm, fromCache: false, savedAt };
}
