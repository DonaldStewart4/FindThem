# Search planner: merge plan

How to bring branch `planner` into the app. Written Nov 22 by the planner session for Nathan and BenStew. Line numbers were read from `app.js` at `prior-v2` stage 3 (`4b2392a`); stage 4 may have moved them by a few lines, so search for the function names given.

## Where things stand

- `planner` = `prior-v2` at `172a409` + the planner's own commits. The planner's files are all new; nothing of the prior session's was edited.
- The app still runs the old flow (`nextSectors` → `routeFor` → `searched`). The planner is built and tested but not wired to the screen.
- `node --test` passes on `planner`.

## Step 1. Merge the branches (5 minutes)

`planner` already contains `prior-v2` up to `172a409` (stage 4 and the real-world check), merged and tested on Nov 22 at 9:30 am: 140 tests pass, and the benchmark report was re-run on that engine. So:

```bash
git checkout prior-v2
git merge planner
```

- If `prior-v2` has no commits after `172a409`, this is a fast-forward with no conflicts.
- If it has, expect a conflict in `CommitHistory.md` only (both sides add entries at the top of the Log). Keep both sets of entries.
- Then `node --test`. The planner tests do not depend on particular map values. The benchmark numbers do: if the engine's map changed again, re-run `npm run planner-eval` (about 3 minutes) and commit the new `bench/planner-report.md`.

Files the merge adds: `engine/planner/` (10 files), `tests/planner.test.js`, `tests/planner-bench.test.js`, `tests/helpers/planner-worker-node.js`, `bench/planner-eval.js`, `bench/planner-report.md`, `bench/planner-results.json`, `docs/PLANNER.md`, `docs/PLANNER-MERGE.md`, `UPDATESBYNATE.md`, and one script line in `package.json`.

## Step 2. `engine/index.js` (one line)

Add, and leave everything else:

```js
//   planSearch(area, caseInput, prediction, { searchers, events, nowMs })  → planner/  who searches where
export { planSearch, assignedEvent, trackFromLatLngs } from './planner/index.js';
```

Keep `nextSectors` and `routeFor` exported until step 6 is done: the hand-off sheet and old shared searches still use `searched` events.

## Step 3. The worker: fold the planner into `engine/host.js` and `engine/worker.js`

The planner must run in the same worker as the engine, because it needs the prediction the worker already holds. (`engine/planner/host.js` and `engine/planner/worker.js` do both jobs in one worker and are what the tests run; after this step they can be deleted.)

`engine/host.js`: remember the last full prediction, and add `plan`:

```js
import { planSearch } from './planner/index.js';
// inside createHost():
let lastPrediction = null;            // the full prediction of the last run(), for the planner
// in run(), after `const prediction = replay(area, caseInput, events);`
lastPrediction = prediction;
// new method:
plan(key, caseInput, events, searchers, nowMs) {
  if (key !== areaKey || !area || !lastPrediction) throw new Error('plan: run the engine first');
  return planSearch(area, caseInput, lastPrediction, { searchers, events, nowMs });
},
```

`engine/worker.js`: one more message type:

```js
} else if (m.type === 'plan') {
  self.postMessage({ id: m.id, ok: true, plan: host.plan(m.key, m.caseInput, m.events, m.searchers, m.nowMs) });
```

- The planner's world is built once per case and kept (it is cached on the engine's own ground map, so `addLayers`, which makes a new area object, rebuilds it once, as it must).
- The plan is plain data and is copied to the page by `postMessage`. No transfer list is needed.
- Fallback when the worker is broken (`workerBroken`): call `engine.planSearch(...)` on the page, as `runEngine` does for `replay`.
- Then change `tests/helpers/planner-worker-node.js` to import `../../engine/worker.js` and send `area`, `replay`, `plan`.

## Step 4. Firebase rules (`firebase-rules.json`, then publish in the console)

The events rule only allows four types. Change the pattern to:

```
/^(searched|sighting|assigned|released|completed|found|message)$/
```

- `assigned` and `completed` events carry `track`, a list of up to a few hundred whole numbers (10 m squares). Firebase stores it as an array. No rule change is needed for it, but the 300-character checks on `text` and `note` stay.
- `searchers/<id>` gains an optional `mode: 'foot' | 'car'`. The existing rule allows extra children.
- BenStew publishes the rules; until then new event types are rejected by the database.

## Step 5. `INTERFACES.md` (needs BenStew's OK)

Add a section "Search planner" with:

