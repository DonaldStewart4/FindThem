// tools/make-fixture.js — saves a map area as a JSON file, the way the app would download it.
//
// Used for two files:
//   - tests/fixtures/demo-area.json: the Demo's Fremont area. The Demo button loads it, so the
//     demo works even when the Overpass servers are busy, and the engine tests use it, so they
//     run on real streets with no network. Since Nov 22 it is a square centered on the Demo's
//     own last-seen point (its grid origin), so the whole map has data.
//   - tools/data/fremont-wide.json.gz: a bigger square (same center) for tools/calibrate.js
//     and bench/prior-eval.js, whose start points are spread out and each need data 3.2 km
//     in every direction. Never loaded by the app.
//
// Run from the project folder:
//   node tools/make-fixture.js                       the Demo fixture (two Overpass requests)
//   node tools/make-fixture.js --half 5600 --out tools/data/fremont-wide.json.gz
//   node tools/make-fixture.js streets.json layers.json   use Overpass answers you saved
//
// Options: --center lat,lng   --half meters (half the side of the square)   --out file
//          (a name ending in .gz is written gzipped)

import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  fetchOverpass, parseOverpass, parseLayers, buildLayersQuery, DEFAULT_RADIUS_M,
} from '../data.js';
import { gridOriginFor } from '../engine/grid.js';

// The Demo's last-seen point (DEMO_CASE in app.js) and the grid origin the engine gives it.
const DEMO_LAST_SEEN = { lat: 37.5405, lng: -121.9795 };

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const centerArg = option('--center');
const half = Number(option('--half')) || DEFAULT_RADIUS_M;
const outArg = option('--out');
const center = centerArg
  ? { lat: Number(centerArg.split(',')[0]), lng: Number(centerArg.split(',')[1]) }
  : gridOriginFor({ lastSeen: DEMO_LAST_SEEN });
const out = outArg ? new URL(outArg, `file://${process.cwd()}/`) : new URL('../tests/fixtures/demo-area.json', import.meta.url);

const headers = { 'User-Agent': 'FindThem/0.1 (hackathon prototype)' };
const [streetsFile, layersFile] = args;
const streets = streetsFile
  ? JSON.parse(fs.readFileSync(streetsFile, 'utf8'))
  : await fetchOverpass(center.lat, center.lng, half, { attempts: 10, extraHeaders: headers, onProgress: (p) => p.stage === 'retry' && console.log('  streets: retry', p.attempt) });
const osm = parseOverpass(streets, center, half);
console.log(`streets: ${osm.nodes.length} nodes, ${osm.ways.length} ways, ${osm.features.length} features`);

const layersJson = layersFile
  ? JSON.parse(fs.readFileSync(layersFile, 'utf8'))
  : await fetchOverpass(center.lat, center.lng, half, {
      attempts: 10, extraHeaders: headers, query: buildLayersQuery(center.lat, center.lng, half),
      onProgress: (p) => p.stage === 'retry' && console.log('  layers: retry', p.attempt),
    });
osm.layers = parseLayers(layersJson, center);
if (!osm.layers) throw new Error('The second answer has no ground layers in it.');
osm.savedAt = new Date().toISOString();
osm.source = 'OpenStreetMap contributors (ODbL), via the Overpass API';

fs.mkdirSync(new URL('./', out), { recursive: true });
const text = JSON.stringify(osm);
fs.writeFileSync(out, out.pathname.endsWith('.gz') ? zlib.gzipSync(text, { level: 9 }) : text);

const types = {};
for (const f of osm.features) types[f.type] = (types[f.type] || 0) + 1;
const kinds = {};
for (const l of [...osm.layers.lines, ...osm.layers.areas]) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
console.log(`Saved ${decodeURI(out.pathname)}`);
console.log(`center ${center.lat}, ${center.lng}; square of ${2 * half} m`);
console.log('features', types);
console.log(`layers: ${osm.layers.buildings.length} buildings, ${osm.layers.busStops.length} bus stops`, kinds);
console.log(`${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
