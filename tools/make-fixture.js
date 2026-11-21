// tools/make-fixture.js — saves the Fremont demo area as tests/fixtures/demo-area.json.
//
// That one file is used twice:
//   - the Demo button loads it, so the demo works even when the Overpass servers are busy;
//   - the engine tests use it, so they run on real streets with no network.
//
// Run from the project folder:
//   node tools/make-fixture.js                 (downloads from Overpass)
//   node tools/make-fixture.js saved-raw.json  (uses an Overpass answer you already saved)

import fs from 'node:fs';
import { fetchOverpass, parseOverpass, DEFAULT_RADIUS_M } from '../data.js';

// Same point as DEMO_LOCATION in app.js.
const CENTER = { lat: 37.5530, lng: -121.9700 };
const OUT = new URL('../tests/fixtures/demo-area.json', import.meta.url);

const rawFile = process.argv[2];
const json = rawFile
  ? JSON.parse(fs.readFileSync(rawFile, 'utf8'))
  : await fetchOverpass(CENTER.lat, CENTER.lng, DEFAULT_RADIUS_M, {
      attempts: 8,
      extraHeaders: { 'User-Agent': 'FindThem/0.1 (hackathon prototype)' },
    });

const osm = parseOverpass(json, CENTER, DEFAULT_RADIUS_M);
osm.savedAt = new Date().toISOString();
osm.source = 'OpenStreetMap contributors (ODbL), via the Overpass API';

fs.mkdirSync(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(osm));

const types = {};
for (const f of osm.features) types[f.type] = (types[f.type] || 0) + 1;
console.log(`Saved ${OUT.pathname}`);
console.log(`${osm.nodes.length} nodes, ${osm.ways.length} ways, ${osm.features.length} features`, types);
console.log(`${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