```js
// New events (the engine ignores them until step 8; the planner reads them)
{ id, type: 'assigned',  searcherId, taskId, at, expiresAt, track, searchMin, canvass?, partnerId? }
{ id, type: 'released',  searcherId, taskId, at, track? }
{ id, type: 'completed', searcherId, taskId, at, track?, partnerId? }
{ id, type: 'found',     lat, lng, by, at, note }

planSearch(area, caseInput, prediction, { searchers, events, nowMs }) → Plan
//   searchers: [ { id, lat, lng, mode: 'foot' | 'car', at } ]   at = ms of their last position
Plan = {
  over,                 // true once a 'found' event exists
  found,                // { lat, lng, by, at, note } or null
  night,
  searchers: [ { searcherId, mode, keep, switchSuggested, primary: Option | null, options: [ Option ], hold, released } ],
  unfilled: [ { taskId, type, reason: 'needs_partner' | 'no_public_view', hazardScore } ],
  measures: { cumulativePOS, remaining, restOfWorld, rowTrend: { perHour, history }, bestRatePerMin,
              expand: { signal, reasons: [ 'rest_of_world_high' | 'map_exhausted' | 'hazard_unchecked' ] } },
}
```

`Option` is in `docs/PLANNER.md` section 5. Every word the user reads comes from `i18n.js`; the planner only gives codes.

## Step 6. The screen (`app.js`, `i18n.js`, `sw.js`). Log each in `UPDATESBYNATE.md`

1. **Mode.** `state.myMode = 'foot'`, with a foot / car switch next to the name. Send it with the position: `sync.setSearcherPosition(..., { ...state.myPos, name: state.myName, mode: state.myMode })` (line 1679).
2. **Ask for a plan.** After every `recompute()` result, and when any searcher's position changes (at most once every 5 seconds):
   ```js
   const searchers = Object.entries(state.searchers).map(([id, p]) => ({ id, lat: p.lat, lng: p.lng, at: p.at, mode: p.mode || 'foot' }));
   // me, even when the search is not shared yet:
   if (state.myPos) searchers.push({ id: state.searcherId, ...state.myPos, at: Date.now(), mode: state.myMode });
   state.plan = (await askWorker({ type: 'plan', key: cache.key, caseInput, events: currentEvents(), searchers, nowMs: Date.now() })).plan;
   ```
   `engineEventsKey()` (line 852) stays as it is: the engine's map still depends only on `searched` and `sighting`. The plan depends on every event, so re-plan whenever `currentEvents()` changes.
3. **Replace `renderAreas()` (line 1118).** Show my entry, `state.plan.searchers.find((s) => s.searcherId === state.searcherId)`:
   - up to three cards from `options`, the first being `primary`: task type and kind (i18n), `posGain` as a percentage, `travelMin` + `searchMin`, the danger badge (`danger.level` and each warning code), "ask permission" when `permission === 'ask'`, "go with <partner>" when `partnerId`, "urgent" when `urgent`;
   - on the map: `route.points` as a line (the part before `route.searchFrom` dashed: that is the walk there), `route.area.bounds` as a rectangle for block, park and hazard tasks, a pin for a containment post;
   - `hold` when there is no `primary` (`nothing_useful`, `no_street_nearby`, `found`).
