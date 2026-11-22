# INTERFACES: how the screen and the engine talk

This is the contract between the two halves of FindThem:

- **Screen** (`app.js`, `data.js`, `sync.js`, `report.js`, …): BenStew, with AI help.
- **Engine** (`engine/`): BenStew, built with Claude Code.
- **Tests and speed** (`tests/`, `bench/`): Nathan, with AI help allowed.

If every side follows this file, the halves plug together at integration. **Change it only when BenStew and Nathan agree**, and log the change in `CommitHistory.md`. *Status: implemented. `engine/` and the screen both follow it, and the tests check it. Not yet reviewed by Nathan.* ("Jev" is not a teammate; it's the AI model in the report box.)

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

- **Coordinates:** inside the engine, work in local meters: `x` east and `y` north of `area.origin`, using an equirectangular projection. The screen only ever sees `{ lat, lng }`.

## 1. Data the screen gives the engine

`data.js` exports `loadArea(lat, lng, { radiusM = 3200 }) → Promise<{ osm, fromCache, savedAt }>`. That's screen-internal; the engine only cares about the shape of `osm`:

```js
OsmData = {
  center: { lat, lng },          // where the Overpass query was centered
  radiusM: 3200,
  nodes: [ { id, lat, lng } ],   // every node used by a way below
  ways: [ {
    id,                          // OSM way id (number)
    highway: 'residential',      // footway|path|pedestrian|residential|living_street|service|
                                 // tertiary|secondary|primary|unclassified|track|steps|cycleway
    name: 'Main St' | null,
    nodeIds: [ id, id, ... ]     // in order along the way
  } ],
  features: [ {                  // "trap" features where people are often found
    id,                          // OSM id, prefixed: 'w123' (way) or 'r456' (relation)
    type: 'creek' | 'river' | 'water' | 'wetland' | 'woods' | 'brush' | 'grass' | 'park',
    name: 'Shoal Creek' | null,
    shape: 'line' | 'area',      // line = creek centerline, area = closed polygon
    points: [ { lat, lng } ]     // area polygons are closed (first point == last point)
  } ]
}
```

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
  minutes: 45,                   // minutes since last seen, fixed when the search is created
  direction: 'NE' | null,        // N NE E SE S SW W NW, or null = unknown
  mobility: 'normal' | 'slow' | 'walker',
  familiarPlaces: [ { lat, lng, label } ],   // 0 to 3
  seed: 123456789                // uint32, chosen once when the search is created
}
```

```js
Event =
  | { id, type: 'searched', sectorId: 'r12c7', minutes: 20, by: 'Ana', at }  // searcher-minutes spent, no one found
  | { id, type: 'sighting', lat, lng, direction: 'E' | null,
      minutesSince: 10,          // minutes from the sighting to when it was reported (fixed)
      reliability: 0.3 | 0.6 | 0.9,   // "maybe" / "probably" / "sure"
      note: 'blue coat', at }
  | { id, type: 'assigned', sectorId, to: 'Ana', at }  // the engine ignores this one
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
  traps: <anything>              // engine-internal: features + a fast "within 30 m" lookup
}
```

The screen reads `graph.nodes[i].lat/lng`, `graph.edges[j].a/b/wayId/name` to draw streets. Everything else in `Area` is the engine's business.

### `replay(area, caseInput, events) → Prediction`
**The main call.** It runs the base simulation, builds the grid, then applies every event in order:
- `searched` → empty-search Bayes update
- `sighting` → simulate from the sighting point (seed `(caseInput.seed + 7919 * k) >>> 0` for the k-th sighting, k from 1), build that grid, then blend `(1 − r) · current + r · sightingGrid`

The screen calls it on every change. It must finish in **under 2 s on a phone** for 5,000 walkers and ~10 events, so cache the base simulation by seed.

```js
Prediction = {
  sim: {
    nWalkers: 5000,
    endpoints: [ { lat, lng, x, y, edgeIndex, trapType: 'creek' | null, trapId: 'w123' | null } ],  // x, y = meters from area.origin
    edgeCounts: [ 0, 12, 3, ... ]   // length = area.graph.edges.length; walkers that used each edge
  },
  grid: {
    cellSize: 25,                   // meters
    cols, rows,
    p: Float64Array,                // length cols*rows, sums to 1, row-major (index = row*cols + col)
    sectors: [ {
      id: 'r12c7',                  // sector row/col; 8×8 cells = 200 m squares
      bounds: [[south, west], [north, east]],
      center: { lat, lng },
      probability: 0.043,           // sum of p inside
      searchedMinutes: 20,          // total from 'searched' events
      pod: 0.55                     // combined probability of detection so far, 0..1
    } ]
  }
}
```

### `cellToLatLng(area, grid, cellIndex) → { lat, lng }`
The cell's center. The screen uses it to place its red/orange/yellow likely-area picture over `grid.p`.

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
  walkerShare: 0.12,             // share of base walkers that ended here
  trapType: 'creek' | null,      // nearest trap feature inside the cluster, if any
  trapName: 'Shoal Creek' | null,
  streetName: 'Main St' | null,  // nearest named street
  distanceToStreetM: 40,
  hazard: true                   // trapType is in HAZARD_TYPES
}
```

