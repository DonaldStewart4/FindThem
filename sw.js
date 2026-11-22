// sw.js: the service worker. It lets FindThem open and work with no signal.
// Bump CACHE_VERSION whenever any app file changes, so phones fetch the new copies.
const CACHE_VERSION = 'v16';
const SHELL_CACHE = 'findthem-shell-' + CACHE_VERSION;
const TILE_CACHE = 'findthem-tiles'; // kept across versions; tiles don't change with our code
const MAX_TILES = 2000;              // oldest tiles are deleted past this many

// The "app shell": files the app needs to start offline.
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'data.js', 'i18n.js',
  'config.js', 'sync.js', 'report.js', 'manifest.json',
  'engine/index.js', 'engine/graph.js', 'engine/sim.js', 'engine/grid.js', 'engine/routes.js',
  'lib/leaflet.js', 'lib/leaflet.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  // The Demo's Fremont streets (3 MB), so the Demo works offline even if it was never
  // pressed online. Worth it: the Demo is how judges and new users try the app.
  'tests/fixtures/demo-area.json'
];

// Install: save the shell. Files are added one by one so a missing file
// (for example one still being written) doesn't stop the rest from caching.
// { cache: 'reload' } skips the browser's HTTP cache, so a new version never saves stale copies
// (GitHub Pages lets browsers keep files for 10 minutes).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(SHELL_FILES.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => console.warn('sw: skipped', url))
      ))
    ).then(() => self.skipWaiting())
  );
});

// Activate: delete shell caches from older versions, then take control now.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((n) => n.startsWith('findthem-shell-') && n !== SHELL_CACHE)
        .map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only GETs are ever cached
  const url = new URL(req.url);

  // OSM map tiles: cache-first, only tiles the user actually looked at.
  // We never prefetch or bulk-download tiles (OSM tile usage policy).
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tileFirst(req));
    return;
  }

  // Everything else from another site (Overpass, Nominatim, Firebase,
  // the LLM proxy, ...) is network-only: we don't touch it, so live search
  // data and reports are never served stale.
  if (url.origin !== self.location.origin) return;

  // Same-site API calls (if the proxy is ever served from here): network-only.
  if (url.pathname.includes('/api/') || url.pathname.includes('/proxy/')) return;

  // App shell and the demo area file (tests/fixtures/demo-area.json, cached
  // the first time it's used): serve from cache, refresh in the background.
  event.respondWith(cacheFirstWithUpdate(event, req));
});

// Cache-first, then update the cached copy from the network for next time.
async function cacheFirstWithUpdate(event, req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req, { cache: 'no-cache' }).then((res) => { // ask the server if it changed
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {})); // offline: fine, keep the old copy
    return cached;
  }
  try {
    return await network;
  } catch (err) {
    // Offline and never cached: for page loads, fall back to the app page.
    if (req.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    throw err;
  }
}

// Tiles: cache-first. New tiles are saved, and the oldest ones are trimmed.
async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // Tiles load cross-origin, so the response may be "opaque" (status 0); keep those too.
  if (res && (res.ok || res.type === 'opaque')) {
    await cache.put(req, res.clone());
    trimTiles(cache); // no await: don't slow the map down
  }
  return res;
}

// Delete the oldest tiles (keys come back in the order they were added).
async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