4. **Accept.** A "Take this task" button: `recordEvent(engine.assignedEvent(option, state.searcherId, Date.now()))`. For a pair, each partner accepts on their own phone; each sees the same task as `primary` with the other's id.
5. **While holding a task** (`keep === true`): a "Done" button → `recordEvent({ type: 'completed', searcherId: state.searcherId, taskId, track })`, and a "Stop" button → `recordEvent({ type: 'released', searcherId: state.searcherId, taskId, track })`. `recordEvent` already adds `by` and `at`.
6. **GPS trail (Nathan's decision, Nov 22).**
   - Record **only while this phone holds a task**: start when its `assigned` event is sent, stop at "Done", "Stop", expiry or `plan.over`.
   - **One point every 10 seconds**, taken from the position the existing `watchPosition` callback (line 1631) already keeps in `state.myPos`. No second GPS watch.
   - Skip a point whose `accuracy` is worse than 50 m. Keep at most 400 points (about 66 minutes) in memory, in `state.trail = [ { lat, lng } ]`. Nothing is written to storage and nothing is sent while walking.
   - On "Done" or "Stop": `track = engine.trackFromLatLngs(area, caseInput, state.trail)` and **attach it to the `completed` (or `released`) event**. With fewer than 5 points send no `track`: the planner then credits the planned route for "Done" and nothing for "Stop".
   - The trail leaves the phone only as that list of 10 m squares inside the event. Clear `state.trail` afterwards. Say so in the privacy text.
7. **Found.** A "Found" button, always visible during a search: tap the map or use my position, optional note → `recordEvent({ type: 'found', lat, lng, note })`. When `state.plan.over`: show a pin at `plan.found` with who and when, hide the task cards, stop the trail, stop asking for plans. The planner already hands out nothing once it sees the event.
8. **Team view** (for whoever runs the search): each searcher's `primary` on the map; `plan.unfilled` as a list ("creek stretch needs two people", "no public view: tell the police"); `measures.cumulativePOS`, `measures.restOfWorld`, and a banner when `measures.expand.signal` with its reasons.
9. **Hand-off sheet** (line 2063): add completed tasks (type, who, when), cumulative POS, rest of world, the expand reasons and the unfilled hazards.
10. **Old flow.** Once 3–5 work, hide the "next areas" list. Do not offer both: a `searched` area and a `completed` task for the same ground would count that ground twice. `searched` events from older links are still honored by the engine.
11. **`i18n.js`, five languages.** One key per code:
    - task types `hasty`, `yards`, `park`, `hazard_check`, `containment`, `drive`; kinds `bridge`, `transit`, `intersection`, `creek`, `water`, and the eight compass names;
    - warnings `night`, `along_high_traffic`, `high_traffic_crossing`, `rail_crossing`, `water_nearby`, `do_not_enter_water`, `stay_on_path`;
    - reasons `probability_in_reach`, `chance_to_spot`, `teammates_cover`, `doors`, `still_walking`, `hazard_first`, `kept`, `night`;
    - holds `found`, `nothing_useful`, `no_street_nearby`; unfilled `needs_partner`, `no_public_view`; expand `rest_of_world_high`, `map_exhausted`, `hazard_unchecked`;
    - buttons and labels: take this task, done, stop, found, on foot, by car, ask permission, go in pairs, walk there, search.
    - Never call any of this a chatbot, and never show a reason as a sentence built in code.
12. **`sw.js`.** Add `engine/planner/*.js` to the cached files and bump the cache version.

## Step 7. Docs to update when the screen switches

`PLAN.md` (Status), `ShortPlan.md` ("routes for searchers" becomes tasks with routes; tick it when it works), `README.md` (what the planner is, the benchmark, how AI was used), `NATHAN.md` (phone test of a re-plan: under 300 ms; first plan of a case: a few seconds), `CLAUDE.md` ("Read first": add `docs/PLANNER.md`).

## Step 8. Later, in `grid.js` (prior session): let the map itself show planner coverage

Today the planner applies completed tasks on top of the engine's map itself. The picture on the screen (the red, orange and yellow areas) therefore does not fade where planner tasks were done. To fix that properly:

- give `replay` the coverage of each `completed` event as `{ at, cells, det }` (from `engine/planner`: the same function the planner uses), and for each walker multiply its weight by `1 − det[square the walker was on at that minute]`; do the same for the statistics part of the map;
- then call `planSearch(..., { engineReadsCompleted: true })` so the planner does not apply those events a second time. That switch is already in `engine/planner/adapter.js`.

Until then nothing is double counted: the engine ignores `completed`, the planner ignores `searched` (it sees their effect through the engine's map).

## What the adapter does today that changes when the prior gives a 10 m map

All in `engine/planner/adapter.js`, marked `MERGE`:

- **25 m → 10 m.** Each 25 m square's probability is shared among its 10 m squares by ISRID find-location shares. A 640 × 640 map (`grid.p.length === 409600`) is passed through untouched. A test feeds one.
- **Hazard layer.** `grid.hazard` on 25 m squares is read per 10 m square; a 640 × 640 hazard layer is passed through; with none, the adapter works out the same statistic.
- **Buildings.** The rule "probability inside a building is credited only by the ask-permission task" lives in the detection code, not the adapter, so it holds for any map. A test checks it on a 10 m map.

## Not in this merge

- Recording trails, the task cards and the found button are specified above but not built: the screen is BenStew's.
- Searchers in cars and night searches are tested for safety rules but are not in the benchmark.
- No phone has run the planner. Laptop times and their 4× figures are in `docs/PLANNER.md` section 9.
