# INTERFACES: how the screen and the engine talk

This is the contract between the two halves of FindThem:

- **Screen** (`app.js`, `data.js`, `sync.js`, `report.js`, …): BenStew, with AI help.
- **Engine** (`engine/`): BenStew, built with Claude Code.
- **Tests and speed** (`tests/`, `bench/`): Nathan, with AI help allowed.

If every side follows this file, the halves plug together at integration. **Change it only when BenStew and Nathan agree**, and log the change in `CommitHistory.md`. *Status: implemented. `engine/` and the screen both follow it, and the tests check it. **Updated Nov 22 (Nathan's engine rewrite, "prior v2", and the planner): everything marked "new" below; BenStew has not reviewed these changes yet.** Section 5 (`ReportDraft` v2, street corners) and the `assigned` event's `toId` were approved by Nathan on 2026-11-22 with `docs/AGENT-CONTRACT.md`, the contract for anything an AI agent may read or propose.* ("Jev" is not a teammate; it's the AI model in the report box.)

## Ground rules

- **Modules:** ES modules (`export function …`). The browser loads them with `<script type="module">`. `package.json` holds only `{ "type": "module" }` so `node --test` can import them too. No dependencies.
- **One entry point:** the screen imports everything from `engine/index.js`, which re-exports the engine files. (A dev-only `engine/fake.js` with the same exports was used until the real engine was ready, then deleted.)
- **Pure and deterministic:** no DOM, no `Math.random()`, no `Date.now()` inside the engine. The same inputs and seed must give exactly the same output on every phone. That's what makes shared maps and share links work.
- **Don't mutate inputs:** functions return new objects (copying a `Float64Array` is cheap).
- **Units:**

| Quantity | Unit |
|---|---|
| distance | meters |
| angle | degrees, 0 = north, clockwise |
| time | milliseconds since epoch (`at` fields) or minutes (durations) |
| position | `{ lat, lng }` |

- **Coordinates:** inside the engine, work in local meters, `x` east and `y` north, using an equirectangular projection. The street graph is measured from `area.origin`; **the probability grid, the sectors and the walkers are measured from the case's grid origin (new)**, so every phone on one search cuts the ground the same way. The screen only ever sees `{ lat, lng }`.

## 1. Data the screen gives the engine

`data.js` exports `loadArea(lat, lng, { radiusM, onProgress }) → Promise<{ osm, fromCache, savedAt, more }>`. That's screen-internal; the engine only cares about the shape of `osm`.

**New: the download is a square, in two phases.**
- The square is centered on the case's grid origin (the last-seen point rounded to 3 decimals) and reaches `radiusM` each way: 3,400 m for a search (the engine's map is 3,200 m each way), 4,200 m for "Save my home area".
- Phase 1 (`osm`): streets, creeks, water, parks. Enough for a full prediction.
- Phase 2 (`more`): a promise for `{ osm, savedAt }` with `osm.layers` added (buildings, fences, rail, land use, bus stops), or `null` if it couldn't be fetched. `more` is `null` when there is nothing to wait for. The screen calls `engine.withLayers(area, layers)` and replays.
- A saved area is reused only if it covers the whole map of the new case (`coversGrid`). With no signal, any saved area near the point is used.

```js
OsmData = {
  center: { lat, lng },          // middle of the downloaded square
  radiusM: 3400,                 // half the side of the square
  bounds: { south, west, north, east },   // new. Missing on areas saved before Nov 22: those are
                                 // circles of radiusM around center, and still work
  nodes: [ { id, lat, lng } ],   // every node used by a way below
  ways: [ {
    id,                          // OSM way id (number)
    highway: 'residential',      // footway|path|pedestrian|residential|living_street|service|
                                 // tertiary|secondary|primary|unclassified|track|steps|cycleway
    name: 'Main St' | null,
    nodeIds: [ id, id, ... ]     // in order along the way
  } ],
  features: [ {                  // "trap" features where people are often found
    id,                          // OSM id, prefixed: 'w123' (way) or 'r456' (relation; new: big lakes
                                 // and parks stored as relations, e.g. Lake Elizabeth)
    type: 'creek' | 'river' | 'water' | 'wetland' | 'woods' | 'brush' | 'grass' | 'park',
    name: 'Shoal Creek' | null,
    shape: 'line' | 'area',      // line = creek centerline, area = closed polygon
    points: [ { lat, lng } ]     // area polygons are closed (first point == last point)
  } ],
  layers: {                      // new, OPTIONAL: what the walkers' 10 m ground map adds on top
    version: 1, unitDeg: 0.00001,
    buildings: [ packed, ... ],                      // closed outlines
    lines: [ { kind: 'fence' | 'rail' | 'motorway', pts: packed } ],   // nobody walks across these
    areas: [ { kind: 'yard' | 'lot' | 'green', pts: packed } ],
    busStops: [ [lat, lng], ... ]
  }
}
```

`packed` is a flat list of whole numbers: each point as the step from the previous one (the first from `center`), latitude then longitude, in units of `unitDeg` (`packPoints` in `data.js`). Without `layers` the engine still runs, on a rougher ground map.

`data.js` maps OSM tags to `type`:

| OSM tags | `type` |
|---|---|
| `waterway=stream/ditch/drain/canal` (skip `tunnel=culvert`) | `creek` |
| `waterway=river` | `river` |
| `natural=water` | `water` |
| `natural=wetland` | `wetland` |
| `natural=wood`, `landuse=forest` | `woods` |
| `natural=scrub` | `brush` |
| `landuse=meadow/grass` | `grass` |
| `leisure=park` | `park` |

**Skip** every other `waterway` value. In particular, `waterway=pressurised` is an underground pipe: Fremont has several, such as the Bay Division Pipelines, and they must not count as creeks.

`HAZARD_TYPES = ['creek', 'river', 'water', 'wetland']` are flagged "for professionals, not untrained volunteers".

**Test fixture:** the screen saves one real `OsmData` for the demo area as `tests/fixtures/demo-area.json`, so engine tests run on real streets with no network.

```js
CaseInput = {
  lastSeen: { lat, lng },
  minutes: 45,                   // minutes since last seen, as of minutesAt
  direction: 'NE' | null,        // N NE E SE S SW W NW, or null = unknown
  mobility: 'normal' | 'slow' | 'walker',
  familiarPlaces: [ { lat, lng, label } ],   // 0 to 3
  seed: 123456789,               // uint32, chosen once when the search is created
  minutesAt: 1795337448403,      // new, optional: the clock time (ms) at which `minutes` was true.
                                 // Lets the engine place each event in time. Without it every
                                 // event counts as "now".
  gridOrigin: { lat, lng }       // new, optional. If absent the engine uses the last-seen point
                                 // rounded to 3 decimals, which every phone works out the same
}
```

The engine reads `lastSeen`, familiar places and sighting points at 6 decimals (what the share link carries), so the phone that created a search and a phone that joined by link get the same map.

```js
Event =
  | { id, type: 'searched', sectorId: 'r12c7', minutes: 20, by: 'Ana', at }  // searcher-minutes spent, no one found
  | { id, type: 'sighting', lat, lng, direction: 'E' | null,
      minutesSince: 10,          // minutes from the sighting to when it was reported (fixed)
      reliability: 0.3 | 0.6 | 0.9,   // "maybe" / "probably" / "sure"
      note: 'blue coat', at }
  | { id, type: 'assigned', sectorId, to: 'Ana', toId: '3f9a…', at }  // the engine ignores this one;
                                 // toId = the searcher's id (optional, added 2026-11-22, for myAssignment)
  | { id, type: 'message', text: 'I have the park', by: 'Ana', at }  // the engine ignores this one
```

`id` is the Firebase push id. The engine sorts events by `at`, then by `id`, before using them. **The engine ignores any event type it doesn't use**, so the screen can add types (like `message`) without breaking it.

## 2. What the engine exports (`engine/index.js`)

The screen calls **only** these.

### `prepareArea(osm) → Area`
Builds the street graph and the trap-feature index. Called once per area and cached by the screen.

```js
Area = {
  origin: { lat, lng },          // = osm.center
  graph: {
    nodes: [ { id, lat, lng, x, y, edges: [ edgeIndex, ... ] } ],
    edges: [ { a, b, length, bearingAB, wayId, name, highway } ]  // a, b = node indices; bearingAB = a→b; highway = OSM street type
  },
  traps: <anything>,             // engine-internal: features + a fast "within 30 m" lookup
  osm                            // new: kept so the ground map can be drawn once the case is known
}
```

The screen reads `graph.nodes[i].lat/lng`, `graph.edges[j].a/b/wayId/name` to draw streets. Everything else in `Area` is the engine's business.

### `withLayers(area, layers) → Area` (new)
The same area once phase 2 of the download has arrived. The street graph is shared, not rebuilt. It is a new object, so the engine draws a new ground map for it.

### `replay(area, caseInput, events) → Prediction`
**The main call.** The map for "`minutes` since last seen":
- **Prior (new):** a blend of two maps (95% statistics map, 5% walkers, set by evaluation; when the case lists familiar places a further `SHARE_GOAL` = 25% of the map goes to the walkers heading there). (1) 5,000 simulated walkers on a 10 m ground map, each stored minute by minute, where they are at that minute; walkers that spent long on busy roads count for less, because the person is still missing. (2) The ISRID statistics map: the urban distance curve, limited by how far a person could have gone in that time, times the find-location share of each kind of ground. The walkers' share is `BLEND_WALKERS` in `engine/params.js`.
- `searched` → the walkers that were in that sector **at the time of the search** count for less by (1 − POD); the statistics map is discounted by the share of its chance that was already there then. Everything else rises (Bayes).
- `sighting` → 2,500 walkers and a statistics map from the sighting point (seed `(caseInput.seed + 7919 * k) >>> 0` for the k-th sighting, k from 1), for as long as it has been since the person was seen there, blended in as `(1 − r) · current + r · sighting`. Searches made before the sighting don't count against it; searches made after it do.
- Events are sorted by `at`, then by `id` in code-point order (as `sync.js` does). `minutes` on a `searched` event is read with `Number()`.

The screen calls it on every change, through `engine/worker.js` (below). A cold replay takes 0.9–1.5 s in Chrome with the processor slowed four times (first-hour cases). Walkers are simulated in 15-minute blocks, so two clock ticks in three take a few milliseconds and the third re-runs the walkers (0.3–0.5 s slowed four times). A fourth argument, `replay(area, caseInput, events, { blend })`, exists for the calibration and evaluation tools only.

```js
Prediction = {
  sim: {
    nWalkers: 5000,
    endpoints: [ { lat, lng, x, y, edgeIndex: -1, trapType: null, trapId: null } ],  // where each walker is now
                                    // (middle of its 25 m square; x, y = meters from grid.origin).
                                    // Empty when the prediction comes from the worker.
    edgeCounts: [ 0, 12, 3, ... ]   // length = area.graph.edges.length; walkers that used each edge
  },
  grid: {
    cellSize: 25,                   // meters
    cols, rows,                     // 256 x 256
    origin: { lat, lng },           // new: the case's grid origin; the grid reaches 3,200 m each way from it
    p: Float64Array,                // length cols*rows, row-major (index = row*cols + col).
                                    // CHANGED: sums to 1 − restOfWorld, not to 1
    hazard: Float32Array,           // new: the second layer, "where it's dangerous". For a square with
                                    // water, a creek or wetland: the chance that the person is within
                                    // 150 m of it. 0 for every other square.
    hazardType: Uint8Array,         // new: 0 none, 1 water, 2 creek / channel, 3 wetland
    sectors: [ {
      id: 'r12c7',                  // sector row/col; 8×8 cells = 200 m squares
      bounds: [[south, west], [north, east]],
      center: { lat, lng },
      probability: 0.043,           // sum of p inside
      searchedMinutes: 20,          // total from 'searched' events
      pod: 0.55,                    // combined probability of detection so far, 0..1
      hazardScore: 0.02,            // new: the highest hazard value in the sector
      hazard: true                  // new: hazardScore ≥ 0.005: water or a channel near the likely area
    } ]
  },
  restOfWorld: 0.03,                // new: the chance that the person is not on this map at all
  minutes: 45,                      // new: the time the map is for
  noDataShare: 0,                   // new: share of the map with no downloaded data under it
  hasLayers: true                   // new: false while only phase 1 of the download is in
}
```

### `cellToLatLng(area, grid, cellIndex) → { lat, lng }`
The cell's center, measured from `grid.origin`. The screen uses it to place its red/orange/yellow likely-area picture over `grid.p`.

### `nextSectors(prediction, searcherMinutes, count) → [ { sectorId, gain, probability } ]`
Greedy allocation: the `count` best sectors for the next `searcherMinutes` each. `gain` = probability of success that effort would add. Highest gain first; ties broken by sectorId.

### `routeFor(area, prediction, sectorId) → Route`
Routes for people: an ordered walking route along the real streets and paths inside one sector, highest-probability streets first.

```js
Route = {
  sectorId: 'r12c7',
  points: [ { lat, lng } ],      // in walking order; the screen draws it as a line
  edgeIndices: [ 14, 15, 92 ],   // the graph edges it walks, in order
  lengthM: 1150,
  minutes: 19,                   // at SEARCH_SPEED_MPS
  probability: 0.043             // probability covered by walking it
}
```

When a searcher finishes, the screen sends a `searched` event for that sector with the minutes spent. A route with no streets (a sector that's all water or brush) returns `points: []` and the screen shows "for professionals".

### `topSpots(area, prediction, count) → [ Spot ]`
The "Check these first" list: clustered high-probability places, highest first.

```js
Spot = {
  lat, lng,
  probability: 0.12,             // share of total probability in this cluster
  walkerShare: 0.12,             // share of base walkers here now (not shown)
  trapType: 'creek' | null,      // the trap feature the pin sits on, or the kind of water right at it
  trapName: 'Shoal Creek' | null,
  streetName: 'Main St' | null,  // nearest named street
  distanceToStreetM: 40,
  hazard: true,                  // water, a creek or wetland within 50 m of the spot: for professionals
  hazardNearby: { type: 'creek', distanceM: 80, nearbyProbability: 0.19 } | null
                                 // new: the closest water / creek / wetland within 150 m that the
                                 // hazard layer scores ≥ 0.005: "look from the bank, don't go in"
}
```

Spots are at least 150 m apart, measured between the pins as drawn. Hazard flags come from the hazard layer (`grid.hazard`, `grid.hazardType`), never from where walkers ended.

The screen turns a `Spot` into translated text ("Creek 130 ft off Main St – 12% chance they are here", from `probability`, so it follows searches and sightings; `walkerShare` is no longer shown). The engine never builds user-facing strings.

### `hazardSpots(area, prediction, count) → [ HazardSpot ]` (new)
"Where it's dangerous": the water, creek and wetland places with the most chance of the person being within 150 m, at least 150 m apart, most dangerous first. A different list from `topSpots`: a channel can matter a lot without being a likely place itself. **Not shown on the screen yet.**

```js
HazardSpot = { lat, lng, type: 'water' | 'creek' | 'wetland', name, streetName, nearbyProbability }
```

### The engine in a Web Worker (new): `engine/worker.js`
The screen starts `new Worker('engine/worker.js', { type: 'module' })` and sends:

```js
{ id, type: 'area',   key, osm }                              // a new map area
{ id, type: 'layers', key, layers }                           // phase 2 arrived for that area
{ id, type: 'replay', key, caseInput, events, spotsMax }
```

Each is answered with `{ id, ok: true, ... }` or `{ id, ok: false, error }`. A `replay` answer carries `{ prediction, spots, hazards, ms }` (`spots` = `topSpots`, `hazards` = `hazardSpots`; `prediction.sim.endpoints` is empty). If the worker can't start or doesn't answer within 20 s, `app.js` calls `engine.replay` on the page instead. `engine/host.js` is the same logic without the worker wrapper, so tests can run it. The worker is started when the page opens and runs the engine once on a tiny made-up area (`warmUp`), so the browser has optimized the engine's code before the first real map.

## 3. Tunable constants

Every tunable number is a named constant with a comment giving its source and one of three labels: **DATA** (a published number, never tuned), **EXPERT** (a described behavior; the number is ours), **ASSUMPTION** (our choice; the ones in `tools/calibrate.js` are fitted to ISRID).

- `engine/params.js`: the walkers (speed, time moving, mobility, kinds, steering, reasons to stop, spotting rate), the blend, familiar places. `engine/calibrated.js` (written by `tools/calibrate.js`) overrides the defaults.
- `engine/prior.js`: the ISRID tables and the statistics map.
- `engine/surface.js`: the ground map (10 m squares, 3,200 m each way) and how exposed each road type is.
- `engine/grid.js`: 25 m grid, 200 m sectors, search coverage (`SWEEP_WIDTH_M`, `SEARCH_SPEED_MPS`), top spots, hazard layer.

## 4. Tests (`node --test`, Nathan)

- Same `caseInput` + seed → identical output; a different seed → different output; a longer run starts the same way.
- `grid.p` plus `restOfWorld` sums to 1 (±1e-9) after the base map and after **every** event.
- A `searched` event lowers that sector by exactly Bayes' amount and raises every other sector by the same factor; a second search compounds.
- A search only counts against people who were there at the time; a sighting isn't discounted by an earlier search, is by a later one, and spreads as the clock runs.
- Events in any order, including ties in `at`; `minutes` as text.
- Two phones with different downloads cut the ground into the same sectors; a phone that joined by link gets the same map.
- No more than 3% of the Demo's map is without data.
- An area without `layers` works; layers can arrive later (`withLayers`, the worker host).
- Familiar places pull; slow mobility stays closer; walkers differ in speed, kind and road habit.
- The hazard layer scores only water, and the Demo's first spot reports its drainage channel.
- `nextSectors` matches a real brute force over every allocation on tiny maps.
- `topSpots` are really ≥ 150 m apart, most likely first.
- `routeFor` only uses edges inside its sector, and the edges connect in order.
- `replay` doesn't change its inputs.
- A cold replay with 7 searches and 3 sightings stays inside the phone budget; memory per walker-minute is 4 bytes.

## 5. Report box (screen-only, here for reference)

`report.js` sends the typed or spoken text to the proxy, with context:

- the last-seen point;
- up to 60 nearby named places as `{ name, lat, lng }`: streets, creeks, parks, lakes, nearest first;
- optional: up to 30 **street corners** (`Intersection` below), where those streets cross on the downloaded map (`quickread.js` `findIntersections`).

The proxy asks Jev five multiple-choice questions (`proxy/jev.js`), runs the answers through the safety layer (`safeJevDraft`), and returns **only** this JSON (**version 2**; `report.js` `DRAFT_SCHEMA`):

```js
ReportDraft = {
  kind: 'sighting' | 'searched' | 'message',
  placeText: 'Lake Elizabeth',   // only ever one of the place or corner names the phone sent, or ''
  lat, lng,                      // that place's own point, or null: the user taps the map
  direction: 'E' | null,
  minutesSince: 10 | null,       // a sighting: minutes since seen; a 'searched' report: minutes spent searching
  reliability: 0.3 | 0.6 | 0.9,  // from wording: "maybe" / "I think" / "definitely"
  note: 'blue coat',             // only ever the person's own words
  unsure: ['direction'],         // optional, version 2: fields the reader wasn't sure about
  flags: ['water']               // optional, version 2: safety warnings, most urgent first
}

Intersection = {                 // a street corner
  name: 'Paseo Padre Parkway & Stevenson Boulevard',   // the two streets, alphabetical, joined by ' & '
  streets: ['Paseo Padre Parkway', 'Stevenson Boulevard'],
  lat, lng                       // the middle of the crossing's map nodes (a divided road has up to 4)
}
```

- **`unsure`** ⊆ `kind, place, direction, minutesSince, reliability`.
  - A `place`, `direction` or `minutesSince` in it is always empty.
  - A `kind` or `reliability` in it holds a default the person must check.
- **`flags`** ⊆ `emergency, water, vehicle, conflict, guess, other_person, joke`, in that order. They are codes; the screen turns them into words (`i18n.js`).
  - A flag only adds a warning. It never changes the map.
  - **`water` never stops a sighting:** "I saw him by the lake" is a sighting pinned at the lake, with the water warning.
  - What does stop a sighting: `joke`, `other_person`, and, when the report has no "saw" words, `guess`, `vehicle`, or "I can't find him". Those come back as `message`.
- Both lists are left out when empty, so a version-1 draft is a valid version-2 draft.
- **Street corners:** a report that names two streets joined by "and / y / et / 和 / と", or with a corner word ("corner", "esquina", "coin", "路口", "交差点"), is pinned at their `Intersection`. If the streets don't cross, cross in two places, or no corner list was sent, the place stays empty (two places = `conflict`).
- `report.js` `confineDraft` holds every proxy answer to these rules: the note is reset to the person's words, and a name the phone didn't send is dropped.

If the proxy can't answer (no signal, no key, an error), the screen makes the same `ReportDraft` on the phone with simple word rules (`quickread.js` `readLocally(text, { places, intersections, lang })`) and says so. The screen shows the draft as a filled-in form. Only after the person taps **Confirm** does it become a normal `Event`. The engine never sees raw text, and never sees anything unconfirmed.

**What the search leader says** (same proxy; `docs/REPLIES.md`, `replies.js`, `proxy/say.js`):

- `POST /say { intent, data, lang } → { text, source: 'llm' | 'template', warnings: [..] }`, where intent ∈ `ask, confirm, abstain, readRoute, comfort, found, emergency`. Only those three fields are accepted.
- A text LLM words the reply, held to `data` by `checkReply` on the proxy and again on the phone. Any failure, no key, or no signal gives the fixed template. `emergency` and `found` are always the template.
- Replies are shown or spoken only: they never become events.

**Optional voice bot** (same proxy, only if its keys are set; see `proxy/voice.js`):
- `GET /voice` → `{ listen: bool, speak: bool }`. Both false → the app uses the phone's own speech recognition and doesn't speak (the behavior before the voice bot).
- `POST /listen?lang=xx` with a recording (`audio/webm` or `audio/mp4`) → `{ text }` (Deepgram nova-3). The text then goes through `POST /` like typed text.
- `POST /speak` `{ text, lang: 'en' }` → MP3 (ElevenLabs Flash v2.5). **English only**: other languages → `400 unsupported_language`, and the app never asks outside English. The app reads back what it filled in and what it wasn't sure about. Speech never changes the form; the person still checks it and taps the button.

## 6. Firebase shape and integrity rules (screen-only, here for reference)

*Updated 2026-11-22 (branch `integrity`), approved by Nathan.* The rules live in three places that must agree: `firebase-rules.json` (what Firebase accepts), `sync.js` `checkEvent` / `checkCase` / `checkSearcher` (what every phone accepts), and `tools/mock-firebase.py` (the local test database). `tests/sync.test.js` checks all three, and the Firebase emulator, against one table of good and bad events.

```
searches/<random 128-bit id, 32 hex>/
  case:      CaseInput + { createdAt, engineVersion, minutesAt?, area?, startedBy?, startedAt?, travel?, description? }
  events/<push id, 20 chars>: Event
  searchers/<16-hex id>: { lat, lng, at, name? }   where each searcher is now
```

- **The case is written once**, whole, and is never changed or deleted. Required: `lastSeen {lat, lng}`, `minutes` (1–1440), `mobility`, `seed` (whole number 0–4294967295), `createdAt`, `engineVersion`. Optional:
  - `direction`
  - `familiarPlaces`: 0–3 of `{lat, lng, label ≤ 100}`
  - `minutesAt`, `startedAt` (ms)
  - `area` (`demo` | `live`)
  - `startedBy` (≤ 40)
  - `travel` (`walking` | `car` | `bus` | `unknown`)
  - `description` (≤ 300)

  Nothing else is allowed.
- **`engineVersion`** names the engine that drew the first map. A phone whose engine differs gets `info.versionMismatch` from `sync.subscribe` / `sync.loadSearch` and should warn: the same events may give it a different map.
- **Events are append-only.** An event is written once, at a 20-character push id, and never edited or deleted. `sync.js` makes the push id itself and writes with `PUT`, so a retried send lands on the same id and can't be stored twice (`POST` of a valid event is also accepted).
- **Every event has `type` and `at`** (ms; ≥ 2020-09; the database refuses more than 1 hour after its own clock). It may have `cid` (the sending phone's id, ≤ 64 of `[0-9A-Za-z_.:-]`) and `by` (≤ 40). Other fields by type; nothing else is allowed:

| type | required | optional |
|---|---|---|
| `searched` | `sectorId` (`r<n>c<n>`), `minutes` (1–600) | |
| `sighting` | `lat`, `lng`, `minutesSince` (0–1440), `reliability` (0.3, 0.6 or 0.9) | `direction`, `note` (≤ 300) |
| `message` | `text` (1–300) | |
| `assigned` | `taskId` or `sectorId`; `searcherId`, `toId` or `to` | `partnerId`, `expiresAt` (after `at`, ≤ 24 h), `searchMin` (0–600), `track` |
| `released` | `searcherId`, `taskId` | `track`, `fraction` (0–1) |
| `completed` | `searcherId`, `taskId`, `minutes` (1–600) | `track`, `partnerId` |
| `caseUpdate` | `field` | `value` |
| `found` | `lat`, `lng` | `note` (≤ 300) |

- Field formats:
  - Ids: `searcherId`, `partnerId` and `toId` are 16 hex characters; `taskId` is ≤ 64 of `[0-9A-Za-z:_-]`.
  - `track` is a list of 1–2000 whole square numbers (0–999999).
  - Text lengths are counted as JavaScript counts them (an emoji is 2).
- **`caseUpdate`** changes one case field after the search was shared. `field` is one of `minutes`, `minutesAt`, `direction`, `mobility`, `familiarPlaces`, `travel`, `description`.
  - `value` is checked exactly like that case field.
  - Leaving `value` out clears the field. Only `direction` (→ unknown), `familiarPlaces` (→ none) and `description` can be cleared. Firebase can't store null or an empty list, so a cleared value is simply absent.
  - For each field, the update with the latest `at` wins. With the same `at`, the larger push id wins, by Unicode code point (`sync.compareIds`). Any update beats the value the case was created with.
  - `sync` hands the screen the case with every update applied (`caseDoc`) and the case as written (`baseCase`). The engine keeps reading only `CaseInput`.
  - Changing `minutes` usually goes with a `minutesAt` update at the same `at`, so every phone counts from the same moment.
- **`found`**: the person was found at `{lat, lng}`. The engine ignores it; the screen should end the search.
- **What phones do with what they receive:**
  - Every event is re-checked with the same rules (without the clock, so every phone gives the same answer). Bad ones are dropped and counted (`info.dropped`).
  - Exact copies (same content under another id) are counted once (`info.duplicates`).
  - Events are sorted by `at`, then id.
  - A broken case gives `caseDoc: null` and `info.caseProblem`.
- **`searchers`** is the one place that is overwritten: each phone overwrites or removes its own position (every 30 s, or after moving 25 m). The shape is checked: `lat`, `lng`, `at`, optional `name` ≤ 40. It's only drawn as dots on the map; the engine never sees it.
- Reads are allowed only inside one search; nothing outside `searches/<id>/case|events|searchers` can be written.

Every phone downloads `case` + `events` and calls `replay`.

## Known limits of this contract

- Time: the shared `case` also carries `minutesAt` (ms), the moment its `minutes` value was true. Every 5 minutes after that, the screen adds 5 to `minutes` and calls `replay` again (no new event type). All phones count from the same `minutesAt`, so their maps match. Since Nov 22 the screen also passes `minutesAt` to the engine, which uses it to place events in time.
- Two phones on one search agree on the grid always, and on the map wherever both hold the same map data. While one phone is still waiting for phase 2 of its download (buildings), its map is rougher than the other's until it arrives.
- The sea is not handled: on a coast the water beyond the shoreline has no OSM polygon, so the engine sees it as plain ground.
- There are no accounts: anyone with a search link can read and add events.
- The rules stop malformed, oversized, edited, deleted and duplicated data, not lies: a well-formed but false event (a made-up sighting) is accepted like a true one.
