// tools/make-fixture.js — saves the Fremont demo area as tests/fixtures/demo-area.json.
//
// That one file is used twice:
//   - the Demo button loads it, so the demo works even when the Overpass servers are busy;
//   - the engine tests use it, so they run on real streets with no network.
//
// Run from the project folder:
//   node tools/make-fixture.js                 (downloads from Overpass)
//   node tools/make-fixture.js saved-raw.json  (uses an Overpass answer you already saved)
//   node tools/make-fixture.js --add layers-raw.json relations-raw.json ...
//       keeps the fixture's streets and creeks exactly as they are and only ADDS what the given
//       Overpass answers hold: the ground layers (buildings, fences, rail, land use, bus stops;
//       OsmData.layers) and lakes / parks stored as relations (Lake Elizabeth). Used on Nov 22
//       so the "prior v2" engine got these without the street data (and every test that
//       depends on it) shifting underneath.

import fs from 'node:fs';
import { fetchOverpass, parseOverpass, parseLayers, relationFeatures, DEFAULT_RADIUS_M } from '../data.js';

// Same point as DEMO_LOCATION in app.js.
const CENTER = { lat: 37.5530, lng: -121.9700 };
const OUT = new URL('../tests/fixtures/demo-area.json', import.meta.url);

let osm;
if (process.argv[2] === '--add') {
  osm = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  for (const file of process.argv.slice(3)) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const layers = parseLayers(json, osm.center);
    if (layers) { osm.layers = layers; osm.layersSavedAt = new Date().toISOString(); }
    const have = new Set(osm.features.map((f) => f.id));
    for (const el of json.elements || []) {
      if (el.type !== 'relation') continue;
      for (const f of relationFeatures(el)) if (!have.has(f.id)) { osm.features.push(f); have.add(f.id); }
    }
  }
} else {
  const rawFile = process.argv[2];
  const json = rawFile
    ? JSON.parse(fs.readFileSync(rawFile, 'utf8'))
    : await fetchOverpass(CENTER.lat, CENTER.lng, DEFAULT_RADIUS_M, {
        attempts: 8,
        extraHeaders: { 'User-Agent': 'FindThem/0.1 (hackathon prototype)' },
      });
  osm = parseOverpass(json, CENTER, DEFAULT_RADIUS_M);
  osm.savedAt = new Date().toISOString();
}
osm.source = 'OpenStreetMap contributors (ODbL), via the Overpass API';

fs.mkdirSync(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(osm));

const types = {};
for (const f of osm.features) types[f.type] = (types[f.type] || 0) + 1;
console.log(`Saved ${OUT.pathname}`);
console.log(`${osm.nodes.length} nodes, ${osm.ways.length} ways, ${osm.features.length} features`, types);
if (osm.layers) {
  const kinds = {};
  for (const l of [...osm.layers.lines, ...osm.layers.areas]) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
  console.log(`layers: ${osm.layers.buildings.length} buildings, ${osm.layers.busStops.length} bus stops`, kinds);
}
console.log(`${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
