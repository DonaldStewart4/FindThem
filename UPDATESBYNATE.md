# Updates by Nate: what the planner work touches on the screen

A running log, newest first, of anything from Nathan's planner branch (`planner`) that touches the screen (`index.html`, `style.css`, `app.js`, `sync.js`, `i18n.js`, `sw.js`, `firebase-rules.json`) or changes what the screen must do. BenStew owns the screen; this file is so nothing reaches it unannounced.

## 2026-11-22: planner built, screen not touched

**Changed on the screen by the planner branch: nothing.** No planner commit edits a screen file. The app on this branch behaves exactly as `prior-v2` stage 3 does: it still lists "next areas" from `nextSectors` and draws `routeFor` routes.

(The branch does contain `prior-v2` stage 3's own screen changes, because that branch was merged in at `4b2392a`. Those are the prior session's and are logged in `CommitHistory.md` under "Prior v2, stage 3".)

**What the screen will need, when BenStew wires the planner in.** The exact steps, with line numbers, are in `docs/PLANNER-MERGE.md` step 6. In short:

| Screen file | Change needed | Why |
|---|---|---|
| `app.js` | Ask the worker for a plan after each recompute and position change | The planner replaces the "next areas" list |
| `app.js` | Replace `renderAreas()` with up to three task cards and their routes | Options are per searcher, from where they stand |
| `app.js` | "Take this task", "Done", "Stop" buttons that send `assigned` / `completed` / `released` events | Assignments are events, so nobody is sent where someone already is |
| `app.js` | "Found" button that sends a `found` event; pin and banner when the plan says `over` | Nathan's decision, Nov 22 |
| `app.js` | Record a GPS point every 10 s **only while holding a task**; attach the trail to the `completed` event | Nathan's decision, Nov 22: coverage from the trail walked |
| `app.js` | Foot / car switch, sent with the searcher's position | The planner gives drivers drive loops |
| `app.js` | Hand-off sheet: completed tasks, cumulative POS, rest of world, expand signal, unchecked hazards | New measures |
| `i18n.js` | About 50 new keys × 5 languages (task types, warnings, reasons, buttons) | The planner returns codes only, never text |
| `sw.js` | Cache `engine/planner/*.js`; bump the cache version | Offline |
| `firebase-rules.json` | Allow event types `released`, `completed`, `found`; publish in the console | The database rejects them today |
| `sync.js` | None expected (`setSearcherPosition` just gets one more field, `mode`) | |

**Not screen files, but worth knowing:**

- `package.json` gained one script: `npm run planner-eval`.
- `engine/index.js` is unchanged on this branch. The merge adds one export line (merge plan step 2).
- "Project context" in `CommitHistory.md` now says GPS-trail coverage is in scope (it was on the "do not build" list).
