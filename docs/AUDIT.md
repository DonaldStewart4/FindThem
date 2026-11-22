# Release audit (Nov 22, 2026)

A bug hunt over the code being released: branches `prior-v2`, `planner`, `integrity` and `agent-contract`, and the screen files. **Nothing was fixed.** This file is the only thing the audit changed.

- **Checked against:** `main` at `cc356a6` (the merged release, with the planner, Found, corrections and report flags wired to the screen). Line numbers are for that commit.
- **How it was done:** five parallel reviews with Claude Code (engine and map data, planner, sync, report box, screen/offline/translations), each required to reproduce what it reported. Nathan's audit session then re-ran or re-read every finding. The first pass was on the release branch before the screen was wired (`e32a87b`); everything below was checked again on `cc356a6`, and what the wiring fixed is listed at the end.
- **Baseline:** on a fresh copy of `cc356a6`, `node --test` gives 230 pass, 0 fail, 1 skipped. So every bug here is one the tests miss.

**How each finding was checked** (last line of each entry):

- **Ran:** a script that shows the bug was run against the code by the audit session.
- **Read:** the audit session read the lines that cause it.
- **Browser:** a reviewer saw it in headless Chrome with two "phones" on the first-pass commit; the cause was then re-read on `cc356a6`, but the browser run was not repeated there.

The repro scripts are not in the repo (the audit was allowed to add only this file).

## Status: fixed in the first round (same day)

