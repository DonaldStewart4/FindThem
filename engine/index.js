// engine/index.js — the one file the screen imports. It just collects the engine's exports
// (the list in INTERFACES.md section 2) from the files that implement them.
//
//   prepareArea(osm)                       → graph.js   street network + trap lookup
//   replay(area, caseInput, events)        → grid.js    walkers → map → Bayes updates
//   cellToLatLng(area, grid, cellIndex)    → grid.js    for drawing the likely areas
//   nextSectors(prediction, minutes, n)    → grid.js    where the next searchers should go
//   topSpots(area, prediction, n)          → grid.js    "Check these first"
//   routeFor(area, prediction, sectorId)   → routes.js  a walking route through one area

export { prepareArea } from './graph.js';
export { replay, cellToLatLng, nextSectors, topSpots } from './grid.js';
export { routeFor } from './routes.js';
