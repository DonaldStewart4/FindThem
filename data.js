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

// Rail lines people can't walk across (bridges and tunnels are skipped when reading the answer).
const RAIL_TYPES = 'rail|light_rail|subway';
// Roads nobody walks on or across: they act as walls for the walkers.
const MOTORWAY_TYPES = 'motorway|trunk|motorway_link|trunk_link';
const BARRIER_TYPES = 'fence|wall|hedge|retaining_wall';
// Land use that changes how easy the ground is to walk over (see engine/surface.js).
const LANDUSE_TYPES = 'residential|commercial|retail|industrial|cemetery|recreation_ground|religious';
const LEISURE_TYPES = 'pitch|playground|garden|golf_course';
const AMENITY_TYPES = 'parking|school';

// Returns the Overpass QL text for one area. "out body geom" gives each way its tags,
// its node ids AND the coordinates of those nodes, so one request is enough.
//
// Since the "prior v2" engine the same request also asks for the layers the walkers' 10 m
// ground map needs (OsmData.layers, see INTERFACES.md): buildings, fences/walls/hedges, rail
// lines, motorways, land use and bus stops. Buildings are by far the biggest part, so they
// come back with NO tags ("out skel geom"): a way with geometry and no tags is a building.
// Measured for Fremont (Nov 22): about +3.7 MB on the wire and noticeably more server time.
// The engine still works without these layers (old saved areas), just with a rougher map.
export function buildQuery(lat, lng, radiusM = DEFAULT_RADIUS_M) {
  const around = `(around:${radiusM},${lat},${lng})`;
  return `[out:json][timeout:120];
(
  way${around}[highway~"^(${WALKABLE})$"];
)->.walk;
(
  way${around}[waterway~"^(${CREEK_WATERWAYS.join('|')}|river)$"][tunnel!=culvert];
  way${around}[natural~"^(wood|scrub|wetland|water)$"];
  way${around}[landuse~"^(forest|meadow|grass)$"];
  way${around}[leisure=park];
  relation${around}[natural~"^(wood|scrub|wetland|water)$"];
  relation${around}[landuse~"^(forest|meadow|grass)$"];
  relation${around}[leisure=park];
)->.trap;
(
  way${around}[barrier~"^(${BARRIER_TYPES})$"];
  way${around}[railway~"^(${RAIL_TYPES})$"];
  way${around}[highway~"^(${MOTORWAY_TYPES})$"];
  way${around}[landuse~"^(${LANDUSE_TYPES})$"];
  way${around}[leisure~"^(${LEISURE_TYPES})$"];
  way${around}[amenity~"^(${AMENITY_TYPES})$"];
)->.ground;
.walk out body geom qt;
.trap out body geom qt;
.ground out tags geom qt;
way${around}[building];
out skel geom qt;
node${around}[highway=bus_stop];
out skel qt;`;
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
    if (el.type === 'relation') { features.push(...relationFeatures(el)); continue; }
    if (el.type !== 'way' || !el.geometry || !el.tags) continue;
    const tags = el.tags;

    if (tags.highway && !MOTORWAY_RE.test(tags.highway)) {
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

  const osm = { center, radiusM, nodes: [...nodesById.values()], ways, features };
  const layers = parseLayers(json, center);
  if (layers) osm.layers = layers; // only when the answer had them (older answers don't)
  return osm;
}

// ---- Lakes and parks drawn in several pieces (OSM "multipolygon" relations) ----------------

// Big lakes and parks are often stored as a relation: a list of member ways that together make
// the outline (Lake Elizabeth in Fremont is one). Each OUTER outline becomes a feature like any
// other, with id 'r<relation id>' ('r<id>-2', ... if there are several). Islands and other
// holes (inner members) are ignored: the whole outline counts as the lake or park.
// Outline pieces are joined end to end; a piece that still doesn't close is kept as a line.
export function relationFeatures(el) {
  const type = trapType(el.tags || {});
  if (!type || !Array.isArray(el.members)) return [];
  const pieces = [];
  for (const m of el.members) {
    if (m.type !== 'way' || m.role === 'inner' || !Array.isArray(m.geometry)) continue;
    const pts = m.geometry.filter(Boolean).map((g) => ({ lat: r7(g.lat), lng: r7(g.lon) }));
    if (pts.length >= 2) pieces.push(pts);
  }
  const same = (a, b) => a.lat === b.lat && a.lng === b.lng;
  const isClosed = (pts) => pts.length >= 4 && same(pts[0], pts[pts.length - 1]);
  const rings = [];
  while (pieces.length) {
    let ring = pieces.shift();
    // Keep attaching any piece that starts or ends where this one ends, until it closes.
    for (let joined = true; joined && !isClosed(ring);) {
      joined = false;
      for (let i = 0; i < pieces.length; i++) {
        const next = pieces[i];
        const end = ring[ring.length - 1];
        if (same(end, next[0])) ring = ring.concat(next.slice(1));
        else if (same(end, next[next.length - 1])) ring = ring.concat([...next].reverse().slice(1));
        else continue;
        pieces.splice(i, 1);
        joined = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings.map((points, i) => ({
    id: 'r' + el.id + (i ? '-' + (i + 1) : ''),
    type,
    name: (el.tags && el.tags.name) || null,
    shape: isClosed(points) && type !== 'creek' && type !== 'river' ? 'area' : 'line',
    points,
  }));
}

// ---- The ground layers for the walkers' 10 m map (OsmData.layers) -----------------------

const MOTORWAY_RE = new RegExp(`^(${MOTORWAY_TYPES})$`);
const RAIL_RE = new RegExp(`^(${RAIL_TYPES})$`);
const BARRIER_RE = new RegExp(`^(${BARRIER_TYPES})$`);

// Which kind of ground a tagged way is, or null. See engine/surface.js for what each kind does.
//   fence / rail / motorway  → lines the walkers can't cross
//   yard                     → land around houses (private, mostly fenced, rarely crossed)
//   lot                      → open paved or built-up ground (parking, shops, schools)
//   green                    → sports pitches, playgrounds, gardens, golf, cemeteries
function groundKind(tags) {
  // A rail line or motorway on a bridge or in a tunnel can be walked under / over.
  const offGround = (tags.bridge && tags.bridge !== 'no') || (tags.tunnel && tags.tunnel !== 'no');
  if (tags.barrier && BARRIER_RE.test(tags.barrier)) return 'fence';
  if (tags.railway && RAIL_RE.test(tags.railway)) return offGround ? null : 'rail';
  if (tags.highway && MOTORWAY_RE.test(tags.highway)) return offGround ? null : 'motorway';
  if (tags.landuse === 'residential') return 'yard';
  if (['commercial', 'retail', 'industrial', 'religious'].includes(tags.landuse)) return 'lot';
  if (tags.amenity === 'parking' || tags.amenity === 'school') return 'lot';
  if (['cemetery', 'recreation_ground'].includes(tags.landuse)) return 'green';
  if (['pitch', 'playground', 'garden', 'golf_course'].includes(tags.leisure)) return 'green';
  return null;
}

// Packs a list of Overpass points into a short list of whole numbers: each point is stored as
// the step from the previous one (the first one as the step from `center`), in units of
// 0.00001 degrees (about 1 m). Buildings have ~240,000 points in the Fremont area, and this
// keeps them at about a third of the size of plain { lat, lng } objects.
// unpackPoints() in engine/surface.js is the reverse.
export const LAYER_UNIT_DEG = 1e-5;
export function packPoints(geometry, center) {
  const out = [];
  let prevLat = Math.round(center.lat / LAYER_UNIT_DEG);
  let prevLng = Math.round(center.lng / LAYER_UNIT_DEG);
  for (const g of geometry) {
    if (!g) continue;
    const lat = Math.round(g.lat / LAYER_UNIT_DEG);
    const lng = Math.round(g.lon / LAYER_UNIT_DEG);
    out.push(lat - prevLat, lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

// Reads the ground layers out of an Overpass answer. Returns null when the answer has none of
// them (an answer to the older, smaller query), so the engine knows to use its fallback.
//   layers = { version: 1, unitDeg: 0.00001,
//              buildings: [ packedPoints, ... ],              closed outlines
//              lines:     [ { kind: 'fence'|'rail'|'motorway', pts: packedPoints } ],
//              areas:     [ { kind: 'yard'|'lot'|'green', pts: packedPoints } ],
//              busStops:  [ [lat, lng], ... ] }
export function parseLayers(json, center) {
  const buildings = [];
  const lines = [];
  const areas = [];
  const busStops = [];
  for (const el of json.elements || []) {
    if (el.type === 'node') {
      // The only nodes the query asks for are bus stops (sent without tags).
      if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) busStops.push([r5(el.lat), r5(el.lon)]);
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const tags = el.tags;
    if (!tags || tags.building) {
      // No tags = a building (see buildQuery). A tagged building is also accepted, so an
      // answer saved with full tags works too.
      if (el.geometry.length >= 4) buildings.push(packPoints(el.geometry, center));
      continue;
    }
    const kind = groundKind(tags);
    if (!kind) continue;
    const pts = packPoints(el.geometry, center);
    if (kind === 'fence' || kind === 'rail' || kind === 'motorway') lines.push({ kind, pts });
    else if (el.geometry.length >= 4) areas.push({ kind, pts });
  }
  if (!buildings.length && !lines.length && !areas.length && !busStops.length) return null;
  return { version: 1, unitDeg: LAYER_UNIT_DEG, buildings, lines, areas, busStops };
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

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
