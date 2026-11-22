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

import { gridOriginFor } from './engine/grid.js';

// ---- Settings ----------------------------------------------------------------

// The engine's map is a SQUARE reaching GRID_HALF_M each way from the case's grid origin (the
// last-seen point rounded to 3 decimals; engine/grid.js). The download is a slightly bigger
// square around that same point, so the whole map has data. (Until Nov 22 the download was a
// circle of 3.2 km around wherever the phone happened to center it: the map's corners, and for
// the Demo a third of the map, had no data at all.)
export const GRID_HALF_M = 3200;        // must equal GRID_RADIUS_M in engine/grid.js
export const DOWNLOAD_MARGIN_M = 200;   // extra ground beyond the map's edge
export const DEFAULT_RADIUS_M = GRID_HALF_M + DOWNLOAD_MARGIN_M; // half the side of the download
// "Save my home area" downloads a bigger square, so a last-seen point up to ~1 km from home is
// still fully covered with no signal.
export const HOME_RADIUS_M = GRID_HALF_M + 1000;

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

// The square reaching halfM meters each way from (lat, lng): { south, west, north, east }.
export function boxAround(lat, lng, halfM) {
  const dLat = halfM / 111320;
  const dLng = halfM / (111320 * Math.cos((lat * Math.PI) / 180));
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  return { south: r6(lat - dLat), west: r6(lng - dLng), north: r6(lat + dLat), east: r6(lng + dLng) };
}

// The download comes in TWO requests, so the map can appear before the big one finishes:
//
//   1. buildQuery: every walkable street and path, and the "trap" features (creeks, water,
//      woods, parks, including lakes and parks stored as relations). Enough for a full
//      prediction. "out body geom" gives each way its tags, its node ids AND the coordinates
//      of those nodes.
//   2. buildLayersQuery: what the walkers' 10 m ground map uses to be more exact
//      (OsmData.layers, see INTERFACES.md): buildings, fences/walls/hedges, rail lines,
//      motorways, land use, bus stops. Buildings are by far the biggest part, so they come
//      back with NO tags ("out skel geom"): a way with geometry and no tags is a building.
//      Measured for Fremont on Nov 22: about 3.7 MB on the wire and close to a minute on a
//      busy public server. When it arrives the app redraws the map ("refines" it).
//
// Both ask for a box (not a circle): boxes are quicker for the Overpass servers and match the
// engine's square map.
export function buildQuery(lat, lng, halfM = DEFAULT_RADIUS_M) {
  const b = boxAround(lat, lng, halfM);
  return `[out:json][timeout:90][bbox:${b.south},${b.west},${b.north},${b.east}];
(
  way[highway~"^(${WALKABLE})$"];
)->.walk;
(
  way[waterway~"^(${CREEK_WATERWAYS.join('|')}|river)$"][tunnel!=culvert];
  way[natural~"^(wood|scrub|wetland|water)$"];
  way[landuse~"^(forest|meadow|grass)$"];
  way[leisure=park];
  relation[natural~"^(wood|scrub|wetland|water)$"];
  relation[landuse~"^(forest|meadow|grass)$"];
  relation[leisure=park];
)->.trap;
.walk out body geom qt;
.trap out body geom qt;`;
}

