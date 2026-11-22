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
//   routeFor(area, prediction, sectorId)   → routes.js  a walking route through one area

export { prepareArea, withLayers } from './graph.js';
export { replay, cellToLatLng, nextSectors, topSpots, hazardSpots } from './grid.js';
export { routeFor } from './routes.js';
