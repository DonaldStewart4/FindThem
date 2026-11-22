// engine/host.js — runs the engine on behalf of the screen: holds the prepared area, answers
// "replay this case". engine/worker.js wraps it in a Web Worker so the heavy work (drawing the
// ground map, running the walkers) happens off the page's own thread and the page never freezes.
// Kept as a plain module with no worker code in it, so the tests can run it in Node.

import { prepareArea, withLayers } from './graph.js';
import { replay, topSpots, hazardSpots } from './grid.js';

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