export function buildLayersQuery(lat, lng, halfM = DEFAULT_RADIUS_M) {
  const b = boxAround(lat, lng, halfM);
  return `[out:json][timeout:120][bbox:${b.south},${b.west},${b.north},${b.east}];
(
  way[barrier~"^(${BARRIER_TYPES})$"];
  way[railway~"^(${RAIL_TYPES})$"];
  way[highway~"^(${MOTORWAY_TYPES})$"];
  way[landuse~"^(${LANDUSE_TYPES})$"];
  way[leisure~"^(${LEISURE_TYPES})$"];
  way[amenity~"^(${AMENITY_TYPES})$"];
)->.ground;
.ground out tags geom qt;
way[building];
out skel geom qt;
node[highway=bus_stop];
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

  // `radiusM` is half the side of the downloaded square, and `bounds` is that square. (Areas
  // saved before Nov 22 have no `bounds`: they were circles of radiusM around the center.)
  const osm = {
    center, radiusM, bounds: boxAround(center.lat, center.lng, radiusM),
    nodes: [...nodesById.values()], ways, features,
  };
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
// `query` replaces the usual streets query (used for the second request, the ground layers).
// A time limit too: a busy server sometimes accepts the request and then never answers. Each
// try is given up after `timeoutMs` and the next server is tried ('busy'); after MAX_TIMEOUTS
// such tries the download stops with `timeout: true` on the error, so the screen can say
// "the map servers took too long" and the person can try again.
export async function fetchOverpass(lat, lng, radiusM = DEFAULT_RADIUS_M, { attempts = 5, extraHeaders = {}, onProgress = () => {}, firstDelayMs = 3000, query = null, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const body = 'data=' + encodeURIComponent(query || buildQuery(lat, lng, radiusM));
  let lastError;
  let delayMs = firstDelayMs; // doubles after each failed try (tests pass a tiny one)
  let connectionFailures = 0;
  let timeouts = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isOffline()) throw offlineError(lastError);
    const url = OVERPASS_URLS[attempt % OVERPASS_URLS.length];
    let reason;
    // Stops this try (the wait for an answer and the download itself) after timeoutMs.
    const stopper = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = stopper ? setTimeout(() => { timedOut = true; stopper.abort(); }, timeoutMs) : null;
    try {
      // 'waiting': the server is collecting the streets (often 5–40 s before any data arrives).
      onProgress({ stage: 'waiting', attempt: attempt + 1, attempts });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders },
        body,
        ...(stopper ? { signal: stopper.signal } : {}),
      });
      if (res.ok) return await readJsonWithProgress(res, onProgress);
      lastError = new Error(`Overpass ${res.status} from ${url}`);
      reason = 'busy';
      connectionFailures = 0;
    } catch (err) {
      if (timedOut) {
        // The server took too long: not a connection problem. Try the next server.
        lastError = new Error(`Overpass gave no answer within ${Math.round(timeoutMs / 1000)} s (${url})`);
        lastError.timeout = true;
        reason = 'busy';
        connectionFailures = 0;
        timeouts += 1;
      } else {
        lastError = offlineError(err); // no internet, or the server dropped the connection
        reason = 'offline';
        connectionFailures += 1;
      }
    } finally {
      clearTimeout(timer);
    }
    if (timeouts >= MAX_TIMEOUTS) throw lastError;
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
const DOWNLOAD_TIMEOUT_MS = 75000; // one try at the streets: usually 5–40 s; past 75 s it isn't coming
const LAYERS_TIMEOUT_MS = 150000;  // the second, bigger request (buildings and land use)
const MAX_TIMEOUTS = 2;            // give up after this many tries that timed out

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
  return { osm, fromCache: false, savedAt: osm.savedAt || null, more: null };
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

// With no signal, a saved area this close to the last-seen point is used even if it doesn't
// cover the whole map: a partly empty map beats none.
const NEAR_OFFLINE_M = 2500;
const COVER_SLACK_M = 60; // a saved area may fall this short of the map's edge and still count

// Does this saved area hold data for the whole map of a case whose grid origin is `center`?
// Only areas saved as squares (with `bounds`) can: the old circles never reached the corners.
export function coversGrid(osm, center) {
  if (!osm || !osm.bounds) return false;
  const need = boxAround(center.lat, center.lng, GRID_HALF_M - COVER_SLACK_M);
  const b = osm.bounds;
  return b.south <= need.south && b.north >= need.north && b.west <= need.west && b.east >= need.east;
}

// The saved area that covers the map around `center`, if any (the closest one wins).
export async function findSavedAreaCovering(center) {
  let best = null;
  let bestD = Infinity;
  for (const saved of await dbGetAll()) {
    if (!saved || !coversGrid(saved.osm, center)) continue;
    const d = distanceM(center, saved.osm.center);
    if (d < bestD) { best = saved; bestD = d; }
  }
  return best;
}

// The second request: the ground layers for an area we already have streets for. Returns
// { osm, savedAt } with osm.layers filled in (and saves it), or null if it can't be had right
// now. Never throws: the map already works without the layers.
export async function fetchLayers(osm, { attempts = 4, extraHeaders = {}, firstDelayMs = 3000 } = {}) {
  try {
    const json = await fetchOverpass(osm.center.lat, osm.center.lng, osm.radiusM, {
      attempts, extraHeaders, firstDelayMs, timeoutMs: LAYERS_TIMEOUT_MS,
      query: buildLayersQuery(osm.center.lat, osm.center.lng, osm.radiusM),
    });
    const layers = parseLayers(json, osm.center);
    if (!layers) return null;
    const better = { ...osm, layers };
    const savedAt = new Date().toISOString();
    try {
      await dbPut(areaKey(osm.center.lat, osm.center.lng), { osm: better, savedAt });
    } catch (err) {
      console.warn('Could not save map data', err);
    }
    return { osm: better, savedAt };
  } catch (err) {
    console.warn('Ground layers not available yet', err);
    return null;
  }
}

// Returns { osm, fromCache, savedAt, more }.
//
// TWO-PHASE: `osm` holds the streets, creeks and parks, enough for a full prediction right
// away. If the ground layers (buildings, land use, fences) aren't in it yet, `more` is a
// promise that later gives { osm, savedAt } with them added, or null if they couldn't be
// fetched; the screen then redraws. `more` is null when there is nothing more to wait for.
//
// Order: a saved copy that covers the whole map → download streets (and save) → if the
// download fails (no signal), any saved area near the spot.
// The download is centered on the case's grid origin (the last-seen point rounded to 3
// decimals, about 100 m), so it lines up with the engine's map.
// If saving fails (private browsing, full storage) the app still works, it just won't have
// the area offline next time.
// onProgress gets { stage: 'waiting' | 'download' | 'retry', ... } while downloading (see fetchOverpass).
export async function loadArea(lat, lng, { radiusM = DEFAULT_RADIUS_M, onProgress } = {}) {
  const center = gridOriginFor({ lastSeen: { lat, lng } });
  const key = areaKey(center.lat, center.lng);

  try {
    let saved = await dbGet(key);
    if (!saved || !coversGrid(saved.osm, center) || saved.osm.radiusM < radiusM) saved = await findSavedAreaCovering(center);
    if (saved && saved.osm && (saved.osm.radiusM >= radiusM || coversGrid(saved.osm, center))) {
      return {
        osm: saved.osm, fromCache: true, savedAt: saved.savedAt,
        more: saved.osm.layers ? null : fetchLayers(saved.osm),
      };
    }
  } catch (err) {
    console.warn('Could not read saved map data', err);
  }

  let json;
  try {
    json = await fetchOverpass(center.lat, center.lng, radiusM, { onProgress });
  } catch (err) {
    const fallback = await findSavedAreaNear(lat, lng, NEAR_OFFLINE_M).catch(() => null);
    if (fallback) return { osm: fallback.osm, fromCache: true, savedAt: fallback.savedAt, more: null };
    throw err; // err.offline is true when there was no connection
  }
  const osm = parseOverpass(json, center, radiusM);
  const savedAt = new Date().toISOString();
  try {
    await dbPut(key, { osm, savedAt });
  } catch (err) {
    console.warn('Could not save map data', err);
  }
  return { osm, fromCache: false, savedAt, more: osm.layers ? null : fetchLayers(osm) };
}