The screen turns a `Spot` into translated text ("Creek 130 ft off Main St – 12% chance they are here", from `probability`, so it follows searches and sightings; `walkerShare` is no longer shown). The engine never builds user-facing strings.

## 3. Tunable constants

These live at the top of each engine file, named and commented with their source. Starting values come from `PLAN.md`:

```
N_WALKERS 5000              ACTIVITY_FACTOR 0.6
SPEED_MPS normal 1.0 / slow 0.7 / walker 0.45
GIVE_UP_MEDIAN_M 850        GIVE_UP_SIGMA ≈0.52 (gives ≈89% within 1609 m)
TURN_SCALE_DEG 30           FAMILIAR_PULL 1.5
TRAP_RADIUS_M 30            TRAP_PROB 0.6
CELL_SIZE_M 25              SECTOR_CELLS 8      GRID_RADIUS_M 3200
SWEEP_WIDTH_M, SEARCH_SPEED_MPS (coverage = speed × minutes × 60 × sweep width ÷ sector area)
PRIOR_FLOOR (small, so no cell is exactly 0)
```

## 4. Tests (`node --test`, Nathan)

- Same `caseInput` + seed → identical `replay` output; a different seed → different output.
- `grid.p` sums to 1 (±1e-9) after the base map, every `searched` event and every `sighting`.
- A `searched` event lowers that sector's probability and raises every other sector's.
- POD = 1 − e^(−coverage): 0 for 0 minutes, approaching 1 as minutes grow.
- `nextSectors` matches brute force on a tiny hand-made grid.
- `routeFor` only uses edges inside its sector, and the edges connect in order.
- On the demo fixture: median straight-line walker distance is in the 600–1,100 m range, and `replay` runs in under 2 s in Node.

## 5. Report box (screen-only, here for reference)

`report.js` sends the typed or spoken text, plus context (the last-seen point and up to 60 nearby named places as `{ name, lat, lng }`: streets, creeks, parks, lakes, nearest first), to the proxy. The proxy asks Jev five multiple-choice questions (`proxy/jev.js`) and returns **only** this JSON:

```js
ReportDraft = {
  kind: 'sighting' | 'searched' | 'message',
  placeText: 'the lake by Paseo Padre',
  lat, lng,                      // or null if the place couldn't be pinned; the user taps the map
  direction: 'E' | null,
  minutesSince: 10 | null,
  reliability: 0.3 | 0.6 | 0.9,  // from wording: "maybe" / "I think" / "definitely"
  note: 'blue coat'
}
```

If the proxy can't answer (no signal, no key, an error), the screen makes the same `ReportDraft` on the phone with simple word rules (`quickread.js`) and says so. The screen shows the draft as a filled-in form. Only after the person taps **Confirm** does it become a normal `Event`. The engine never sees raw text, and never sees anything unconfirmed.

**Optional voice bot** (same proxy, only if its keys are set; see `proxy/voice.js`):
- `GET /voice` → `{ listen: bool, speak: bool }`. Both false → the app uses the phone's own speech recognition and doesn't speak (the behavior before the voice bot).
- `POST /listen?lang=xx` with a recording (`audio/webm` or `audio/mp4`) → `{ text }` (Deepgram nova-3). The text then goes through `POST /` like typed text.
- `POST /speak` `{ text, lang: 'en' }` → MP3 (ElevenLabs Flash v2.5). **English only**: other languages → `400 unsupported_language`, and the app never asks outside English. The app reads back what it filled in and what it wasn't sure about. Speech never changes the form; the person still checks it and taps the button.

## 6. Firebase shape (screen-only, here for reference)

```
searches/<random 128-bit id>/
  case:      CaseInput + { createdAt }
  events/<push id>: Event
  searchers/<16-hex id>: { lat, lng, at, name }   where each searcher is now
```

Every phone downloads `case` + `events` and calls `replay`. Only events are ever added; nothing is edited or deleted. `searchers` is the one exception: each phone overwrites its own position (every 30 s, or after moving 25 m). It's only drawn as dots on the map; the engine never sees it.

## Known limits of this contract

- Time: the shared `case` also carries `minutesAt` (ms), the moment its `minutes` value was true. Every 5 minutes after that, the screen adds 5 to `minutes` and calls `replay` again (no new event type). All phones count from the same `minutesAt`, so their maps match; the engine itself doesn't change.
- There are no accounts: anyone with a search link can read and add events.
