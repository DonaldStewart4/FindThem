// engine/host.js — runs the engine on behalf of the screen: holds the prepared area, answers
// "replay this case". engine/worker.js wraps it in a Web Worker so the heavy work (drawing the
// ground map, running the walkers) happens off the page's own thread and the page never freezes.
// Kept as a plain module with no worker code in it, so the tests can run it in Node.

import { prepareArea, withLayers } from './graph.js';
import { replay, topSpots, hazardSpots } from './grid.js';

// A tiny made-up area and case, used once when the worker starts: running the engine on it
// makes the browser compile and optimize the engine's code while the person is still reading
// the first screen, so their first real map is not the slow first run. The result is thrown away.
export function warmUp() {
  const center = { lat: 0, lng: 0 };
  const d = 0.004; // about 440 m
  const nodes = [];
  const ways = [];
  let id = 1;
  for (let k = -3; k <= 3; k++) {
    const a = id++; const b = id++; const c = id++; const e = id++;
    nodes.push({ id: a, lat: k * d, lng: -4 * d }, { id: b, lat: k * d, lng: 4 * d }, { id: c, lat: -4 * d, lng: k * d }, { id: e, lat: 4 * d, lng: k * d });
    ways.push({ id: id++, highway: 'residential', name: null, nodeIds: [a, b] }, { id: id++, highway: 'footway', name: null, nodeIds: [c, e] });
  }
  const osm = { center, radiusM: 3400, nodes, ways, features: [] };
  const area = prepareArea(osm);
  const caseInput = { lastSeen: center, minutes: 30, direction: 'N', mobility: 'normal', familiarPlaces: [{ lat: 2 * d, lng: 2 * d, label: '' }], seed: 1 };
  const prediction = replay(area, caseInput, [{ id: 'a', type: 'searched', sectorId: 'r16c16', minutes: 10, at: 1 }, { id: 'b', type: 'sighting', lat: d, lng: d, direction: null, minutesSince: 5, reliability: 0.5, at: 2 }]);
  topSpots(area, prediction, 3);
  hazardSpots(area, prediction, 3);
}

export function createHost() {
  let areaKey = null;
  let area = null;
  return {
    // A new area: the full OsmData from data.js.
    setArea(key, osm) {
      area = prepareArea(osm);
      areaKey = key;
    },
    // The same area's ground layers arrived later (the second download).
    addLayers(key, layers) {
      if (key !== areaKey || !area) throw new Error('addLayers: unknown area');
      area = withLayers(area, layers);
    },
    // Replays a case and also works out the lists the screen shows.
    // Returns { prediction, spots, hazards, ms }. The walkers' end points are left out of
    // `prediction` (the screen doesn't draw them, and they are 5,000 objects to copy across).
    run(key, caseInput, events, { spotsMax = 8, hazardsMax = 5 } = {}) {
      if (key !== areaKey || !area) throw new Error('run: unknown area');
      const t0 = Date.now();
      const prediction = replay(area, caseInput, events);
      const spots = topSpots(area, prediction, spotsMax);
      const hazards = hazardSpots(area, prediction, hazardsMax);
      const slim = { ...prediction, sim: { ...prediction.sim, endpoints: [] } };
      return { prediction: slim, spots, hazards, ms: Date.now() - t0 };
    },
  };
}
