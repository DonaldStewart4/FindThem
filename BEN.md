# BEN.md: what changed in your files, and why

Branch `prior-v2` (Nathan's engine rewrite, Nov 22). Not merged, not pushed. This lists every change made to the screen files so your frontend edits don't collide with them. Full detail is in `CommitHistory.md` (the three "Prior v2" entries) and the new contract is in `INTERFACES.md`.

**Nothing you draw changed shape.** `prediction.grid.p`, `sectors`, `sim.edgeCounts`, spots and routes are read the same way as before. One number changed meaning: `grid.p` now sums to `1 − prediction.restOfWorld` instead of 1 (your `drawHeat` adds up its own total, so the bands are unaffected).

## `app.js`

| Where | What | Why |
|---|---|---|
| `readCase()` | Adds `minutesAt: state.minutesAt`. | The engine needs the clock to place events in time: a sighting now spreads as time passes, and a search doesn't count against someone who arrived later. `shareLink()` and the shared case already carried `minutesAt`; they still set it the same way. |
| after `areaCache` | New block "The engine runs in a background worker": `startWorker`, `askWorker`, `failWorker`, `runEngine`, and the variables above them. | A cold replay takes 0.9–1.5 s with the processor slowed four times. In a Web Worker (`engine/worker.js`) the page doesn't freeze. If the worker can't start, or doesn't answer in 20 s, `runEngine` calls `engine.replay` on the page as before. |
| start-up (`boot`) and new `startWorker()` | The worker is started when the page opens, not at the first map. | The worker warms the engine up on a tiny made-up area (`engine/host.js` `warmUp`), so the first real map isn't the browser's slow first run of that code. |
| `areaCache` | Now `{ key, area, osm, version, areaVersion }`. | `version` goes up when the area or its layers change, so the worker knows when to take new data. |
| `recompute()` | Now `async`: it asks `runEngine` and draws when the answer is back. `state.lastSpots` comes from the worker's answer. If two requests overlap, only the newest is drawn. | The worker. |
| `runPrediction()` | `await recompute()`. Sets `areaVersion`. If `loaded.more` exists, shows `mapRefining` and calls `refineArea` when it settles. | Two-phase load. |
| new `refineArea()` | Swaps in the area with its layers (`engine.withLayers`) and recomputes, then shows `mapRefined`. | Two-phase load: the first map comes from the streets alone, the sharper one when buildings and land use arrive. |
| `renderSpots()` | After the existing `spot.hazard` line: `else if (spot.hazardNearby)` adds a `spot-hazard` line with `spotHazardNear`. | The engine's new hazard layer. The Demo's first spot now says a drainage channel is 260 ft away. |
| `renderAreas()` | After the "searched for N min" line: `if (sector.hazard)` adds a `spot-hazard` line with `areaHazard`. | Same layer, for areas. |
| `saveHomeArea()` | Passes `radiusM: data.HOME_RADIUS_M`. | A home area is saved bigger (4.2 km each way), so a last-seen point up to about 1 km from home is fully covered with no signal. |

Callers of `recompute()` that don't `await` it (clock tick, `recordEvent`, the live subscription) still work: the map redraws when the answer arrives, a moment after the call returns. **If you add code that reads `state.prediction` right after calling `recompute()`, `await` it first.**

## `data.js`

| What | Why |
|---|---|
| The download is a **square** (`[bbox:...]`), not a circle, centered on the case's grid origin (the point rounded to 3 decimals), 3.4 km each way. New `boxAround`, `GRID_HALF_M`, `DOWNLOAD_MARGIN_M`, `HOME_RADIUS_M`; `DEFAULT_RADIUS_M` is now 3,400. `osm.bounds` holds the square. | The engine's map is a square of 3.2 km each way. With a circle its corners had no data, and the Demo had none under a third of its map. Boxes are also quicker for Overpass: in tonight's live test the streets took 39 s and the buildings another 28 s, where the building request by circle had taken 55 s on its own. |
| **Two requests.** `buildQuery` = streets, creeks, water, parks, plus lakes and parks stored as relations (Lake Elizabeth was missing before). New `buildLayersQuery` = buildings, fences, rail, motorways, land use, bus stops. | The first is enough for a full prediction; the second is big (about 3.7 MB on the wire for Fremont). |
| `loadArea` returns `{ osm, fromCache, savedAt, more }`. `more` is a promise for `{ osm, savedAt }` with `osm.layers`, or `null`. It never rejects. New `fetchLayers`. | Two-phase load. |
| A saved area is reused only if it covers the whole map (`coversGrid`, `findSavedAreaCovering`). `NEAR_ONLINE_M` is gone. With no signal, any saved area within 2.5 km is still used. | The no-data bug: a saved home area 800 m away used to be accepted and left part of the map empty. **Areas saved before today are circles, so with signal they are downloaded again once.** |
| New `parseLayers`, `packPoints`, `relationFeatures`; `parseOverpass` adds `bounds` and, if present, `layers`. `fetchOverpass` takes `{ query }`. | The new layers. Buildings are stored as short lists of whole numbers, about a third the size of `{lat, lng}` objects. |
| `import { gridOriginFor } from './engine/grid.js'`. | So the download and the engine's map share one center. |

## `sw.js`

- `CACHE_VERSION` `v28` → `v31`.
- `SHELL_FILES` gained `engine/surface.js`, `engine/params.js`, `engine/calibrated.js`, `engine/prior.js`, `engine/host.js`, `engine/worker.js`. **If you bump the version again, keep these.**

## `i18n.js`

Four new keys in all five languages, placed right after `usingSaved`: `mapRefining`, `mapRefined`, `areaHazard`, `spotHazardNear` (takes `{dist}`). The Spanish, French, Chinese and Japanese are mine and unreviewed by a native speaker.

## `tests/fixtures/demo-area.json` and `tools/make-fixture.js`

- The Demo's area is now a square centered on the Demo's own grid origin (37.541, −121.98), 3.4 km each way, with the ground layers and Lake Elizabeth. 3.0 → 6.9 MB (33,977 buildings). `DEMO_LOCATION` in `app.js` (where the map opens) is unchanged.
- `make-fixture.js` was rewritten to download that square in two requests (`--center`, `--half`, `--out`).

## New things you may want on screen (nothing here is required)

- `prediction.restOfWorld`: the chance that the person is not on this map at all. It is near 0 in the first hour and reaches about 20% after many hours. Worth one line under the results when it is above a few percent.
- `engine.hazardSpots(area, prediction, n)` (the worker also returns it as `hazards`): the most dangerous water and channels near the likely area. Not shown yet.
- `prediction.hasLayers`: `false` while the first, streets-only map is showing.
- `prediction.noDataShare`: share of the map with no data under it (an old saved area used offline).

## Checked in a browser after these changes (headless Chrome, scripts in `tools/browser/`)

- **Demo:** results on screen 0.9 s after the tap; 1.3 s with the page's processor slowed four times. No page errors apart from the proxy's CORS notice on `localhost`.
- **A new area (live download, central Fremont):** first map after 38.8 s from the streets alone; "Map sharpened with buildings and land use." at 66.2 s; the area saved with 28,628 buildings.
- **Two tabs on one shared search (mock database):** same top spots in both; the link and the database case both carry `minutesAt`; an area marked searched in one tab reached the other 106 ms later, and both then showed the same spots and next areas.
- **Not checked:** a real phone, Safari, the service worker's offline path with the new files, the home-area save, the hand-off sheet, the report box.