Fixed on `main` right after this audit, with a test or a browser check for each (see `CommitHistory.md`, "Audit fixes, push 1"): the five criticals (1–5), 12 (emergency number), 13 (a finished task fades the map), 17 (a held task keeps its warnings), 21 (time limit on the street download) and 36 (a second share link in the same tab). Part of 15 (the share link's database read now gives up after 8 s) and of 23 (the queue is retried every 15 s). Everything else below is still open.

## Fix these first

| # | What goes wrong | Where |
|---|---|---|
| 1 | One tap while a share link loads drops that phone out of the shared search, with no warning | `app.js` |
| 2 | Anyone with the link can run their own code on every phone in the search | `app.js` |
| 3 | An update that failed to send once is not retried; it can sit unsent for the rest of the search | `sync.js`, `app.js` |
| 4 | A two-person creek check falls apart when one partner accepts first, leaving one person alone on it | `engine/planner/plan.js` |
| 5 | "Someone else saw him by the lake" is filed as a plain message, not a sighting | `quickread.js` |

Counts: 5 critical, 19 important, 21 minor.

---

## Critical

### 1. A tap while a share link loads leaves the shared search

- **Where:** `app.js:2849–2851` (`start`), `app.js:449–458` (`placeAt`).
- **What happens:** a second phone opens a share link. While the streets load (39 s in the test; a few seconds for a Demo link) the blue bar says "Tap the map where they were last seen". One touch on the map moves the last-seen point, makes a new seed, leaves the shared search and strips the link. A map still appears, but it gets no updates, and the status quietly says "Not shared yet".
- **Why:** `start()` turns on last-seen mode before `joinFromLink()` and only turns it off when the join has finished.
- **Fix:** don't enter last-seen mode when the address carries a link:
  ```js
  const hasLink = /(^|[#&])(s|c)=/.test(location.hash);
  if (!hasLink) setMode('lastSeen');
  joinFromLink().then((joined) => { if (!joined) setMode('lastSeen'); }).catch(() => setMode('lastSeen'));
  ```
- **Checked:** Browser (after one tap: status "Not shared yet", link gone, the other phone's message never arrives) + Read.

### 2. Text from other phones is put on the map as HTML (stored XSS)

- **Where:** `app.js:2235` (searcher name), `app.js:1131` (sighting note), `app.js:298` (familiar-place name), `app.js:306`. Leaflet's `bindTooltip(string)` sets `innerHTML` (`lib/leaflet.js`).
- **What happens:** anyone who has the link writes a position whose name is `<img src=x onerror=…>` (it fits in the 40 characters the rules allow). The name label is always shown, so the script runs on every phone in the search with no tap. It can read what the phone has saved (home area, name), use the location permission, and post events. Since the release, sighting notes from other phones reach `app.js:1131` too (up to 300 characters). A crafted share link does the same through a familiar-place name when its star is tapped.
- **Fix:** one helper, used for every tooltip whose text is not a fixed translation:
  ```js
  const asText = (s) => { const el = document.createElement('span'); el.textContent = String(s); return el; };
  // .bindTooltip(asText(label), {...})
  ```
- **Checked:** Browser (`window.__xss` set on both phones from one database write) + Read (the four call sites and Leaflet's `innerHTML`).

### 3. A queued update is not retried

- **Where:** `sync.js:407–441` (`flushOnce`: no time limit on the send, and no retry is scheduled), `sync.js:685–688` (sending is only triggered by the stream opening or the browser's `online` event), `app.js` `start()` (nothing sends the queue at start-up), `manifest.json` (`start_url` has no search id).
- **What happens:**
  - A send fails once (connection reset) while the stream stays up. The status reads "Updates waiting for signal: 1" for as long as the person posts nothing else, and nobody gets the sighting.
  - A searcher posts with no signal, closes the app and reopens it from the home-screen icon. The queue stays on the phone and is not sent until they reopen the original link.
  - One send hangs on weak signal; every later update waits behind it.
- **Fix:** in `sync.js`, retry every 15 s while anything is queued, and put `signal: AbortSignal.timeout(15000)` on every `fetch`. In `app.js` `start()`, call `sync.flushQueue()` after `setDbUrl`, and remember the last search id so opening from the icon rejoins.
- **Checked:** Ran (a hung send: `settled = false | PUTs tried: A | queued: 2`) + Browser (60 s after the network came back the update was still unsent) + Read.

### 4. A hazard pair falls apart when one partner accepts first

- **Where:** `engine/planner/plan.js:500–518`, `549`, `588`, `789–794`.
- **What happens:** the planner gives two searchers the same urgent creek check, as a pair. The first taps "Take this task". On the re-plan only pairs where **both** already hold the task are protected, and a held task is not offered again, so the second searcher is shown a different task. After they take it, the first searcher holds the creek check alone (`partnerId: null`) and the list of uncovered danger spots is empty. `docs/PLANNER.md` says a lone searcher is never given a hazard check.
- **Fix:** treat a held `hazard_check` whose `partnerId` names a searcher without a task as a pending pair: skip the switch test for the holder and make the same task the partner's first option. If the partner holds something else, list the spot as `needs_partner` and warn the lone holder.
- **Checked:** Ran (`ana … hazard_check keep true needsPair true partnerId null … unfilled []`; in 80 random partial-accept re-plans the pair broke 25 times).

### 5. "Someone else saw him" is read as "it was someone else"

- **Where:** `quickread.js:469–473` (used at `:631`, `:688`, and by `proxy/jev.js:362,379`).
- **What happens:** "Someone else saw him by the lake 10 minutes ago" becomes a plain message with an `other_person` flag. The same happens for "Otra persona lo vio…", "Quelqu'un d'autre l'a vu…", "别人看到他…", "別の人が…見ました". It happens on both readers, even when Jev answers correctly. The app says "Your message is ready below" and the sighting never reaches the map.
- **Fix:** don't raise `other_person` when the "someone else" phrase is the subject of a see/say verb (add those subjects to `THIRD_PERSON_SEER` and skip the flag when it matches). Change `not (him|her)` to need the end of a clause.
- **Checked:** Ran (`message … flags=["water","other_person"]` for the English and Spanish sentences; 6 of 6 in the reviewer's set).

---

## Important

### The report box (the word rules on the phone)

`NATHAN.md` says the deployed proxy has no `TYPESAFE_API_KEY` yet. Until it does, `quickread.js` is the only reader, so these are what people hit. The person still confirms every draft; each entry says why they would likely confirm it wrong or lose the report.

### 6. A sighting is read as "searched"

- **Where:** `quickread.js:91` (runs before the "saw" rule at `:92`).
- **What happens:** "I saw him by the lake 5 minutes ago but didn't see where he went" becomes `searched`. The screen then says to finish a task under "Your next task"; no sighting form opens. Same for "…but when I got there he wasn't there" and the Spanish, Chinese and Japanese forms (7 of 7).
- **Fix:** in `readKind`, when both a not-found word and a saw word match, return `'sighting'` and mark `kind` unsure.
- **Checked:** Ran (`searched min=5 …`).

### 7. A negated "found" turns a sighting into a message

- **Where:** `quickread.js:74`, `75`, `78`, `81` (negations are stripped only for Chinese).
- **What happens:** "Still haven't found him but a neighbor saw him on Walnut Avenue 10 minutes ago" and "No lo encontramos en el parque, pero una señora lo vio…" become messages, on both readers. Nothing ends a search from a report, so the harm is the lost sighting.
- **Fix:** strip English, Spanish and French negations the way `:81` does for Chinese; drop bare `back|fine|ok` from `:74`. When a found word and a seen-with-place clause both match, return a sighting with `kind` unsure.
- **Checked:** Ran (both sentences → `message`).

### 8. Wrong minutes: "forty five" is read as 5, hours are not read

- **Where:** `quickread.js:111–131`.
- **What happens:** "forty five minutes ago", "twenty five minutes", "cuarenta y cinco minutos" give 5; "四十五分钟前" gives 15. A wrong number looks filled in, so it is easy to confirm. "2 hours ago" gives no time in any language (the box is now left empty and must be typed, so that part is only an inconvenience).
- **Fix:** add hours (`(\d+|number word)\s*(hours?|hrs?|horas?|heures?|小时|時間)` × 60). Return nothing when the word before the matched number is a tens word (twenty…, "y", vingt…). Change `十五分` to `(?<![二三四五])十五分`.
- **Checked:** Ran (`min=5 … forty five minutes ago`; `min=null … 2 hours ago`).

### 9. "I can't say for sure it was him" is read as certain

- **Where:** `quickread.js:184–190`, `228–231`.
- **What happens:** negated certainty gives reliability 0.9, the setting that moves the map most: "I can't be certain", "no puedo estar seguro", "je ne peux pas être certain", "不能确定是不是他", "確実ではありません".
- **Fix:** before the certain rule, return 0.3 when a negator sits within about 20 characters before a certainty word.
- **Checked:** Ran (`rel=0.9 … I can't say for sure it was him`).

### 10. A report longer than 300 characters is cut before it is read

- **Where:** `quickread.js:676`, `report.js:310`, `340`. The box allows 1,000 (`index.html`), and 30 s of speech is about 400 characters.
- **What happens:** a sighting or "he fell" at the end is never read, the note is cut, and the box is cleared. In the test a 366-character report ending "I saw him by Lake Elizabeth 5 minutes ago heading north" came out as `searched`.
- **Fix:** read the whole text in `readLocally` and cut only the note. Don't clear the box when the text was longer than the note.
- **Checked:** Ran.

### 11. Urgent present-tense sightings become messages

- **Where:** `quickread.js:90`, `651–657`.
- **What happens:** a question mark beats "saw": "I saw him near the lake 10 minutes ago, should I follow him?" is a message. No rule covers "He's right in front of me on Walnut Avenue", "He just walked past me", "Lo estoy viendo ahora mismo", "他就在我面前". The team gets the text, but the map doesn't move.
- **Fix:** apply the question rule only when no saw word matches; add "in front of me / walked past / estoy viendo / vient de passer / 面前 / 目の前".
- **Checked:** Ran (the first sentence → `message`; 9 of 9 in the reviewer's set).

### The screen

### 12. The emergency banner shows 110 or 112 on a phone that is in the US

- **Where:** `i18n.js:1556` (`detectRegion`), used at `app.js` start for the banner number and the `tel:` link.
- **What happens:** the region is taken from the browser's language tag. A phone in Fremont set to `zh-CN` or `ja-JP` shows "110" and dials 110; `es-ES` and `fr-FR` show 112. There is no way to change it. Units also flip to metric.
- **Fix:** check the time zone first. If `Intl.DateTimeFormat().resolvedOptions().timeZone` is a US zone, return `'US'`; otherwise use the language tag.
- **Checked:** Ran (`zh-CN in Fremont → region CN → banner number 110`).

### 13. Finishing a task doesn't change the map

- **Where:** `app.js:64` (`ENGINE_EVENT_TYPES`), `engine/grid.js` `replay` (reads only `searched` and `sighting`). Listed under "Still not built" in `UPDATESBYNATE.md`.
- **What happens:** the screen no longer sends `searched`; "Done, nobody found" sends `completed`, which the engine ignores. The heat map, the grey searched squares and "Check these first" stay exactly as they were however much is searched. Only the task list and the "chance covered" line change. `README.md` section 7 ("its chance drops … and everything else rises") describes something a judge can no longer see.
- **Fix:** `docs/PLANNER-MERGE.md` step 8 (give `replay` the coverage of each `completed` event). Until then, say so in the README.
- **Checked:** Ran (map hash and top spots identical before and after `assigned` + `completed`; the planner's covered chance went 0 → 4.3%).

### 14. Double-tap on Share makes two searches

- **Where:** `app.js:2411–2414` (`state.searchId` is set only after `await sync.createSearch`).
- **What happens:** a second tap while the first waits on the network creates a second search. The phone ends up listening to search 2 while its earlier events went to search 1, so everyone who joins gets a map without them.
- **Fix:** a `sharing` flag (or disable the Share button) around the create block.
- **Checked:** Browser + Read.

### 15. A share link opened on weak signal shows nothing

- **Where:** `app.js:2530` waits for `sync.loadSearch` (`sync.js:628–630`, no time limit) before drawing, although the link itself carries the case.
- **What happens:** 30 s after opening the link there is no map and no message. With no signal at all it works (the link's case is used).
- **Fix:** `AbortSignal.timeout(6000)` on that `fetch`, or draw from the link's case first.
- **Checked:** Browser + Read.

### 16. "Found" can't be taken back

- **Where:** `app.js:1522–1534`, `renderFound` at `:1536`.
- **What happens:** one tap and one confirm by anyone with the link ends the search on every phone: tasks are hidden and positions stop. Events can't be deleted and there is no "not found after all", so a mistaken or hostile tap ends that shared search for good.
- **Fix:** a "reopen the search" event that `foundEvent()` respects (the latest of found / reopened wins), shown as a button in the found banner.
- **Checked:** Read.

### The planner (now on the screen as "Your next task")

### 17. Taking a task hides its danger warnings

- **Where:** `engine/planner/plan.js:789–794` (a held task's danger is rebuilt with no warning codes), shown by `app.js:1410`.
- **What happens:** the card offered "Do not enter the water", "Stay on the path" and "Water nearby". After "Take this task" the card for the same task shows none of them.
- **Fix:** work out `dangerOf` again for the held task, or carry `danger` in the `assigned` event and show that.
- **Checked:** Ran (offered `["do_not_enter_water","stay_on_path","water_nearby"]`, held `[]`).

### 18. Parts of a route are straight lines through whatever is in the way

- **Where:** `engine/planner/plan.js:227` with `world.js:254` (the start is snapped to the nearest street corner, not the nearest point on a street); `plan.js:542–544` (a pair partner is given the lead's route).
- **What happens:**
  - The first, dashed piece of every route is an unchecked line from the searcher to a corner. From road squares within 2 km it crossed a building in 1,026 of 30,635 cases and water in 75; the longest was 152 m.
  - A pair partner too far from the lead's start gets no walk-there leg at all: the route jumps 1.4–1.6 km in one straight line across buildings and a creek.
- **Fix:** snap to the nearest point on a walkable street piece, or refuse a snap whose line crosses water, a building or rail. In `pairFor`, only accept a partner who can reach the lead's start.
- **Checked:** Ran (`biggest gap between consecutive points 1439 m … "BUILDING":140,"CREEK":10`).

### 19. A park sweep along the lake carries no water warning

- **Where:** `engine/planner/plan.js:679–707` (`dangerOf` counts water only along street pieces; a sweep has none).
- **What happens:** the park task beside Lake Elizabeth (28 squares touching water) is offered to a lone searcher with only traffic warnings. 8 of 12 lakeshore park tasks had no water warning.
- **Fix:** for sweeps, count `world.nearWater` over the task's squares and raise `water_nearby`.
- **Checked:** Ran.

### 20. Two phones with the same inputs get different plans

- **Where:** `engine/planner/plan.js:253` and `:327` (the cache key rounds the time to 5 minutes, but the value stored was worked out at the first caller's exact minute).
- **What happens:** a phone that planned at 67.6 minutes reuses that coverage at 72.4; a phone that joined later works it out fresh. In 80 trials the numbers differed in 70 and the first-choice task in 5. Shuffling events or searchers made no difference, so this is the only cause found.
- **Fix:** compute with the bucket's own time: `const bucketMin = Math.round(sinceMin / 5) * 5` and pass that at both places.
- **Checked:** Ran.

### Map data and sync

### 21. The street download has no time limit

- **Where:** `data.js:347`.
- **What happens:** a map server accepts the connection and never answers. The bar sits on "waiting" and no other mirror is tried. This was happening live during the audit: one mirror returned 502 and another sent nothing for 100 s. A judge trying a real (non-Demo) search would see it.
- **Fix:** `signal: AbortSignal.timeout(100000)` on the `fetch`; treat a timeout as "busy" and move to the next mirror.
- **Checked:** Ran (`loadArea has not settled; no retry, no other mirror tried`).

### 22. A map-server error answer is saved as the area and reused

- **Where:** `data.js:352`, `569–574`, `624–627`.
- **What happens:** Overpass reports a timed-out query as status 200 with no streets and a `remark`. The app saves 0 streets for that spot, the engine draws a confident map on blank ground (no routes, no street names), and every later search there reuses the empty copy. A cut-short buildings answer is saved as final in the same way.
- **Fix:** in `fetchOverpass`, treat a `remark` matching `/error/i` as "busy". In `loadArea`, never save or accept an area with 0 streets.
- **Checked:** Ran (`1st load: ways 0` → `2nd load: fromCache true ways 0`). The 200-with-remark shape is Overpass's documented behaviour; it could not be confirmed live because the servers were at capacity.

### 23. A brief server error deletes the update

- **Where:** `sync.js:427–441`.
- **What happens:** any refusal (503, 429, 500) followed by a failed re-read removes the event from the queue. After one refusal the queue also stops, so good events behind it wait.
- **Fix:** drop only on 400/401/403; keep the event on 408/429/5xx. After a refusal, carry on with the rest of the queue.
- **Checked:** Ran (`HTTP 503 … left in queue: 0`). With real Firebase a 5xx without CORS headers shows up as a network error and the event is kept, so this may be rarer live than in the test.

### 24. An error on the live stream leaves the phone deaf

- **Where:** `sync.js:686`.
- **What happens:** if a reconnect gets an HTTP error, the browser closes the stream for good. The phone can still send but never receives, while showing "Reconnecting…".
- **Fix:** in the error handler, when `source.readyState === 2`, open a new stream after 5 s.
- **Checked:** Browser + Read.

---

## Minor

| # | Where | What goes wrong | Fix | Checked |
|---|---|---|---|---|
| 25 | `engine/planner/segments.js:62–78`, `plan.js:360` | Tasks run far past the 45-minute cap: 410 of 914 yard tasks, worst 232 min (estimate 27) | Cut the tour at the cap, or skip tours over 1.3× it | Ran |
| 26 | `app.js:935–953` | An event `sync.checkEvent` refuses is dropped with only a console line; one the database refuses stays on this phone's map | Show a status when `recordEvent` returns false; remove a refused event from `state.optimistic` | Read |
| 27 | `app.js:2414–2430`, `sync.js:349–351` | Missing more than 24 h (minutes above 1440): the map runs but Share makes a link that isn't live, and the reason is overwritten at once | Clamp minutes to 1–1440 in `readCase()`; keep the error visible | Ran + Browser |
| 28 | `app.js:2775`, `2856` | After the Demo, a new pin within 2 km reuses the bundled Fremont file, which is centred 1.6 km away: 19–51% of the new map has no data, and nothing says so | Test coverage (`data.coversGrid`) instead of distance | Ran |
| 29 | `data.js:352–359` | A 200 answer that isn't JSON is reported as "no internet" and gives up after 2 of 5 tries | Treat a parse error as "busy" | Ran |
| 30 | `data.js:186–187` | One way tagged `landuse` + `leisure` in the streets answer cancels the buildings download for that area for good (none in the Demo area) | Only keep `layers` when it has buildings | Ran |
| 31 | `data.js:605–606` | "Save my home area" keeps the smaller search-sized copy if one exists | Accept a saved copy only if its radius is big enough | Ran |
| 32 | `engine/grid.js:175`, `484`; `engine/prior.js:350` | From 13 sightings every replay re-simulates: 0.6 s per redraw on a desktop, several times that on a phone | Evict the oldest entry instead of `clear()` | Ran |
| 33 | `engine/grid.js:398` | A `searched` event with id `r015c016` lowers the map but shows as not searched (older links or another client only) | File the minutes under the parsed id | Ran |
| 34 | `app.js:449–458`, `ageMinutes` | After the Demo, a new last-seen point keeps the old clock: 5 minutes later the typed minutes go up by 5 and a map nobody asked for is drawn | Reset `state.minutesAt` and `state.caseStartedAt` in `placeAt` | Browser + Read |
| 35 | `sw.js:100–110`, `app.js:252` | Each cached map tile costs about 6.4 MB of storage (tiles load without CORS), so storage fills near 1,700 tiles, below `MAX_TILES` | `crossOrigin: true` on the tile layer; rename the tile cache; `try/catch` around `cache.put` | Browser + Read |
| 36 | `app.js` `start()` | Opening a second share link in a tab that already has the app does nothing | `window.addEventListener('hashchange', () => location.reload())` | Read |
| 37 | `app.js:2629` | The English copy of the hand-off sheet uses the screen language's date and time format | Set the language around the body, as `spotTitleIn` does | Read |
| 38 | `tests/engine.test.js:695–697` | Wall-clock limits make `node --test` fail now and then on a busy machine (5 runs: 222, 224, 224, 224, 223 of 224) | Run the timing checks only with an env var set | Read (the failures were seen by a reviewer under load, not by the audit session) |
| 39 | `index.html:28`, `app.js:360` | The offline banner isn't announced (`role="status"` missing); the direction handle is a slider with no value | Add the attributes | Read |
| 40 | `sync.js:448–456` | With site storage blocked or full, every event is reported sent and nothing is | Keep the queue in memory when storage fails | Ran |
| 41 | `app.js:137–139`, `896–915` | Two phones posting in the same millisecond share a `cid`, and one event is hidden everywhere | Put `state.searcherId` in the `cid` | Read |
| 42 | `app.js:2559` | A link with a well-formed id that doesn't exist says "You joined a shared search" | Check `caseDoc` before saying so | Read |
| 43 | `proxy/worker.js:66`, `116`, `184`; `report.js:288`; `proxy/jev.js:283` | A JSON body of `null` throws; a hung Jev has no time limit (the phone waits 15 s); a `200 {}` answer makes every report a message; a place named "Constructor…" crashes the Worker | Body check; `AbortSignal.timeout(6000)`; reject an unknown `kind`; `Object.hasOwn` | Ran |
| 44 | `proxy/jev.js:283`, `297`, `301` | The "don't invent" check passes a wrong Jev answer: "street" supports any street, "sure" contains "sur", "often" contains "ten" | Whole-word matches | Ran |
| 45 | `quickread.js:148–151` | "Lo vi al sur del lago", "au nord du lac", "湖の北の方で" fill a position in as the heading | Don't match when "de / du / の" follows | Ran |

---

## Before the live link is relied on

Not bugs in the code, but they decide whether a shared search works. Both are already in `UPDATESBYNATE.md`.

- **Publish `firebase-rules.json`.** Until the new rules are live, the database refuses `assigned`, `completed`, `released`, `found` and `caseUpdate`, so tasks, Found and corrections stay on one phone. Whether they are published could not be checked without writing to the live database.
- **Publish the rules and the site together.** A phone still running the cached old app can join and post, but can't start a new search under the new rules.

## Fixed by the release wiring (found on the first pass, gone on `cc356a6`)

- Sighting markers now show in a shared search (`drawSightings` reads `currentEvents()`).
- The report's safety flags (emergency, water, vehicle…) are shown, and unsure fields are highlighted.
- A sighting with no time no longer saves as "0 minutes ago"; the box is left empty and asked for.
- Sighting minutes and task minutes are clamped to what the database accepts, and an event is checked before it goes on the map.
- Corrections after sharing reach the other phones (`caseUpdate`); Found and the version warning exist.
- The planner is not given stale searchers or the same searcher twice; it keeps its own copy of the map; `canvass` is allowed and an empty `track` is left out.

## Checked and sound

- **Engine:** 28 edge cases and 40 random ones gave no crash and no NaN, and the map always sums to 1. A search never raises its own area. The map is identical whatever order events arrive in, with warm or cold caches, and in the worker. No `Math.random` or `Date.now` in the maths.
- **Routes on the Demo map:** 987 planner routes: every piece after the first is a real street piece, with no motorway or trunk road. `waterway=pressurised` is excluded.
- **Speed:** first map 0.5 s, first plan 0.7 s, later plans about 50 ms (desktop Node).
- **Sync:** an event echoed back or re-sent after a reconnect counts once; events have one fixed order on every phone; junk in the database doesn't crash the listener.
- **Offline:** `SHELL_FILES` holds every file the app imports (27 modules), and each exists. Offline reload and the Demo worked on the first pass.
- **Translations:** every key the screen uses exists in all five languages with matching placeholders, including every planner warning, task and flag code.
- **Screen:** every id `app.js` asks for is in `index.html`. Lowest text contrast 6.39:1; controls are at least 44 px; no zoom lock.
- **Clone and run:** a fresh copy serves and passes its tests with no install; `npm run bench` reproduces the README table. No private research files or keys are in any branch.

## Not checked

- Real phones and Safari.
- The live Firebase database and the deployed proxy.
- The planner's cards in a browser on `cc356a6` (planner findings were reproduced against the engine; the screen side was read).
- `replies.js` `checkReply` lets a made-up "They have been found" through (`replies.js:402–408`, `513`, `546–549`), but the app never asks an AI for a reply (`proxyUrl: ''`), so nobody can hit it today. Fix it before `/say` is switched on.

---

## Five improvements, each under 30 minutes

1. **Say when the map has no data.** The engine already returns `prediction.noDataShare`; show one line when it is above 5%. Softens findings 22 and 28.
2. **Keep an unshared search across a reload.** After every run, `history.replaceState(null, '', shareLinkPathWithHash())`. Today a reload wipes it.
3. **Keep the "map will sharpen" note up** until the second download lands. It disappears after 4 s while the download takes about 40 s more.
4. **Add the failing report sentences** (findings 5–11) to `bench/safety-cases.json` or `tests/safety.test.js`, so the fixes stay fixed.
5. **Extend the planner's safety test to `route.points`:** every piece after the first is a real street piece, and the first is short and crosses no water, building or rail. It would have caught finding 18.
