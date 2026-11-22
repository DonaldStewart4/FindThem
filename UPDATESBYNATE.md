# Updates by Nate: one list for Ben

Everything Nathan's four branches (`prior-v2`, `planner`, `integrity`, `agent-contract`) changed in your files, and what is left for you. They were merged into `main` on Nov 22 at release. Older detail: `BEN.md` (the engine rewrite's screen changes), `docs/PLANNER-MERGE.md`, `docs/AGENT-CONTRACT.md` ("Screen work"), `docs/REPLIES.md`, `docs/INTEGRITY-REPORT.md`.

## What you must do (in this order)

1. **Publish `firebase-rules.json`** in the Firebase console (Realtime Database → Rules → paste → Publish).
   - Why: the live database still has Saturday's rules. It refuses the new events (`assigned`, `released`, `completed`, `found`, `caseUpdate`), so taking a route, Found and corrections stay on one phone until you publish.
   - Publish the rules and the new site together. An old cached phone can still join and add events, but can't start a new search.
2. **Redeploy the proxy:** `cd proxy && npx wrangler deploy`.
   - Why: the report box's safety layer (`proxy/jev.js`), the pinned Jev model (`jev-1.14.0`) and the new `/say` route (`proxy/say.js`) are only in the repo so far.
   - Optional: `npx wrangler secret put LLM_API_KEY`. Without it `/say` returns the fixed lines, which is fine and is how the app runs today.
