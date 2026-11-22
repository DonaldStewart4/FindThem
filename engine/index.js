// engine/index.js — the one file the screen imports. It just collects the engine's exports
// (the list in INTERFACES.md section 2) from the files that implement them.
//
//   prepareArea(osm)                       → graph.js   street network + trap lookup
//   withLayers(area, layers)               → graph.js   the same area once its buildings arrive (new)
//   replay(area, caseInput, events)        → grid.js    walkers → map → Bayes updates
//                                            (surface.js draws the 10 m ground map, sim.js runs
//                                            the walkers, params.js holds every tunable number)
//   cellToLatLng(area, grid, cellIndex)    → grid.js    for drawing the likely areas
//   nextSectors(prediction, minutes, n)    → grid.js    where the next searchers should go
//   topSpots(area, prediction, n)          → grid.js    "Check these first"
//   hazardSpots(area, prediction, n)       → grid.js    water and channels near the likely area (new)
//   woodsSpots(area, prediction, n)        → grid.js    woods and brush near the likely area: check
//                                            from the path (new)
//   routeFor(area, prediction, sectorId)   → routes.js  a walking route through one area
//   planSearch(area, caseInput, prediction, { searchers, events, nowMs })  → planner/  who searches
//                                            where: up to three ranked routes per searcher (new)
//   assignedEvent(option, searcherId, nowMs) → planner/  the event sent when a route is taken (new)
//   trackFromLatLngs(area, caseInput, points) → planner/ a GPS trail as an event's `track` (new)
//   ENGINE_VERSION                           the shared case carries it, so a phone running a
//                                            different engine can warn that maps may differ (new)

export { prepareArea, withLayers } from './graph.js';
export { replay, cellToLatLng, nextSectors, topSpots, hazardSpots, woodsSpots } from './grid.js';
export { routeFor } from './routes.js';
export { planSearch, assignedEvent, trackFromLatLngs } from './planner/index.js';

// Bump this whenever the engine gives a different map or plan for the same inputs.
// Format: date, a dot, a counter (sync.js checks it).
export const ENGINE_VERSION = '2026-11-22.2';
