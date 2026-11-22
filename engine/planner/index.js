// engine/planner/index.js — what the rest of the app imports from the search planner.
//
//   planSearch(area, caseInput, prediction, { searchers, events, nowMs })  → Plan
//       who should search where next: up to three options per searcher, plus the measures
//       (cumulative POS, remaining probability, rest-of-world trend, "expand" signal)
//   assignedEvent(option, searcherId, nowMs)   → the event to send when an option is accepted
//   trackFromLatLngs(area, caseInput, points)  → a GPS trail as the `track` of an event
//   plannerWorld(area, caseInput)              → { world, segs } for tools, tests and the benchmark
//
// See docs/PLANNER.md for the design and engine/planner/adapter.js for how it meets the engine.

export { planSearch, assignedEvent, trackFromLatLngs, plannerWorld, plannerMap, minutesSinceLastSeen } from './adapter.js';
export { planSearch as planOnWorld, posterior, readEvents } from './plan.js';
export { buildWorld } from './world.js';
export { buildSegments } from './segments.js';
export { DEFAULTS as PLANNER_DEFAULTS } from './params.js';