3. **Read `INTERFACES.md`**, everything marked "new" (prior v2, the planner's events, §5 `ReportDraft` v2, §6 events and rules). Nathan approved these alone; the file says you haven't reviewed them yet.
4. **Try it on two real phones.** Nothing merged on Sunday has run on a phone: the Demo's speed, a new area, taking a route, Found, the report box by voice.
5. **Get a native speaker to check the new `i18n.js` keys** (all AI-written): the four after `usingSaved`, the planner's task / warning / button keys, the `flag_*` keys, `unsureMark`, `reportCheckKind`, the Found and version-warning texts.

## What changed in your files

| File | What changed | Why |
|---|---|---|
| `app.js` | `readCase()` sends `minutesAt`. The engine runs in a background worker (`startWorker`, `askWorker`, `runEngine`); `recompute()` is now `async`. Two-phase load (`refineArea`). Hazard lines on spots and areas. Home area saved bigger. | The new engine. **If you read `state.prediction` right after `recompute()`, `await` it first.** Full table in `BEN.md`. |
| `data.js` | The download is a square (3.4 km each way) in two requests: streets first, then buildings and land use (`loadArea` returns `more`). Saved areas are reused only if they cover the whole map. | The engine's map is a square; the second request is big. |
| `sync.js` | Every case, event and position is checked against the same rules as the database before it is sent and after it is received. New events `caseUpdate` and `found`. `subscribe`'s callback gets a 4th argument `info` (`versionMismatch`, `dropped`, `duplicates`). `loadSearch` returns `{ caseDoc, events, info }`. `addEvent` / `createSearch` can return `{ ok: false, error: 'invalid', reason }`. Events are sent with PUT at an id the phone makes. | No event can corrupt the shared map; a retried send can't make a copy. |
| `firebase-rules.json` | Only known event shapes, no edits or deletes, the case written once, `engineVersion` on the case. | Same. **Needs publishing (above).** |
| `report.js`, `quickread.js` | Drafts are `ReportDraft` v2: optional `unsure` and `flags` codes. Street corners are pinned where the streets cross (`findIntersections`). The backup reader is more cautious. | The report box treats the AI as unreliable. |
| `replies.js` (new) | Fixed lines in 5 languages for what the app says back, and `checkReply` for any AI-worded version. | `docs/REPLIES.md`. |
| `proxy/` | `jev.js` cross-checks Jev's answers against the report's words; `say.js` and the `/say` route; `wrangler.toml` has `LLM_PROVIDER` / `LLM_MODEL`. | **Needs redeploying (above).** |
| `engine/index.js` | Exports the new prior and the planner (`planSearch`, `assignedEvent`, `trackFromLatLngs`). `nextSectors` and `routeFor` are still exported. | Old shared searches still use `searched` events. |
| `i18n.js` | New keys in all five languages (see step 5 above). | The engine and planner return codes only, never text. |
| `sw.js` | Cache version bumped; `SHELL_FILES` gained the new engine files, `engine/planner/*.js` and `replies.js`. **If you bump it again, keep these.** | Offline. |
| `index.html`, `style.css` | See "Wired at release" below. | |
| `tests/fixtures/demo-area.json` | The Demo's area is a square with buildings and Lake Elizabeth, 3.0 → 6.9 MB. | The new engine's ground map. |

## Wired at release (Nov 22, Nathan's release session, with Claude Code)

All of this is in your files. It was checked in headless Chrome (`tools/browser/release-check.mjs`, `twotab.mjs`, `newarea.mjs`) and by `node --test`, not on a phone.

| File | What changed |
|---|---|
| `app.js` | **"Next areas" is gone; "Your next task" replaces it.** `renderAreas()` and `markSearched()` were replaced by `renderTasks()`: up to 3 ranked routes from the planner, each with its chance, times and warnings. New: `requestPlan`, `schedulePlan`, `planSearchers`, `takeTask`, `finishTask`, `drawTaskRoute`, `taskTitle`. |
| `app.js` | **Buttons send events:** "Take this task" → `assigned`; "Done, nobody found" → `completed`; "Stop this task" → `released`. With no usable GPS (off, or more than 3 km from the last-seen point) routes start at the last-seen point and a note says so. |
| `app.js` | **Found:** `onFoundButton`, `reportFound`, `renderFound`. One button, a confirm question, then a `found` event at my position (or a map tap: new tap mode `found`). Every phone shows a green banner and a pin, hides the tasks and stops sharing its position. |
| `app.js` | **Corrections:** `sendCaseCorrections` (in `runPrediction`) sends a `caseUpdate` per changed field when the search is shared (minutes also sends `minutesAt`); `applySharedCase` (in the `startLive` callback) fills the form from the database's case when another phone corrected it. `state.sharedCase` / `state.caseSnapshot` track what is in step. |
| `app.js` | **Report box:** `readReport` sends street corners and the language; `showFlags` shows `draft.flags` (never auto-hidden); `markUnsure` / `clearUnsure` highlight `draft.unsure` fields. **Unknown time:** the minutes box stays empty and `saveSighting` asks for it instead of saving 0. Sighting minutes are clamped to 0–1440. |
| `app.js` | **Search leader line** (`leaderSays`): fixed sentences from `replies.js` only (`proxyUrl: ''`, so `/say` is never called). Used after a report (unsure / call now), after "Done", and in the Found banner. |
| `app.js` | **Taps on markers count** while placing a sighting or "found" (`map.on('layeradd', ...)` near the map click handler): a tap on a numbered spot used to do nothing. |
| `app.js` | **Version warning** from `info.versionMismatch`; `sync.setEngineVersion(engine.ENGINE_VERSION)` at start. |
| `app.js` | `recordEvent` returns `false` and logs when `sync.checkEvent` refuses an event, takes an optional `at`, only re-runs the engine for `searched` / `sighting`, and shows `eventRefused` if the database says no. `drawSightings` now also draws sightings in a shared search (it read `state.events` only). The hand-off sheet lists finished tasks and "found". |
| `index.html` | `#found-banner`, `#version-warning`, `#leader` (+ `#leader-line`, `#leader-warnings`), `#report-flags`, `#sighting-flags`, `#message-flags`, `#task-note`, `#unfilled`, `#plan-measures`, `#found-button`. The "Next areas" heading now uses `tasksTitle` / `tasksHint`. |
| `style.css` | One new block at the end: `.task-*`, `.found-banner`, `.map-found-person`, `.flags` / `.flag`, `.unsure`, `.leader`. Nothing above it was edited. |
| `i18n.js` | 64 new keys × 5 languages at the end of each language (one commented block), plus new text for `reportSearched` and `saySearched`. New export `hasKey`. All AI-written, unreviewed. |
| `sw.js` | `v34`; `SHELL_FILES` gained `replies.js` and eight `engine/planner/*.js` files. |
| `sync.js`, `firebase-rules.json`, `tools/mock-firebase.py` | One new optional field on `assigned`: `canvass` (true / false: knock on doors, or only walk past). All three places and the test table agree. |
| `engine/index.js`, `host.js`, `worker.js` | Export `planSearch`, `assignedEvent`, `trackFromLatLngs`, `woodsSpots`, `ENGINE_VERSION` (`2026-11-22.2`). The worker answers a new `plan` message from the map of its last replay. |
| `engine/grid.js`, `engine/planner/` | Woods and brush near the likely area are a second hazard class ("check from the path"): `grid.woods`, `sector.woods`, `spot.woodsNearby`, `woodsSpots()`; park tasks through woods carry the `stay_on_path` warning. The Demo area has no woods near the likely area, so it shows none. |

## Still not built

- **GPS trail while holding a task** (a point every 10 s, attached to the `completed` event). Specified in `docs/PLANNER-MERGE.md` step 6.6; until then a finished task is credited from its planned route.
- ~~The map does not fade where planner tasks were done.~~ **Done in the audit fixes (Nov 22):** `engine/grid.js` `completedSearches` turns each finished task into `searched` events for the 200 m sectors along its route, inside `replay`, so the map fades on every phone. The planner is handed the map without them (`replay(..., { completed: false })` in `engine/host.js`), so nothing is counted twice. Finer than sector level is still `docs/PLANNER-MERGE.md` step 8.
- **Foot / car switch.** Everyone is planned as on foot. (It also needs `mode` allowed on `searchers/<id>` in the rules, `sync.js` and the mock.)
- **Team view on the map** (everyone's route at once). Only my own routes are drawn; the list under them shows danger spots nobody can cover and how much of the chance is covered.
- **The spoken intake** in `docs/INTAKE-SPEC.md` (`caseGaps`, `validateCase`, `proposeClue`, `myAssignment`, `explain` in `docs/AGENT-CONTRACT.md`), and the leader line for reading a route aloud.
- **`replies.js` holds its own text.** CLAUDE.md says all UI text lives in `i18n.js`; moving it is `docs/REPLIES.md` hook-up step 4.
- **`searched.minutes` clamping** is moot (the screen no longer sends `searched`), and **`currentEvents` still de-duplicates by `cid` alone**, which two phones can share by chance.
- **The last-seen point can't be corrected in a shared search** (`caseUpdate` has no `lastSeen` field): moving it starts a new search, as before.

## Worth knowing

- `package.json` scripts: `planner-eval`, `safety-eval`, `eval`.
- `CommitHistory.md` "Project context": GPS-trail coverage is in scope now, and replies may be AI-worded but checked (Nathan's decisions, Nov 22).
- Engine version: `engine/index.js` exports `ENGINE_VERSION` and `app.js` hands it to `sync.js`. Bump it whenever the engine gives a different map or plan for the same inputs, or phones on different versions won't be warned.
