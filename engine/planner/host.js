// engine/planner/host.js — runs the engine AND the planner on behalf of the screen: holds the
// prepared area, replays a case when its map-changing events change, and answers "plan the
// search". engine/planner/worker.js wraps it in a Web Worker so none of it runs on the page's
// own thread. Kept free of worker code so the tests can run it in Node.
//
// MERGE: prior-v2 has its own engine/host.js with setArea / addLayers / run. The planner's
// part is the `plan` method below; docs/PLANNER-MERGE.md shows it folded into that file.

import { prepareArea } from '../graph.js';
import { replay } from '../grid.js';
import { planSearch, plannerWorld } from './adapter.js';

export function createPlannerHost() {
  let areaKey = null;
  let area = null;
  let replayKey = null;   // the case + the events the engine's map depends on, as text
  let prediction = null;
  return {
    // A new map area (OsmData from data.js). Built once per area and kept.
    setArea(key, osm) {
      area = prepareArea(osm);
      areaKey = key;
      replayKey = null; prediction = null;
    },
    // Builds the planner's world for a case ahead of time (optional; plan() does it on first use).
    warm(key, caseInput) {
      if (key !== areaKey || !area) throw new Error('warm: unknown area');
      plannerWorld(area, caseInput);
    },
    // { plan, replayed }: replayed says whether the engine's map had to be worked out again.
    plan(key, caseInput, events, searchers, nowMs, params) {
      if (key !== areaKey || !area) throw new Error('plan: unknown area');
      // The engine's map only changes with the case and with searched / sighting events.
      const mapEvents = (events || []).filter((e) => e && (e.type === 'searched' || e.type === 'sighting'));
      const wanted = JSON.stringify([caseInput, mapEvents]);
      const replayed = wanted !== replayKey;
      if (replayed) { prediction = replay(area, caseInput, mapEvents); replayKey = wanted; }
      return { plan: planSearch(area, caseInput, prediction, { searchers, events, nowMs, params }), replayed };
    },
  };
}
