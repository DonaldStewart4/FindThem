# Commit History

A detailed log of every commit, for people and AI agents who don't have the chat history behind this project. `git log` gives one-line titles; this file explains what changed, why, what was decided, and what's left.

**Read `ShortPlan.md` first** (2 minutes) if you're picking up the project cold, then this file and `PLAN.md`. Then read `README.md` (what the app is) and `ROADMAP.md` (what's deliberately not built).

## How to add an entry

Every commit adds an entry to this file **in the same commit**. Newest entry goes at the top of the Log.

- A commit can't contain its own hash, so the entry header uses the commit title. Find the hash with `git log --oneline --grep "<title>"`.
- Write for someone with zero context: name the files, say why, record decisions and the alternatives that were rejected, and be honest about what wasn't tested or is still broken.
- If a later commit changes a decision recorded here, add a new entry saying so. Don't rewrite old entries.
- Work that isn't committed yet goes under **Uncommitted**. Move it into a proper entry when it's committed.

Template:

```markdown
### <commit title>
- **Date:** YYYY-MM-DD
- **Stage:** <build stage, e.g. Stage 2: Data>
- **What changed:** <files and what each change does>
- **Why:** <the reason or request behind it>
- **Decisions:** <choices made and alternatives rejected>
- **How it was verified:** <what was run or checked, and the result>
- **Known issues / not done:** <bugs, gaps, things not tested>
- **Next:** <what the following commit should tackle>
```

## Project context

Current decisions. Updated 2026-11-21 night (proxy deployed, searcher positions, backup report reader); first written after merging the team's planning doc ("Components of What We're Going to Build") into `PLAN.md`. `PLAN.md` has the full plan; this section overrides the original prompt where they differ.

- **What it is:** FindThem, a phone-first PWA for the first hour after a person with dementia goes missing. Simulated walkers on the real OpenStreetMap street graph give a starting probability map on a 25 m grid. Searchers join by share link and each gets a sector and a walking route. A shared message feed and a voice/text report box keep everyone in touch. Each empty search and each confirmed sighting updates the map with Bayesian search theory, live on every phone. A hand-off sheet goes to police at the end.
- **Event:** EvoHacks II, theme social good. **Deadline Sun Nov 22, 2026, 12:00 pm**; code freeze 9:30 am; submit by 11:00 am. **Official EvoHacks 2 rules (posted Nov 21): AI use is encouraged**; fresh code only (Nov 21 9:00 AM – Nov 22 12:00 PM PST); submit on Devpost with a description, setup instructions, a public repo and a 2–3 minute video; judged 25% each on impact, technical execution, creativity and presentation. (An earlier "AI may not build the whole project" rule came from the game plan's reading of an older page and is dropped.)
- **Team (corrected 2026-11-21 afternoon):** two people.
  - **BenStew** (repo owner): screen, hosting and the engine (`engine/`), all built with Claude Code (the engine since the official rules were posted).
  - **Nathan:** tests, debugging, speed (`tests/`, `bench/`) and tuning the Jev questions. AI may help write tests.
  - **"Jev" is not a person.** It's TypeSafe AI's Jev model, used only in the report box (`proxy/jev.js`).
  - `INTERFACES.md` is the contract; changes need both to agree.
- **Tech:**
  - plain HTML/CSS/vanilla JS, no frameworks, no build step
  - Leaflet 1.9.4 in `/lib` (Leaflet.heat was removed on 2026-11-21 evening; the map draws red/orange/yellow likely-area bands itself)
  - OSM tiles; Overpass for streets and terrain; IndexedDB cache; service worker
  - Firebase Realtime Database through REST (no SDK) for the case, events and messages, with Supabase as the fallback. **Live at `https://findthem-f4e5c-default-rtdb.firebaseio.com` since 2026-11-21**, with the rules from `firebase-rules.json` published (updated 2026-11-21 night to allow each searcher's position under `searchers/`, shown as green dots; the engine never uses them).
  - a Cloudflare Worker holding the API keys as Worker secrets: Jev (TypeSafe) for the report box, and since 2026-11-21 evening, optional Deepgram (speech → text) and ElevenLabs (read-back, **English only**) keys for the voice bot, which falls back to the phone's own voice input without them; no FastAPI or other server. **Deployed 2026-11-21 at `https://findthem-proxy.findthem-evohacks.workers.dev`** with both voice keys; the TypeSafe key is still missing (Nathan is getting it). When Jev can't answer, `quickread.js` fills in the report draft on the phone with simple word rules (5 languages)
  - the prediction runs on the phone; tests use `node --test`
- **Must-haves by the deadline:** engine + tests, map + inputs, shared searched areas, routes for searchers, sightings, messaging, the voice/text report box, share link, police hand-off sheet, offline PWA, all 5 languages (en/es/fr/zh/ja), Demo button.
- **Report box rules:** never called a "chatbot" in the UI. Jev answers multiple-choice questions about the text (low-confidence answers left empty) to make a draft; the person confirms before it becomes an event; the LLM never sets probabilities; the manual form is the fallback and works offline.
- **The benchmark is done** (2026-11-21, `bench/benchmark.js`): found after 1,500 searcher-minutes, on their own 21%, ring sweep 29%, FindThem 54%, FindThem + sighting 77% (1,000 simulated cases). Re-run it if the engine changes.
- **Demo and tuning area: Fremont, CA**, around Central Park / Lake Elizabeth (~37.553, −121.970). It replaces Austin. Checked against Overpass: 3,408 walkable ways and 85 trap features within 1 mile. `waterway=pressurised` (underground pipes) must be skipped.
- **Kept from the first planning round:**
  - **Units:** the phone's region decides (US, Liberia, Myanmar → miles/feet; elsewhere km/m), with a mi/km toggle. Rings are always 0.5/1/1.5 mi on the ground.
  - **Emergency banner:** the local number from a country table (default 911), tap-to-call, can't be dismissed.
  - **Save my home area:** from an address search (Nominatim), a map tap, or GPS.
  - **Deploy:** GitHub Pages, **live at https://donaldstewart4.github.io/FindThem/ since 2026-11-21**. The repo is public.
- **Replaced:** "mark streets searched" and "copy summary for police" (the old stretch goals) became syncing sectors/routes and the hand-off sheet. The "no Claude in the repo" rule is dropped: AI tools are disclosed openly and `CLAUDE.md` is committed.
- **Time-aware map (moved off the roadmap 2026-11-21 night, at BenStew's request):** every 5 minutes the screen adds 5 to "minutes since last seen" and re-runs `replay`. Shared searches count from `minutesAt` in the case, so every phone's map matches.
- **Do not build** a chatbot persona, camera integration, trackers, GPS-trail coverage, drill mode, accounts or photos, or anything else on the roadmap.
- **Report box safety layer (2026-11-22, branch `agent-contract`, not merged):** the AI is treated as unreliable. Jev's answers are cross-checked against the report's own words before a draft is sent back. Drafts are `ReportDraft` v2 with optional `unsure` / `flags` codes. **Approved by Nathan and written into `INTERFACES.md` §5 on 2026-11-22** (with street corners and `assigned.toId`). A flag warns but never drops a true sighting. The contract for future agent features is `docs/AGENT-CONTRACT.md`.
- **Event integrity (2026-11-22, branch `integrity`, not merged):** no event can corrupt the shared map.
  - Firebase refuses any event that isn't exactly a known shape, refuses edits and deletes, and accepts the case once.
  - Every phone re-checks what it receives with the same rules (no clock involved), drops and counts bad events, and counts copies once.
  - The case carries `engineVersion`, so a phone on another engine version can warn.
  - The rules, `sync.js` and the mock are checked against one shared test table.
  - Corrections after sharing are `caseUpdate` events (the latest `at` per field wins). The person being found is a `found` event.
  - The table also passes against the real Firebase emulator. `INTERFACES.md` §6 is the reference (approved by Nathan).

## Log

### Integrity: caseUpdate and found events, INTERFACES §6, Firebase emulator check
- **Date:** 2026-11-22
- **Stage:** Finishing (reliability), branch `integrity` (Nathan), own worktree
- **What changed:**
  - **`caseUpdate { type, field, value?, by, at }`** in `firebase-rules.json`, `sync.js` and `tools/mock-firebase.py`.
    - Allowed fields: `minutes`, `minutesAt`, `direction`, `mobility`, `familiarPlaces`, `travel`, `description`. `value` is checked like the case field it replaces.
    - Leaving `value` out clears `direction`, `familiarPlaces` or `description`. The other fields need a value.
  - **`found { type, lat, lng, by?, at, note? ≤ 300 }`** in the same three places.
  - Case gets two optional fields: `travel` (`walking | car | bus | unknown`) and `description` (≤ 300 characters).
  - `sync.js`:
    - `applyCaseUpdates`: the latest `at` per field wins, ties go to the larger push id by code point (`compareIds`), and any update beats the case's first value.
    - `readMirror` / `subscribe` / `loadSearch` return the updated `caseDoc` plus `baseCase`, and `info.caseUpdates`.
    - `withoutNulls` also drops `[]` and `{}`, like Firebase. All sorting uses `compareIds`.
  - `tests/sync.test.js`:
    - The table grew from 75 to 118 rows (36 caseUpdate, 7 found).
    - The write checks are now one scenario list, run against the rules evaluator (twice: checking the levels above the written path, and not), the mock, and the Firebase emulator when `FIREBASE_EMULATOR` is set.
    - The evaluator now runs `.validate` on the levels above the written path, as the emulator showed real Firebase does.
    - New tests for case-update merging, `compareIds`, and sending `caseUpdate` / `found`.
  - `INTERFACES.md` §6 rewritten: Firebase shape, every event type's fields and ranges, caseUpdate merge rule, what phones do with what they receive. Plus one "known limits" line: lies aren't stopped.
  - `docs/INTEGRITY-REPORT.md` (new): the full report. `UPDATESBYNATE.md`: the screen work for caseUpdate and found.
- **Why:** Nathan's request. `docs/INTAKE-SPEC.md` open issue 1: the case is written once, so corrections after sharing need an append-only `caseUpdate`. A `found` event ends the search.
- **Decisions:**
  - **Any caseUpdate beats the first value, even with an older `at`.** Rejected: comparing with `createdAt`, which would silently drop a correction from a phone whose clock is behind.
  - **`travel` and `description` shapes are assumptions** taken from INTAKE-SPEC's chips; noted in the report.
  - **The rules generator stayed a scratch script.** `firebase-rules.json` is the source, checked by the tests.
- **How it was verified:**
  - `node --test`: 127 tests, 126 pass, 0 fail, 1 skipped (the emulator test, which is off unless `FIREBASE_EMULATOR` is set).
  - **Firebase emulator** (firebase-tools 15.37.0, database emulator v4.11.2, Java 24), rules loaded into `demo-findthem-default-rtdb`: `node --test tests/sync.test.js` gives 25 tests, 25 pass, 0 fail, 0 skipped. Every scenario step matched; **0 differences.**
  - Mutation A (rules accepting reliability 0.5): the emulator accepted it, so it really runs our file.
  - Mutation B (case completeness removed from `.write`): the emulator still refused lone `case/minutes` and `case/lastSeen/lat` writes. So Firebase validates the levels above the written path; the evaluator was weaker and is fixed.
- **Known issues / not done:**
  - Not tested on the real database.
  - `sync.js` itself was run only against the mock: its URLs have no `?ns=`.
  - Screen work in `UPDATESBYNATE.md`: send `caseUpdate` on corrections, rebuild the case from `caseDoc`, a Found button, plus the earlier items.
- **Next:** deploy the rules with `sync.js` to the real database and test with two phones; the screen session applies `UPDATESBYNATE.md`.

### Event integrity: strict Firebase rules, checked events on every phone, engineVersion
- **Date:** 2026-11-22
- **Stage:** Finishing (reliability), branch `integrity` (Nathan), own worktree
- **What changed:**
  - `firebase-rules.json`:
    - Every event type is checked for its exact shape: `searched`, `sighting`, `message`, plus the planner's `assigned`, `released` and `completed`. `assigned` accepts the planner shape and the INTERFACES shape, with an optional `toId`.
    - Ranges: `searched` and `completed` minutes are numbers from 1 to 600, lat ±90, lng ±180, reliability is 0.3, 0.6 or 0.9, `at` ≥ 2020 and ≤ server time + 1 h.
    - Text caps: name 40, note and message 300, ids by regex. A `track` is at most 2000 whole numbers.
    - Unknown types and extra fields are refused.
    - Completeness checks sit in `.write`, so writing one field at a time can't build a half event or half case.
    - Events are append-only and need a 20-character push id. The case is written once, whole, and must carry `engineVersion`.
    - Searcher positions can still be overwritten and removed, but their shape is checked now.
  - `sync.js`:
    - `checkEvent`, `checkCase` and `checkSearcher` apply the same rules (without the clock).
    - `cleanEvents` / `readMirror` drop and count bad events and de-duplicate by content. `subscribe` passes an `info` 4th argument (dropped, duplicates, caseProblem, versionMismatch) and ignores stream messages it can't parse.
    - `applyChange` handles multi-path patches and ignores `__proto__` paths.
    - `addEvent` and `createSearch` refuse invalid data locally with `error: 'invalid'`.
    - Events are sent with PUT at a client-made push id (`newPushId`). If a send is refused, sync.js reads that id back and treats an identical stored copy as success, so a retry is never stored twice.
    - `createSearch` stamps `engineVersion` (`ENGINE_VERSION = '2026-11-22.1'`, or `setEngineVersion`). `loadSearch` returns `info` and fills in `direction: null` and `familiarPlaces: []`.
  - `tools/mock-firebase.py`:
    - Enforces the same rules by checking each touched slot (case, event or searcher) whole after a write.
    - Adds PATCH (all-or-nothing) and DELETE, a 400 for bodies that aren't JSON, 401 "Permission denied", Firebase-style push ids, `--port 0`, and `patch` stream events.
  - `tests/sync.test.js`:
    - A 75-row table of good and bad events (malformed, oversized, wrong-type, extra-field, future-dated, emoji length) is checked against sync.js, against `firebase-rules.json` through a small rules evaluator, and against the mock over HTTP.
    - Separate tests cover append-only, write-once case, partial-write and PATCH, duplicate and replay, lost-answer retry, prototype pollution, and junk on the stream.
  - `UPDATESBYNATE.md` (new): what the screen must do.
- **Why:** Anyone with a search link can write to the database. Before this, a malformed event (minutes as text, lat 500, a 1 MB note, an unknown field), an edit, or a duplicate could poison the map on every phone or crash `replay`.
- **Decisions:**
  - **Rejected: a server-side `cids/` index for replay protection.** `cid` is `local-<ms>-<n>`, which an attacker could guess and claim first. Retries are made safe by client-chosen push ids instead, and replays (same content under a new id) are counted once on every phone.
  - **Case `minutes` and `minutesSince` allow up to 1440**, not 600: the form allows 1440, and `app.js` caps the growing minutes at 1440. Only event minutes are 1–600.
  - **Phones don't apply the "not in the future" check.** Phone clocks differ, and every phone must drop the same events.
  - `minutes` may be fractional (`markSearched` takes `Number(input)`).
- **How it was verified:**
  - `node --test`: 125 tests, 125 pass (110 before this change; the new ones are in `tests/sync.test.js`).
  - Mutation check: loosening one rule (reliability 0.5) and one mock check (text 400) each made the table test fail. Both files were then restored.
  - The rules were *not* deployed to real Firebase or run in the Firebase emulator. The evaluator in the test models Firebase's documented semantics (cascading `.write`, `.validate` at and below the write, `$` wildcards, `%`, `.matches`). The real server could differ in edge cases.
- **Known issues / not done:**
  - Screen work is listed in `UPDATESBYNATE.md`: show the version warning (i18n in 5 languages), handle `invalid` in `recordEvent`, clamp minutes, `sw.js` cache bump, `INTERFACES.md` §6 update.
  - A malicious but well-formed event (a fake sighting) is still accepted; there are no accounts, so that is out of scope.
- **Next:** deploy the rules with `sync.js` and test two phones against real Firebase; the screen session applies the `UPDATESBYNATE.md` items.

### Safety layer: water never drops a sighting, street corners, language-aware vehicle words, INTERFACES v2
- **Date:** 2026-11-22
- **Stage:** Finishing (safety), branch `agent-contract` (Nathan)
- **What changed:**
  - **Water flag checked** (`quickread.js`):
    - Before this commit, "I saw him by the lake 10 minutes ago" already stayed a sighting with the `water` warning in both readers. The backup reader didn't pin "the lake", though.
    - New `readFeaturePlace`: with no place name in the report, a feature word in any of the 5 languages (lake / creek / lagoon / river / park) pins the one nearby place of that kind. Only if there is exactly one; plurals like "Quarry Lakes" count.
    - `PLACE_WORDS` and a whole-word `hasWord` moved here from `proxy/jev.js` and are shared. Jev's place-evidence check is now whole-word, so "lac" is no longer found in "place".
  - **Street corners** (`quickread.js`):
    - `findIntersections(osm, streetNames, near)`: one point per corner, the middle of a divided road's nodes. A pair that crosses in two places is left out as ambiguous.
    - `readIntersection`: two streets joined by "and / & / y / con / et / 和 / 与 / と", or a corner word in the report. The report must name no other place.
    - Both readers pin the corner. A corner suppresses the two-places conflict.
    - `proxy/jev.js`: `cleanIntersections`. Corners are offered to Jev as place options. Jev naming one street of the corner agrees, and the corner is pinned.
    - `proxy/worker.js` and `report.js` (`parseReport`, `confineDraft`) carry `context.intersections`.
  - **Vehicle words by language:** `VEHICLE` is now per language. `guessLanguage(text, appLang)` decides: kana → ja, Han → zh, else the most common en/es/fr words. The app's language only breaks ties.
  - **`INTERFACES.md`:**
    - §5 rewritten for `ReportDraft` v2 (`unsure`, `flags`, what stops a sighting and what doesn't), `Intersection`, and the corner rule;
    - `assigned` events get an optional `toId`;
    - the status line records Nathan's approval.
  - **`docs/AGENT-CONTRACT.md`:**
    - status "approved";
    - safety-layer rules 8–10;
    - new results;
    - a "Screen work" section: the exact `app.js` / `index.html` / `style.css` / `i18n.js` changes, with drafted strings in all 5 languages.
  - **`bench/safety-cases.json`** (v2, 74 cases): +6 true water sightings, +8 corner cases, +1 French "car", and the demo corner list.
  - **`bench/safety-eval.js`:** two new danger rules: a flag that drops a true sighting, and `mustNotFlag`. The readers get corners and language.
  - **`tests/safety.test.js`:** +13 tests. `sw.js` v29 → v30. `README.md` / `PLAN.md` notes.
- **Why:** Nathan's follow-up:
  - a flag may add a warning but must never drop a true sighting;
  - resolve intersections to where the two streets the phone sent cross;
  - French "car" means "because";
  - he approved the contract, so `INTERFACES.md` may change.
- **Decisions:**
  - **Corner coordinates come from the phone's own map**, sent as a list, not from the single point per name in `places`. That point is just the name's nearest node to the last-seen point, so two of them can't locate a corner.
  - **A corner needs a joiner or a corner word.** Otherwise "on Paseo Padre, then on Stevenson" would be pinned to a corner nobody mentioned.
  - **"The lake" pins only a unique match.** Two lakes nearby → the person taps the map.
  - **Language comes from the text first:** people don't always type in the app's language. "car" is not counted as a French word, so "car gone" stays English.
  - Still not touched: `app.js`, `i18n.js` (another session is editing `app.js`), `engine/`, `data.js`, `tests/fixtures/` (only read, for corner tests).
- **How it was verified:**
  - `node --test`: 110 pass, 0 fail.
  - `npm run safety-eval -- --local`: 68 right, 6 abstained, **0 dangerous** (of 74). With no app language and no corner list (what app.js sends today): 62 / 12 / **0**. The original `quickread.js` (`439e868`) on the same 74: 17 / 14 / **43**.
  - `--hostile`: 1 dangerous (`es-typos`, as before). `--hostile-details`: 0.
  - `npm run jev-eval -- --local`: 133/138 (96%), unchanged.
  - A new test caught plural lake names ("Quarry Lakes") being missed, which would have pinned the wrong lake; fixed.
- **Known issues / not done:**
  - **The screen shows no flags, unsure highlights or corners yet:** see "Screen work" in the contract.
  - **Bug found (predates this work):** `openSightingForm` puts `0` minutes when the time is unknown, so the form says "just now".
  - The language guess is word counting; a two-word report in no clear language falls back to the app's language.
  - Jev's own dangerous rate still needs the TypeSafe key.
- **Next:** the `app.js` session applies "Screen work". With the key, `npm run safety-eval` through Jev.

### Uncommitted
- `bench/blind-cases.json`: 120 blind test reports (en 40, es 22, fr 18, zh 20, ja 20) for the report box, written without reading `quickread.js`, `report.js` or `proxy/`. Each has the expected kind, place, direction, minutes and reliability, other acceptable values, and how dangerous a wrong reading would be (high/medium/low) with the reason. No scorer uses it yet.

### Report box safety layer and agent contract
- **Date:** 2026-11-22
- **Stage:** Finishing (safety), branch `agent-contract` (Nathan), worked on in its own worktree while `prior-v2` rewrites the engine
- **What changed:**
  - `docs/AGENT-CONTRACT.md` (new): the contract between an AI agent and the intelligence layer. Principle: the agent reads and proposes; only a confirmed, schema-valid event changes the map. Versioned schemas (`CaseInput` 1, `CaseDraft` 1, `ReportDraft` 2, `Event` 1, `AgentReply` 1); the functions `caseGaps` (ranked by how much each answer would change the map: mean total-variation distance over the possible answers, with fixed question codes), `validateCase`, `validateClue`, `proposeClue` (a preview, nothing written), `myAssignment`, `explain` (reason codes only); the exact sentences the agent says when it abstains; and what is built vs. proposed.
  - `report.js`: `ReportDraft` v2. `validateDraft` keeps the optional `unsure` (fields the reader wasn't sure about) and `flags` (`emergency`, `water`, `vehicle`, `conflict`, `guess`, `other_person`, `joke`) lists, known codes only, left out when empty; a place / direction / time marked unsure is always emptied. New `confineDraft`, used by `parseReport`: the note is always the person's own words, and the place must be one of the names the phone sent, pinned at that place's own point, so a proxy answer can't carry any text of its own.
  - `quickread.js` (the backup reader): `readSignals` finds water, vehicle, emergency, someone else, joke and guess words in all 5 languages, plus conflicts (two places, two directions, two times, "definitely" + "not sure"). `readLocally` leaves conflicting fields empty and lists them in `unsure`, turns jokes and sightings of someone else into messages, and adds `flags`. Also: "I see him", "definitely him", "lo veo", "je le vois" count as sightings; "je ne le trouve nulle part" no longer reads as "found".
  - `proxy/jev.js`: `safeJevDraft`, now used by `proxy/worker.js`. An answer that isn't one of the options counts as no answer; a close call between Jev's top two options (`MIN_MARGIN` 0.15) or a soft disagreement with the word rules costs `CONFLICT_PENALTY` (0.25) of confidence; two answers in the report, or the two readers disagreeing about a place / direction / time (or sighting vs searched), leave the field empty; Jev's place, direction and time need words of that kind in the report ("interpret, don't invent"), and "certain" needs certain words; a joke, someone else, or (with no "saw" words) a guess, "he took the car" or "I can't find him" is never a sighting. The `kind` question's wording now says guesses, jokes and other people are messages. `jevToDraft` (Jev alone) now lists its below-`MIN_CONFIDENCE` fields in `unsure`.
  - `bench/safety-cases.json` (new): 59 adversarial reports (20 en, 11 es, 10 fr, 9 zh, 9 ja) with expected outcomes. `bench/safety-eval.js` (new, `npm run safety-eval`): scores each as right / abstained / dangerous; `--local`, `--hostile`, `--hostile-details`, or Jev through the proxy. Exits 1 if anything is dangerous.
  - `tests/safety.test.js` (new, 24 tests). `sw.js` cache v28 → v29. Notes in `PLAN.md`, `NATHAN.md`, `README.md`, `proxy/README.md`.
- **Why:** Nathan's request: the AI agent is an intermediary assumed to be unreliable; it never sets probabilities or gives search advice; accuracy beats latency because wrong advice can cost a life.
- **Decisions:**
  - **No new Jev questions.** The safety checks are deterministic word rules shared by both readers, so they never depend on the AI being right. (Adding Jev questions for water / vehicle would also have changed the question list that `tests/jev.test.js` checks.) Only the wording of the `kind` options changed.
  - **Disagreement empties a field instead of picking a winner.** For reliability the lower one wins.
  - **"message" from the word rules isn't a vote,** because it's what they say when they find nothing.
  - **Flags are codes, shown by the screen** (sentences proposed in the contract). The flags only add caution and never change the map.
  - Not changed: `INTERFACES.md`, which needs BenStew's OK (the contract lists what to add), and `app.js` / `i18n.js`, which are BenStew's and would need the flag sentences in all 5 languages.
  - `engine/`, `data.js` and `tests/fixtures/` were not touched (prior v2 is being rewritten on another branch).
- **How it was verified:**
  - `node --test`: 97 pass, 0 fail (the 73 existing tests unchanged, plus 24 new).
  - `npm run safety-eval -- --local`: 55 right, 4 abstained, **0 dangerous**. The same scorer on `quickread.js` as it was at `439e868`: 16 right, 8 abstained, **35 dangerous**.
  - `--hostile` (a fake Jev that is confidently wrong on everything): 1 dangerous, `es-typos`. Every word is misspelled, so nothing contradicts Jev's "searched".
  - `--hostile-details` (right kind, invented details): 0 dangerous.
  - A perfect Jev answer set on `bench/jev-cases.json` keeps 137/138 fields through the layer (tested ≥ 95%).
  - `npm run jev-eval -- --local`: 96%, up from 95%, with wrong answers down from 3 to 2. One place is now left empty: "on Paseo Padre … toward the BART station" names two places.
- **Known issues / not done:**
  - **Jev's own dangerous rate is not measured yet:** the TypeSafe key is still missing.
  - The screen doesn't show `flags` or highlight `unsure` fields yet.
  - The word rules over-flag a little:
    - French "car" ("because") reads as a vehicle;
    - any "lake" or "creek" in a report gets the water flag;
    - an intersection ("Walnut and Paseo Padre") counts as two places and is left empty.
  - The test set was written alongside the rules, so it is not a held-out test. Reports written by someone else are needed.
  - `caseGaps`, `validateCase`, `proposeClue`, `myAssignment` and `explain` are specified, not built.
- **Next:** with the key in, `npm run safety-eval` through Jev, recording its dangerous count. BenStew: show the flags in the form (`i18n.js`, 5 languages), then fold `ReportDraft` v2 into `INTERFACES.md`.

### Prior v2, stage 1: design note
- **Date:** 2026-11-22
- **Stage:** Prior v2 (branch `prior-v2`, Nathan), stage 1 of 4
- **What changed:** New `docs/PRIOR-V2.md`: what is wrong with the current prior (from Nathan's audit of `main`), the design of its replacement (10 m ground map, walkers stored as per-minute particles with their own speed / time moving / behavior, a map for "t minutes since last seen" with "still missing" evidence, a blend with an ISRID statistics map, an explicit "rest of world" share, a separate hazard layer, calibration and evaluation), the published numbers it uses, and the contract changes it will need.
- **Why:** Nathan asked for the prior to be replaced with one as close to a real search team's method as the data allows, built in four committed stages on a branch, starting with a short design note.
- **Decisions:**
  - Urban ISRID dementia row for Fremont, temperate as the alternative.
  - **Elevation is skipped**: the urban row has no elevation statistic, the test area is flat, and terrain tiles would add a download to the first minutes of a search.
  - The grid will be anchored to the case (its last-seen point, rounded), not to each phone's download.
  - `grid.p` will sum to `1 − restOfWorld` rather than 1. This and the new optional fields change `INTERFACES.md`, so they need BenStew's OK before any merge.
  - Every tunable constant is labeled DATA, EXPERT or ASSUMPTION with its source.
- **How it was verified:** Each ISRID number was read from Koester's dementia chapter (the PDF's text, extracted on the laptop): all matched, and the urban find-location row also lists linear 9, woods 3 and brush 1, which makes it sum to 100. Rowe 2011 was read in full: 53% of walkers within 1 mile is right, but "those found dead were mostly within 0.5 mile" is really **50%**. The gait-speed figure (0.62 ± 0.23 m/s, n = 309) is Toots et al. 2019. Sava et al.'s R formula and the 0.78 for rings were confirmed from the authors' preprint and the published abstract.
- **Known issues / not done:** No engine code changed yet. No urban sweep width was found in the literature, so the search-coverage constants remain assumptions.
- **Next:** Stage 2: the ground map, the new walkers, and time conditioning.

### PLAN.md: tonight's test pass noted
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `PLAN.md` status lists the browser test pass and points to the "Testing pass" entries.
- **Why:** So the plan shows what was checked.
- **Decisions:** None.
- **How it was verified:** Final checks in this pass: offline (simulated in the page) the Demo ran in 0.5 s, the backup reader filled "saw her 10 min ago walking west" as 10 min / West, map search and sharing explained there's no internet and the share link still worked; a Japanese hand-off sheet included the English copy with the same times.
- **Known issues / not done:** Still not tried on real phones (voice with a real mic, two phones sharing, GPS dots). Not pushed.
- **Next:** Push after BenStew's OK.

### Testing pass 7: bigger map zoom buttons
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `style.css`: Leaflet's zoom + and − are 44×44 px (were 30×30), the same as the location and search buttons below them. `sw.js` `v27` → `v28`.
- **Why:** A tap-target scan at phone size (every visible button, link, input and summary, with all sections open) found only these under 44 px, apart from the map credits and the numbered markers (the same places are buttons in the list).
- **Decisions:** None.
- **How it was verified:** Browser pane at 375×812: zoom buttons 44×44; the four map controls stack without overlap (right edge 58 px) and the blue tap bar still starts at 62 px.
- **Known issues / not done:** Not pushed.
- **Next:** Push after BenStew's OK.

### Testing pass 6: the Demo's details no longer leak into a real search
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `app.js`: `runDemo()` sets `state.fromDemo`; when a new last-seen point is placed after a Demo, `clearDemoDetails()` empties the minutes, sets the direction to unknown and the pace to normal, removes the Demo's familiar place (Lake Elizabeth), and shows "The Demo's details were cleared. Enter what you know about your person." `i18n.js`: `demoCleared` in 5 languages. `sw.js` `v26` → `v27`.
- **Why:** Found while testing a brand-new area (Palo Alto City Hall, live download in 35 s): the result's top spot was "89% chance", and the hand-off sheet showed why: the search had silently kept the Demo's "Slowly", "Northeast" and a familiar place in Fremont, 25 km away. Trying the Demo and then starting a real search is a likely real path.
- **Decisions:** Only Demo details are cleared; a real case's details are kept when the last-seen point is moved (people often just correct the point). Not changed: the engine itself. With "Slowly" + "Northeast" for 15 minutes in downtown Palo Alto it puts 85% of the chance in one spot (48% with no direction; 19% at normal pace with no direction). That's the walkers following the model with those inputs, but it's very concentrated and worth a look after the deadline.
- **How it was verified:** Browser pane: Demo (45 min, NE, slowly, 1 familiar place) → set a new last-seen point → minutes empty, direction Unknown, pace Normal, no familiar places, the status message shown. Engine run in the page on the downloaded Palo Alto streets confirmed the 85–88% came from the carried-over inputs. `node --test` 73/73. Also in this session: a share link made 12 minutes earlier opened at 55 minutes (45 + 10); a first visit with cleared storage opened cleanly.
- **Known issues / not done:** Not pushed.
- **Next:** Push after BenStew's OK; real-phone tests.

### Testing pass 5: message drafts don't say "check every field"
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `app.js` `readReport()`: when a report turns out to be a plain message, the status is just "Your message is ready below. Check it, then tap Send.", without the backup reader's "Check every field" sentence (a message has no fields). `sw.js` `v25` → `v26`.
- **Why:** Seen while testing the report box's three paths.
- **Decisions:** None.
- **How it was verified:** Browser pane: "Checked the Fremont Central Park playground, nobody there" → the "open its area under Next areas" hint; "Has anyone checked the library on Stevenson?" → put in the message box. No app errors in the console for the whole session (only the expected network errors while the test database was stopped). Laptop size 1280×800 with results and folded steps: page exactly 800 px, only the panel scrolls, no sideways scroll.
- **Known issues / not done:** Not pushed.
- **Next:** First-visit check.

### Testing pass 4: honest messages when the database drops out
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:**
  - `app.js` `joinFromLink()`: if the database can't be reached when a share link is opened, the app now ends on "Couldn't reach the shared search. Showing the map from the link." It used to show that message and then immediately cover it with "You joined a shared search.", although the map had none of the others' updates yet.
  - `sync.js` `subscribe()`: after the waiting updates are sent (on reconnect), the status is reported again, so the screen's waiting count goes away. Before, it kept saying "1 updates waiting for signal" after they'd been sent.
  - `i18n.js`: the waiting count reads "Updates waiting for signal: 1." in English, Spanish and French (no more "1 updates"); Chinese and Japanese have no plural problem and are unchanged.
  - `sw.js` `v23` → `v25`.
- **Why:** Found by stopping `tools/mock-firebase.py` in the middle of a shared search during BenStew's requested test session.
- **Decisions:** The map from the link plus the live stream filling in on reconnect is kept as is (it already self-heals); only the messages were wrong.
- **How it was verified:** Browser pane: database stopped, shared link reloaded: "Reconnecting…" and "Couldn't reach the shared search…". Marked Area B searched: "Updates waiting for signal: 1." Database restarted: within a few seconds the status went back to "Shared live: everyone with the link sees the same map." with no count, and the event was in the database. `node --test` 73/73.
- **Known issues / not done:** Not pushed.
- **Next:** Laptop size and a last look.

### Testing pass 3: spots show their chance now, not "% of walkers"
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `app.js`: each "Check these first" spot shows its current chance with the areas' wording ("45% chance they are here", from `spot.probability`) instead of "x% of walkers" (`walkerShare`). `i18n.js`: the now-unused `spotShare` removed from all 5 languages. `README.md` and `INTERFACES.md` examples updated. `sw.js` `v22` → `v23`.
- **Why:** Found in a two-tab shared-search test: after a sighting the #1 spot read "Near Davis Street – 0% of walkers" (the first walkers never went there; the sighting did), which a family would read as "0% chance". The walker share also never changes after a search. The chance follows both, and it's the number the hand-off sheet already shows.
- **Decisions:** Reused the existing `areaChance` text, so no new translations. Kept `walkerShare` in the engine's `Spot` (tests use it), just not shown.
- **How it was verified:** Two tabs on `tools/mock-firebase.py`: tab A ran the Demo, shared, marked Area A searched (→ 21%) and sent "Checking the lake path now"; tab B opened the link and showed the same areas and the message; tab B typed "Saw him 5 minutes ago near Stevenson Boulevard heading north, pretty sure" → backup reader filled 5 min, N → added; tab A's map updated to the same numbers within a second. After the change, spots read "Near Davis Street – 45% chance they are here", "… 8%", "… 6%". A full reload of the shared link rebuilt the same map from the database. `node --test` 73/73.
- **Known issues / not done:** Not pushed. (Not a bug: opening the same link again in a tab only changes the `#` part, so the page doesn't reload or update; a real reload does.)
- **Next:** Offline and laptop checks.

### Testing pass 2: "Check these first" always runs from most to least likely
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `engine/grid.js` `topSpots()`: spots are still picked by their single best square (same places, same spacing), but now sorted by the total chance around each before returning. `tests/engine.test.js`: new test that spots come out in descending order at 45, 55 and 90 minutes. `sw.js` `v21` → `v22`.
- **Why:** Found while testing: after the map aged to 55 minutes, the Demo listed "1. … 15%" above "2. … 17%", and the hand-off sheet had "7. … 0%" above "8. … 1%". The list was ordered by each spot's peak square, but shows the total around it.
- **Decisions:** Sort, rather than change how spots are chosen, so the places themselves don't move. `bench/benchmark.js` doesn't use `topSpots`, so the benchmark numbers are unaffected and weren't re-run.
- **How it was verified:** Before: Demo at 55 min gave totals 15.8, 16.2, 6.1, 7.2… After: descending. `node --test` 73/73. Also checked all 5 languages at phone width (no untranslated, empty or overflowing text in the panel, banner or legend; spots, areas, recap and status switch language).
- **Known issues / not done:** Not pushed.
- **Next:** Shared search with two tabs; offline.

### Testing pass 1: hand-off time after the map ages, step numbers, search names
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:**
  - `app.js` hand-off sheet: "Last seen … about 8:35 PM (45 min before the search started)" now uses `state.minutesAt − minutes`. It used `search start − minutes`, which became wrong once the minutes field started going up every 5 minutes (after 10 minutes it would have moved the last-seen time 10 minutes earlier).
  - `app.js` map search: new `shortPlaceParts()` drops lone numbers from a result's address, so a familiar place picked by search is "Lake Elizabeth, Fremont", not "Lake Elizabeth, 40000"; a house number at the start stays with its street ("40000 Paseo Padre Parkway").
  - `style.css`: the "What you know" steps are numbered 3–7, continuing after "First steps" (1. Call 911, 2. Check the house), instead of a second "1.".
  - `sw.js` `v20` → `v21`.
- **Why:** BenStew asked for a 30-minute test of the app; these came out of walking through it at phone size.
- **Decisions:** Top spots keep showing "% of walkers" after a search: by design (`INTERFACES.md`: `walkerShare` is the share of base walkers); the area chances are what drop.
- **How it was verified:** Browser pane, 375×812: tapped the map for the last-seen point; Find with no minutes opened the steps and focused the field; arrow keys turned the direction to East; familiar place via the blue bar's search; Find (saved streets, 1 s) folded the steps; "Searched, nobody found" on Area A moved it 46% → 37%. Hand-off sheet after moving the clock 11 minutes ahead (minutes 45 → 55): still "about 8:35 PM (45 min before the search started)". Steps read 3, 4, 5… `node --test` 72/72.
- **Known issues / not done:** Not pushed.
- **Next:** Languages, shared search, offline.

### Numbered "What you know" steps that fold up; map redraws every 5 minutes
- **Date:** 2026-11-21
- **Stage:** Finishing (UI feedback)
- **What changed:**
  - `index.html`: the inputs (last seen, minutes, direction, how they walk, familiar places, Find) are wrapped in `<details id="case-inputs">` with the title "What you know about them" and a one-line recap. Each step's heading has class `step`.
  - `style.css`: a CSS counter numbers the `step` headings "1." to "5." (no new text needed in any language). The recap only shows while folded.
  - `app.js`: after a successful Find (or Demo, or joining a link), the steps fold up and `renderCaseRecap()` shows "Seen 45 min ago · Northeast · Slowly. Tap to change." They open again when the person needs them (setting the last-seen point or a familiar place, or minutes missing). **Time-aware map:** `state.minutesAt` is the moment the minutes value was true (set when Find is tapped). Every 30 s `onClockTick()` checks whether 5 minutes have passed; if so, `ageMinutes()` adds 5 per step to the minutes field, moves `minutesAt` forward, and `recompute()` redraws the map, with a status line "Map updated: it's now about 50 minutes since they were last seen." Constants `TIME_STEP_MIN` (5), `CLOCK_CHECK_MS` (30 s), `MAX_MINUTES` (1440). In a shared search the case in Firebase and the share link carry `minutesAt` (link field `t`), joiners count from it (older links: from `startedAt`), and re-runs keep the clock, so every phone redraws at the same 5-minute steps with the same numbers.
  - `i18n.js`: `caseInputsTitle`, `caseRecap`, `mapAged` in 5 languages. `sw.js` `v19` → `v20`.
  - Docs: `README.md` (steps fold; the map keeps up with time; the limit is now "up to 5 minutes behind"), `ShortPlan.md` step 7, `ROADMAP.md` (time-aware map removed: it's built), `INTERFACES.md` known limits (`minutesAt`), `PLAN.md`, Project context.
- **Why:** BenStew: "make this collapsible, once you enter it. Also keep redoing the map every 5 minutes", and "number the steps inside the collapsible area".
- **Decisions:** The time-aware map was a roadmap item; BenStew asked for it directly, so it's moved off the roadmap. Done in the screen, not as a new event type: the engine is unchanged, and phones stay in step because they share `minutesAt` (`INTERFACES.md` said a new event type would be needed; a shared start time turned out to be enough). Steps of 5 minutes rather than every minute, so the map doesn't redraw constantly. The numbers come from CSS, so the five languages' text didn't change.
- **How it was verified:** `node --test`: 72/72. Browser pane: the five headings show "1." to "5."; open before the Demo, folded after with "Seen 45 min ago · Northeast · Slowly. Tap to change."; with the page clock moved 6 minutes ahead, within 30 s the minutes went 45 → 50, the recap and status updated, and the top-spot chances changed (Stevenson Common 18% → 17%, Fitzsimmons Common 5% → 8%).
- **Known issues / not done:** Two phones redrawing in step wasn't tried with real phones. Phones whose clocks disagree may redraw a few seconds apart. Not pushed yet.
- **Next:** Push; video script and Devpost write-up.

### Docs check: every .md file matches what's live
- **Date:** 2026-11-21
- **Stage:** Finishing (docs)
- **What changed:**
  - `README.md`: the status line no longer says the proxy still needs deploying (it's live, with the voice keys; the TypeSafe key is still to come, and the backup word rules fill in until then; real-phone voice and two-phone sharing not yet tried). Limits: searcher positions and names go to Firebase and are visible to anyone with the link (shown as dots, overwritten, no trail); the backup reader sends nothing; Firefox voice works only through Deepgram; Deepgram tested with a recorded sentence, not a real phone mic.
  - `PLAN.md`: status says the searcher-dot rules are published and tested, the proxy has both voice keys, and the laptop layout is fixed; "Left" now lists the green dots in the phone test, Jev scoring, and the video script and Devpost write-up (not started) before filming.
  - `proxy/README.md`: deploy step for registering the workers.dev subdomain; our live address; what happens without the TypeSafe key (`500 no_key` → the app's backup reader); `GET /voice` added to the allowed methods.
  - `CLAUDE.md`: Firebase also holds each searcher's latest position; `quickread.js` fills the draft when Jev can't answer.
  - `CommitHistory.md` "Project context": Leaflet.heat marked removed; the Worker bullet says where it's deployed and what's missing; Firebase rules note the `searchers/` addition.
  - `ShortPlan.md`: trimmed from 674 to 660 words, and mentions searcher positions among the online parts and English-only read-back.
- **Why:** BenStew asked to check that all .md files are up to date before pushing.
- **Decisions:** Old Log entries left as they are (the rules say add, don't rewrite). Checked and left unchanged: `INTERFACES.md`, `ROADMAP.md` (nothing on it got built; GPS-trail coverage is still roadmap), `NATHAN.md`, `bench/results.md` (engine unchanged, so the benchmark numbers stand).
- **How it was verified:** Searched every .md for stale terms (Leaflet.heat, old test counts, "still needs", placeholder proxy addresses, old status lines) and compared against the code and the live proxy/database.
- **Known issues / not done:** `ShortPlan.md` is still a bit over its ~600-word target (660).
- **Next:** Push; video script and Devpost write-up.

### NATHAN.md brought up to date
- **Date:** 2026-11-21
- **Stage:** Finishing (testing)
- **What changed:** `NATHAN.md`: step 1 uses the real proxy address and says only `TYPESAFE_API_KEY` is missing (the backup word rules fill in drafts until then); step 3 adds phone checks for the location prompt and green searcher dots, the report box without Jev, and the laptop layout; step 5 says 72 tests and lists tonight's new test and bench files.
- **Why:** BenStew asked whether NATHAN.md was updated; only step 2 had been.
- **Decisions:** None.
- **How it was verified:** Read through; docs only.
- **Known issues / not done:** None.
- **Next:** Video script and Devpost write-up.

### Report box backup reader on the phone, plus a 40-report scorer for Jev
- **Date:** 2026-11-21
- **Stage:** Finishing (part 1 of the team plan: everything that doesn't need the TypeSafe key)
- **What changed:**
  - New `quickread.js`: `readLocally(text, { places })` returns the same `ReportDraft` as the proxy, using word rules in en/es/fr/zh/ja: kind (questions → message, "nobody"/"didn't see"/"nadie"/"没人"/"いなかった" → searched, "saw"/"vi"/"vu"/"看到"/"見かけ" → sighting, "searched"/"revisamos" → searched, else message), minutes (digits or number words before a minutes word, "half an hour", "quart d'heure", "刚才", "さっき"…), direction (only after a "heading" word, so "East Plaza" and Spanish "este" = "this" aren't directions), reliability (unsure 0.3 → "I think" 0.6 → certain 0.9, with "not sure" checked before "sure" and French "sur" = "on" not read as "sûr"), and the longest nearby place name in the text (street suffix optional: "Paseo Padre" → Paseo Padre Parkway). Direction and minutes are only filled for sightings.
  - `app.js` `readReport()`: when `report.parseReport` fails for any reason (offline, no proxy, no key, error), the draft comes from `readLocally` (checked by `validateDraft`) and a status line says it was filled in on the phone with simple word rules and to check every field. The old "use the form instead" messages stay only as a last resort.
  - New `bench/jev-cases.json` (40 reports: 10 en, 8 es, 8 fr, 7 zh, 7 ja, with expected kind/direction/minutes/place/reliability, Fremont place names) and `bench/jev-eval.js` (`npm run jev-eval`): scores either the backup reader (`--local`) or Jev through the live proxy (default) or another proxy (`--proxy <url>`), field by field as right / left empty / wrong, with minutes compared by Jev's buckets; waits 3.2 s between proxy calls for the rate limit; stops with a clear message if the proxy has no TypeSafe key.
  - New `tests/quickread.test.js` (7 tests). `i18n.js`: `reportReadOnPhone` in 5 languages. `sw.js`: `quickread.js` added to the offline files, `v18` → `v19`. `package.json`: `jev-eval` script.
  - Docs: `README.md` (report box fallback, files table, scoring), `NATHAN.md` item 2 (run the scorer once the key is in), `INTERFACES.md` §5, `ShortPlan.md` (report box works without Jev), `PLAN.md`, `CLAUDE.md` (file list).
- **Why:** BenStew asked to do part 1 of the team plan (engine + Jev) "everything but what requires jev api key". The engine items were already done; Jev tuning needs the key. This makes the report box useful now (and offline), and turns Nathan's tuning into one command once the key arrives.
- **Decisions:** Word rules, not another AI: they run offline, cost nothing, and are easy to explain. They leave a field empty rather than guess, like Jev's `MIN_CONFIDENCE`. Rejected: tuning the rules until every test case passes, since the test set and rules were written together (that would only make the number look better); the 3 remaining kind misses ("Definitely him", "Peut-être elle", "たぶん彼女だと思う": no "saw" word) are left as honest misses.
- **How it was verified:** `npm run jev-eval -- --local`: 131/138 fields right (95%): kind 37/40, direction 21/22, minutes 20/22, place 31/32, reliability 22/22; en 89%, es 100%, fr 92%, zh 100%, ja 96%. Found and fixed a real bug on the way: stripping accents (NFD) split Japanese voiced kana, so "たぶん" didn't match; now re-joined with NFC. `npm run jev-eval` against the live proxy stops with "the proxy has no TYPESAFE_API_KEY yet"; against `tools/mock-proxy.py` it runs all 40 (52%, as expected for its English-only rules). `node --test`: 72/72. Browser pane (localhost, so the live proxy refuses it): Demo → report "I saw him 10 minutes ago on Stevenson Boulevard walking north, definitely him, gray jacket" → sighting form with 10 min, N, "definitely" level, the note, the pin on Stevenson Boulevard, and the "filled in on this phone" status.
- **Known issues / not done:** The 95% is on reports written together with the rules; real reports will score lower. Jev itself is still unscored (no key). Not pushed yet.
- **Next:** Nathan gets the key and runs `npm run jev-eval -- --show`.

### Searchers see each other on the map; location asked on start; loading bar clear of search
- **Date:** 2026-11-21
- **Stage:** Finishing (quality check)
- **What changed:**
  - `app.js`: the app asks for the phone's location as soon as it opens (`startLocation({ auto: true })`) instead of only when the ◎ button is pressed. The first fix flies the map there only if nothing is on the map yet (no last-seen point, no shared link). If the person says no, the app stays quiet; the ◎ button then asks again and shows the "location off" message. The ◎ button now re-centers on me instead of turning location off. In a shared search, `shareMyPosition()` sends my position to Firebase right away on joining/starting, then every 30 s or after moving 25 m (at least 5 s apart); not queued offline. `renderSearchers()` draws the others as green dots with a permanent label "Name (now)" / "Name (8 min ago)", faded after 5 min, hidden after 15 min (`SEARCHER_STALE_MIN`), refreshed every minute. A per-phone random `searcherId` (16 hex) is kept in localStorage. Changing your name re-sends the position. New constants `POSITION_SEND_MS`, `POSITION_MOVE_M`, `SEARCHER_STALE_MIN`.
  - `sync.js`: `setSearcherPosition()` (PUT to `searches/<id>/searchers/<searcherId>`, lat/lng rounded to 5 decimals ≈ 1 m), `newSearcherId()`; `subscribe()` now also passes `searchers` to `onChange`.
  - `firebase-rules.json`: new `searchers/$searcherId` rule (id must be 16 hex; lat, lng, at numbers; name ≤ 40 chars).
  - `style.css`: while the map search box is open (`#map-wrap.searching`), the loading bar moves to the bottom of the map; it used to sit exactly under the search box. Styles for the searcher labels and a teal legend swatch.
  - `index.html`: legend line "Other searchers (now)"; a note under "Your name" that others see your location while searching together. `i18n.js`: `legendSearchers`, `searcherNoName`, `searcherNow`, `searcherAgo`, `locationSharedNote` in all 5 languages. `sw.js` `v17` → `v18`.
  - Docs: `INTERFACES.md` §6 (the new `searchers` path; positions are the one thing that's overwritten, and the engine never sees them), `README.md` (feature + rules list), `ShortPlan.md` step 5, `PLAN.md` status. `tests/sync.test.js`: one new test.
- **Why:** BenStew: "search bar covers the search Prediction progress bar" and "ask for location right away so we know where all searchers are".
- **Decisions:** Positions are display-only: they don't mark areas as searched (that would be the roadmap's "coverage from GPS trails", not built). The location prompt on open is what BenStew asked for; the app still works fully if it's refused. Positions overwrite one entry per phone rather than adding events, so the database doesn't fill with a trail. Rejected: queuing positions offline (stale positions mislead).
- **How it was verified:** `node --test`: 65/65. Browser pane with `tools/mock-firebase.py` (`?db=`): with location blocked, no error appeared on open; with a faked GPS position, ◎ showed pressed, Demo + Share wrote `searchers/<id>` = {lat 37.5535, lng -121.9705, name "Ben"}; three fake searchers added with curl showed as "Nathan (now)" and "Searcher (8 min ago)", and the 40-minute-old one was hidden. With the loading bar shown and the search box open, they no longer overlap (box bottom 130 px, bar top 329 px).
- **Known issues / not done:** **The live database needs the new rules:** until BenStew pastes `firebase-rules.json` into Firebase → Realtime Database → Rules → Publish, position writes are refused (the rest of sharing works as before). On a phone the legend can cover dots until it's folded. Not tested on a real phone (iPhone asks for location on open).
- **Next:** Publish the rules; test with two real phones.

### Laptop layout: the page no longer scrolls, only the side panel does
- **Date:** 2026-11-21
- **Stage:** Finishing (quality check)
- **What changed:** `style.css`, wide-screen layout (900 px and up): the body grid's second row is `minmax(0, 1fr)` instead of `1fr`, and `#panel` gets `min-height: 0`. The phone-only "shorter panel while tapping the map" rule (`body.picking #panel { max-height: 38dvh }`) is now cancelled on wide screens. `sw.js` cache `v16` → `v17`.
- **Why:** BenStew reported that on a laptop the whole page scrolled. A plain `1fr` grid row grows to fit its content, so the side panel's full list (1,900 px) stretched the page to about 1,950 px in an 850 px window: the map and banner scrolled away with it. Separately, the phone rule shrank the laptop side panel to 38% of the height while tapping the map.
- **Decisions:** Fixed in CSS only; the phone layout (flex column) is untouched.
- **How it was verified:** Browser pane at 1440×850: page height 850 (was 1,952), panel 798 px with its own scroll, the same while tapping the map. At 375×812 (phone): page 812, panel 447 → 309 px while tapping, as before.
- **Known issues / not done:** Not checked in Safari or Firefox on a laptop.
- **Next:** Push, then check the live site on BenStew's laptop.

### Proxy deployed: PROXY_URL points at the live Worker
- **Date:** 2026-11-21
- **Stage:** Finishing (deploy and testing)
- **What changed:** `config.js` `PROXY_URL` is now `https://findthem-proxy.findthem-evohacks.workers.dev`, the deployed Cloudflare Worker (`proxy/`). `sw.js` cache `v15` → `v16` so phones pick up the new config. `PLAN.md` "Left" item 2 updated.
- **Why:** Finishing hosting (part 4 of the team plan) so the voice bot and the report box work on the live site.
- **Decisions:** BenStew signed in with `npx wrangler login`, saved `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` as Worker secrets himself (keys never seen by the AI or written to the repo), and registered the account's workers.dev subdomain `findthem-evohacks`. `ALLOWED_ORIGIN` stays `https://donaldstewart4.github.io`, so only the live site can call it (localhost testing still uses `?proxy=` with the mock).
- **How it was verified:** Against the live Worker with curl: `GET /voice` → `{"listen":true,"speak":true}`; another Origin → 403; `POST /listen` with a sentence spoken by macOS `say` → Deepgram returned it word for word; `POST /speak` in English → 7.7 KB `audio/mpeg`; in Spanish → 400 `unsupported_language`; `POST /` → 500 `no_key` (expected, no TypeSafe key yet). `node --test` passes.
- **Known issues / not done:** `TYPESAFE_API_KEY` isn't set yet (Nathan is getting it, `NATHAN.md` item 1). Until then `POST /` returns 500 `no_key`, so a typed or spoken report shows "Couldn't read that report. Use the form instead." with the form; the form, voice input and read-back are unaffected. Not yet tried on a real phone with a real microphone.
- **Next:** Nathan adds the TypeSafe key; BenStew tries voice on his iPhone.

### Add NATHAN.md: Nathan's to-do list
- **Date:** 2026-11-21
- **Stage:** Finishing (deploy and testing)
- **What changed:** New `NATHAN.md` lists what BenStew would like Nathan to do before the freeze, in order: (1) get the TypeSafe AI API key and put it into the Cloudflare Worker as the `TYPESAFE_API_KEY` secret, with a curl check; (2) tune the Jev questions in `proxy/jev.js` and `MIN_CONFIDENCE` with real reports in all 5 languages; (3) two-phone tests (sharing, real-mic voice, English-only read-back, airplane mode, the direction arrow, Demo speed); (4) a UI review; (5) keep `node --test` green, add tests for bugs found, re-run the benchmark only if the engine changes. `PLAN.md` "Left" now says Nathan gets the TypeSafe key and points to `NATHAN.md`; its test count is corrected from 48 to 64. `CLAUDE.md` "Read first" lists `NATHAN.md`.
- **Why:** BenStew doesn't have a TypeSafe key, so getting one moves to Nathan; BenStew asked for one file with everything Nathan should do.
- **Decisions:** The key itself is never written anywhere in the repo. The preferred hand-off is BenStew adding Nathan as a member of the Cloudflare account so Nathan runs `wrangler secret put` himself; the fallback is handing it over in person or via a password manager share. Not chat, screenshots or `config.js`.
- **How it was verified:** Checked the curl body against `proxy/worker.js` (`text`, `lang`, `context`). Docs only; no app files changed, so no cache bump.
- **Known issues / not done:** No TypeSafe key yet, so the real Jev path is still untested.
- **Next:** Nathan gets the key; BenStew finishes the other Worker secrets, deploys, and sends the Worker URL for `PROXY_URL` in `config.js`.


### ElevenLabs read-back is English only

- **Date:** 2026-11-21
- **Stage:** Screen + proxy (BenStew)
- **Decision change:** BenStew: "Make sure 11 Labs is only working if it's in English." The voice bot's spoken read-back now happens only when the app is in English. Deepgram voice input still works in all 5 languages.
- **What changed:**
  - `report.js`: `SPEAK_LANGS = ['en']`, `canSpeak(lang)`; `speak()` returns without any request outside English.
  - `app.js`: the read-back and the iPhone audio unlock only run when `canSpeak(i18n.getLanguage())`.
  - `proxy/voice.js` + `proxy/worker.js`: `POST /speak` refuses any `lang` other than `en` with `400 unsupported_language` **before** calling ElevenLabs (no cost even if something else calls it). `language_code` is only ever `en`.
  - `tests/voice.test.js`: the ElevenLabs request test now uses English; new tests: es/fr/zh/ja/empty/missing `lang` → 400 with ElevenLabs never called; the app's `speak()` makes no request in Spanish or Japanese.
  - The non-English read-back sentences stay in `i18n.js` (unused for now) so every language keeps the same keys.
  - Docs: README, `proxy/README.md`, `INTERFACES.md` §5, `CLAUDE.md`, this file's Project context. `sw.js` v15.
- **How it was verified:** `node --test` 64/64.

### Phone map space: bigger map while placing, foldable legend

- **Date:** 2026-11-21
- **Stage:** Screen (BenStew)
- **What changed:**
  - While the map waits for a tap (last-seen point, familiar place, sighting, home), `body.picking` shortens the bottom panel to 38% of the screen (from 55%), so there's more map to tap; the map resizes back afterwards (`renderModeUI` calls `map.invalidateSize`). At 375×812 the map goes from 313 px to 451 px tall.
  - The legend ("Chance they are inside") folds to its title with a tap and opens again with another (▾ / ▸). It's a focusable button (Enter/Space) with `aria-expanded`.
  - `sw.js` v14.
- **Why:** on a phone the map is short, and the legend, the blue bar and the map buttons covered much of it.
- **How it was verified:** `node --test` 62/62; built-in browser at 375×812: map height 313 → 451 px when "Add a familiar place" is tapped; the legend folded on tap.

### Voice bot: Deepgram speech-to-text and ElevenLabs read-back through the proxy, with fallback

- **Date:** 2026-11-21
- **Stage:** Screen + proxy (BenStew)
- **Decision change:** BenStew asked for "a voice bot to work with ElevenLabs and Deepgram… make them env variables… if API keys aren't in, the voice mode reverts to the way it is right now". The Worker now also holds two optional keys (Project context updated). Jev still fills the form; Deepgram and ElevenLabs only convert speech ↔ text, and nothing reaches the map until the person confirms.
- **What changed:**
  - `proxy/voice.js` (new): request builders for **Deepgram** (`POST https://api.deepgram.com/v1/listen?model=nova-3&language=…&smart_format=true`, `Authorization: Token …`; languages en/es/fr/zh-CN/ja) and **ElevenLabs** (`POST https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_22050_32`, `xi-api-key`, model `eleven_flash_v2_5`, `language_code`, `apply_text_normalization: on`). Default voice `JBFqnCBsd6RMkjVDRZzb` (the one in ElevenLabs' docs examples), changeable with `ELEVENLABS_VOICE_ID`. Values checked against the current Deepgram and ElevenLabs API docs.
  - `proxy/worker.js`: routes `GET /voice` (`{listen, speak}`, which keys exist, never the keys), `POST /listen` (recording ≤ 3 MB → `{text}`), `POST /speak` (`{text, lang}` ≤ 500 chars → MP3), plus the old `POST /`. Same origin check and rate limit; missing key → 503 `not_configured`; upstream failure → 502.
  - **Environment variables:** `TYPESAFE_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` as Worker secrets (`npx wrangler secret put …`); `proxy/.dev.vars.example` for `wrangler dev`; `.gitignore` now ignores `.dev.vars` and `.env` files (examples allowed). No key is in the repo or the website.
  - `report.js`: `getVoiceCaps()` (asks `GET /voice`; any failure → both false), `canRecord()`, `startRecording()` (MediaRecorder, WebM/Opus or MP4 for Safari, stops by itself after 30 s, turns the mic off), `transcribe()`, `speak()` / `stopSpeaking()` (never throws), `unlockAudio()` (plays a silent sound on the shared player during the Speak tap, because iPhones only allow sound that starts during a tap and the read-back comes seconds later).
  - `app.js`: the Speak button uses the voice bot when `listen` is true and the phone can record: "Recording… tap to stop" → "Turning your words into text…" → the report is read at once (hands-free) → the filled form opens → if `speak` is true and the report was spoken, the app says what it filled in and what it wasn't sure about (`readBackText`, e.g. "I filled in a sighting. Seen 10 minutes ago. Heading East. I wasn't sure about: where. Please fill that in. Check the form…"). If Deepgram fails, it switches to the phone's speech recognition for the rest of the session. **With no keys (or no proxy) nothing changes:** the phone's own speech recognition, no speaking.
  - `i18n.js`: 15 new strings in 5 languages (the "searched" read-back uses the real "Next areas to search" / "Searched, nobody found" labels).
  - `tools/mock-proxy.py`: `--voice` makes `/voice` say yes, `/listen` return a fixed sentence, `/speak` return a short beep (WAV); without it `/voice` says no, like a proxy without voice keys.
  - `tests/voice.test.js` (new, 8 tests): `/voice` flags; wrong origin 403; `/listen` without key 503; Deepgram URL, language code, auth and content type; empty audio 400; ElevenLabs URL, voice, format, key, model and language; `/speak` no key 503 / upstream failure 502; the app's `getVoiceCaps` with no proxy, an unreachable proxy, and a non-boolean answer.
  - Docs: README (voice steps, AI section, files table, deploy, privacy), `proxy/README.md` (voice bot section, keys, curl check, privacy, mock), `INTERFACES.md` §5, `CLAUDE.md` code rules, `PLAN.md` status/left/file table, `ShortPlan.md` one line. `sw.js` v13.
- **How it was verified:** `node --test` 62/62. Built-in browser at 375×812 with `?proxy=http://localhost:9100` and the mock in `--voice` mode, a fake microphone (test tone): Speak → "Recording… tap to stop" → stop → calls `/voice`, `/listen?lang=en`, `/`, `/speak` in that order; the sighting form opened with 10 min, east, "blue coat"; the player played the silent unlock on the tap, then the read-back. Without a proxy: Speak started the phone's speech recognition, no recording, no proxy calls.
- **Known issues / not done:** not tested with real Deepgram/ElevenLabs keys (BenStew has them; they go in as Worker secrets when the proxy is deployed). Real-microphone test on phones still to do; Safari's MP4 recording and the iPhone audio unlock aren't tested on a real iPhone.

### Offline: say "no internet" instead of "server busy", Demo works offline, tested

- **Date:** 2026-11-21
- **Stage:** Screen (BenStew) — offline testing
- **What changed:**
  - **"Map server busy" with no internet** (BenStew's report). `data.js` `fetchOverpass` now tells two failures apart: the server answered with an error (`busy`) vs. fetch itself failed (`offline`). It stops at once when the phone says it's offline (also if the phone goes offline during a retry wait), and stops after **2 failed connections in a row** (Wi-Fi with no internet, which `navigator.onLine` can't see), instead of 5 tries over ~45 s. Errors carry `offline: true`.
    - The loading bar says "Can't reach the map server. Check your internet. Trying again in 3 s (2 of 5)" for connection failures and keeps "Map server busy…" only for real server errors.
    - When nothing is saved nearby: "No internet, and no streets saved near here. Connect once, or save your home area ahead of time. You can still call 911 and check the house." `dataError` (servers failed) now says the servers didn't answer.
    - Saving the home area offline says "No internet…" (`homeSaveOffline`).
    - `firstDelayMs` option (default 3000) so tests don't wait.
  - **Sharing offline** said "denied". Now it says live sharing can't start without internet but the link still shows the same map (the link carries the case); the note stays visible after the share sheet or the copy.
  - **Voice offline:** the speech service's `network` error now says "Voice needs internet right now. Type it instead, or use the form." (was "Couldn't use the microphone").
  - **Demo offline:** `tests/fixtures/demo-area.json` (3 MB) is now in the service worker's precache, so the Demo works offline even if it was never pressed online.
  - **Updates:** when a new app version takes over an open page, the page reloads once so old and new files aren't mixed, but only if no last-seen point or shared search exists yet (never lose someone's work). Found in testing: after an update the first load used the new `app.js` with the old `style.css`.
  - **Blue tap bar** now starts right of the map buttons (it covered the search button on short phone maps) and drops the trailing 🔍 (the bar has its own search button).
  - `tests/data.test.js` (new, 6 tests): connection failure → `offline`; 504 → `busy`; phone offline → no fetch at all; a working download reports bytes; search failure → `offline`; two connection failures stop the retries.
  - `i18n.js`: 6 new strings, `dataError` reworded, in 5 languages. `sw.js` v12. README: a "With no signal" paragraph and the simpler offline test steps.
- **How it was verified:** `node --test` 54/54. Built-in browser, app server stopped (`preview_stop`) and the page's internet cut (offline flag + every outside request failing): the app opened from the offline copy with the yellow offline line; map search → "No internet, so search can't work"; Demo in 0.3 s with the usual top spots; report box → "No signal right now" and the form opened; share → link shown; a message stayed on the phone; a new last-seen point 20 km away + Find → the no-internet message on screen (0.1 s, no retries). With the phone "online" but requests failing: one "Can't reach the map server" retry, then the message after ~3 s.
- **Known issues / not done:** real airplane-mode test on a phone still to do. Messages sent while a *shared* search is offline were tested in an earlier commit (queue), not again here.

### Map search (magnifying glass); tap-mode buttons say "or search"

- **Date:** 2026-11-21
- **Stage:** Screen (BenStew)
- **What changed:**
  - **Map search** (`app.js` `SearchControl`, `openMapSearch`, `runMapSearch`, `chooseSearchResult`; `index.html` `#search-box`; `style.css`): a magnifying-glass button under the GPS button on the map, and another in the blue "tap the map" bar. It opens a search box at the top of the map; results (up to 5) come from Nominatim, preferring the part of the map on screen, with names in the app's language.
    - If the map is waiting for a tap (last-seen point, familiar place, sighting, home), picking a result places the point there exactly as a tap would. A familiar place gets the result's name as its label (e.g. "Fremont Main Library, Civic Center Drive").
    - Otherwise the map flies there and shows a blue pin with the name.
    - Search runs only when the person submits (Nominatim's rules: no search-as-you-type). With no internet it says so instead of trying.
  - The map-tap code moved into `placeAt(point, label)`, shared by taps and search.
  - While waiting for a tap, "Set last-seen point" reads **"Tap the map where they were last seen, or search 🔍"** and "Add a familiar place" reads **"Tap the map on a familiar place, or search 🔍"** (BenStew's wording). The blue bar shows the same text.
  - `data.js`: `searchPlaces(query, { limit, near, lang })`; `geocode()` now uses it. A failed fetch throws an error marked `offline: true` (`offlineError`), so the screen can say "no internet" rather than "failed".
  - `i18n.js`: 8 new strings in 5 languages; `tapMapCancel`, `tapLastSeen`, `tapFamiliar` removed (unused).
  - `sw.js` v11. README step 2 mentions search.
- **Why:** BenStew asked for the button text and a search on the map ("just a magnifying glass is good").
- **How it was verified:** `node --test` 48/48. Built-in browser at 375×812: banner and button text; search "Lake Elizabeth, Fremont" from the banner while placing the last-seen point → one result → the point and the direction arrow moved there; "Add a familiar place" → search "Fremont Main Library" → the familiar place was added with that name and the mode ended.
- **Known issues / not done:** not checked on a real phone yet.

### Phone feedback: likely areas instead of blue, clear tap mode, direction arrow, loading bar

- **Date:** 2026-11-21
- **Stage:** Screen (BenStew), after the first look on a real phone
- **What changed:**
  - **Map colors** (`app.js` `drawHeat`, `style.css`, `index.html` legend):
    - BenStew's phone screenshot showed the whole area one blue blur and asked "how does the blue help somebody?" It didn't. The cause: the engine's chance is very spiky (walkers that reach a creek or pond pile up on the same few 25 m cells; in the Demo, 25% of the chance sat in **9 cells**), so after scaling to the top cell almost every point was near zero and Leaflet.heat drew it all in its lowest color, blue.
    - Replaced Leaflet.heat with **likely-area bands**: the smallest set of cells holding 25% of the chance is **red**, up to 50% **orange**, up to 80% **yellow**, the rest uncolored. A legend in the map corner says "Red: 1 in 4 · With orange: 1 in 2 · With yellow: 4 in 5".
    - Before banding, the grid is blurred for drawing only (box blur, radius 3 cells, twice; about 75 m, roughly how far a searcher can see). Demo: red went from 9 cells to 83 (about 230 m across), 80% from 215 to 651 cells. The engine and its numbers are unchanged.
    - Drawn as one 256×256 picture (`L.imageOverlay` from a canvas) in its own map pane between the tiles and the street lines.
    - The purple "used streets" layer now only draws the two busiest shades; drawing every street any walker touched also filled the map.
    - `lib/leaflet-heat.js` deleted; removed from `index.html` and the `sw.js` shell.
  - **Tap-the-map mode** (`setMode` → `renderModeUI`): while the next tap places something (last-seen point, familiar place, sighting, home), a **blue bar** at the bottom of the map says what to tap and has a **Cancel** button; the map gets a blue frame and a crosshair; the button that started it reads "Now tap the map (tap here to cancel)" and pulses. "Set last-seen point" becomes "Move the last-seen point" with a green "✓ Last-seen point is on the map" once placed. The bar replaces the old disappearing "Tap the map…" messages. It was first at the top but hid the zoom buttons, so it's at the bottom.
  - **Direction arrow** (`drawDirectionArrow`, `setDirection`): a red arrow on the last-seen point. Drag its round head to turn it; a pill under the dot shows the direction ("Northeast") live, and on release it snaps to the nearest of the 8 directions the engine uses. Arrow keys turn it by 45° (it's a focusable slider). The panel shows the same pill plus a "Don't know" button. The value still lives in the (now hidden) `<select id="direction">`, so share links, the police sheet and the Demo are unchanged. Only the arrowhead takes taps; dragging it doesn't pan the map or place a pin.
  - **Loading bar** (`showProgress`, `onDownloadProgress`; `data.js` `fetchOverpass` gets `onProgress`, reads the response in chunks): stages "Checking for saved streets…", "Asking the map server…" (creeps 5→60%), "Downloading… 4.2 MB" (60→80%), "Map server busy. Trying again in 6 s (2 of 5)", "Reading the streets…" (85%), "Simulating 5,000 possible walks…" (92%). Also used when saving the home area. Overpass sends no size, so the bar is an estimate; a real test from San Jose: 38 s of waiting, then 12.5 MB in about 1 s, which is why waiting gets most of the bar.
  - `i18n.js`: 18 new strings in all 5 languages; `loadingData`, `calculating` and `lastSeenSet` removed (no longer used). `missingKeys()` is still `{}`.
  - `sw.js` `CACHE_VERSION` v10.
  - Docs: README ("See the map" explains the colors; the arrow and the blue bar; Leaflet.heat removed from `lib/` and credits), ShortPlan step 4, INTERFACES `cellToLatLng` note, PLAN status and lib row, `engine/index.js` comment.
- **Why:** BenStew's first test on a real phone: everything blue, unclear whether a button was waiting for a map tap, a dropdown for direction, and no sign of progress while streets load.
- **How it was verified:**
  - `node --test`: 48/48 pass.
  - Built-in browser at 375×812: the blue bar shows on load and after "Add a familiar place", Cancel clears it, and it closes the sighting form in sighting mode; tapping the map places the point and the arrow appears; dragging the arrowhead toward the upper right set "Northeast" in the pill, the panel and the hidden select, without panning; "Don't know" resets it; Japanese labels update. Demo: the bar moved 85 → 92 → 100%; red sits on top spots 1 and 2 with orange and yellow around them; legend shown. Real Overpass download with `onProgress`: waiting → download stages reported. No console errors.
- **Known issues / not done:** not yet re-checked on a real phone (touch-dragging the arrow especially). The translations of the new strings need a native speaker's check, like the rest. The benchmark is unaffected (drawing only).
- **Next:** BenStew re-checks on the phone; then the Jev deploy, two-phone test, video, Devpost.

### Live on GitHub Pages: link in the README, proxy locked to the site

- **Date:** 2026-11-21
- **Stage:** Hosting (BenStew)
- **What changed:**
  - BenStew made the repo **public** and turned on **GitHub Pages** (`main`, `/`). The site is live at **https://donaldstewart4.github.io/FindThem/**; the first build took about 20 s.
  - `README.md`: a "Try it" link at the top; the deploy section says this repo is already deployed and pushes to `main` update it.
  - `PLAN.md` Status: Pages ticked, with what was checked.
  - `proxy/wrangler.toml`: `ALLOWED_ORIGIN` = `https://donaldstewart4.github.io` (was `*`), so only the live site can use the Jev proxy once it's deployed. `proxy/README.md` step 7 explains switching to `"*"` temporarily for localhost testing.
  - This file: "Project context" deploy bullet; this entry.
- **How it was verified:**
  - curl: the page, `app.js`, all 5 engine files, `lib/`, `sw.js`, `manifest.json`, `config.js`, `sync.js`, `report.js`, `i18n.js`, `data.js`, the 3 MB demo fixture and the icons all return 200 with the right content types. No Jekyll syntax in the docs, so the default Jekyll build is safe.
  - Built-in browser at 375×812 on the live URL: Demo in 0.6 s (same top spots as locally); "Share this search" created a live search in Firebase from the `github.io` origin ("Shared live…"); the service worker registered with scope `/FindThem/`; no console errors.
- **Known issues / not done:**
  - The Jev proxy isn't deployed.
  - Not tested on real phones yet. One more test search (`e3a7658b…`, "Live site check") is now in the live database.
- **Next:** Jev deploy; two-phone test (sharing, voice with a real mic, offline); Nathan's UI review; video; Devpost.

### Docs catch-up: status list, voice explained, fake engine marked deleted

- **Date:** 2026-11-21
- **Stage:** Docs
- **What changed:**
  - `PLAN.md`:
    - a new **"Status (Nov 21, evening)"** section: what's done, and what's left, in order (Pages → Jev deploy → two-phone test incl. a real microphone → Nathan's UI review → video + Devpost)
    - schedule steps 1–8 marked ✅
    - `engine/fake.js` marked deleted; `report.js` row says "Jev proxy"
    - the afternoon update no longer says BenStew hand-writes the engine (Update 2 replaced that)
  - `CLAUDE.md`: a "Where things stand" pointer to `PLAN.md` → Status; the `fake.js` bullet now says the real engine is integrated and `fake.js` was deleted.
  - `INTERFACES.md`:
    - status "implemented" (engine and screen follow it, tests check it)
    - the ground rule no longer says the screen imports `fake.js`
    - §5 says the report box sends up to 60 nearby named places `{name, lat, lng}` and the proxy asks Jev five questions
  - `README.md`:
    - the report-box step explains how voice works: phone speech recognition (Google on Android Chrome, Apple on iPhone Safari) → the Jev proxy's five questions, low-confidence answers blank → you check and add; the manual form on any failure
    - Limits: what leaves the phone (text to TypeSafe without coordinates, speech to Google or Apple); voice usually needs signal, isn't in Firefox, and hasn't been tested with a real microphone
  - `ShortPlan.md`: the report box line notes it's live once the Jev proxy is deployed.
- **Why:** BenStew asked how voice mode works and for the .md files to be brought up to date.
- **How it was verified:** docs only. Grepped for `fake.js`, `streetNames` and "street names in view"; the only remaining mentions are marked as deleted history.
- **Next:** GitHub Pages; Jev deploy; two-phone test; video; Devpost.

### Note: history rewritten to hide the author email (no code change)

- **Date:** 2026-11-21
- **Stage:** Repo hygiene, before making the repo public
- **What changed:**
  - All 17 earlier commits were rewritten with `git filter-branch --env-filter` so the author and committer email is BenStew's GitHub noreply address (`289519839+DonaldStewart4@users.noreply.github.com`) instead of a personal address.
  - Checked before pushing: files identical (same tree), dates and messages identical.
  - Force-pushed with `--force-with-lease`. GitHub's commit list now shows only the noreply address.
  - This repo's local `user.email` is set to the noreply address, so new commits use it too.
- **Why:** the repo is about to go public for GitHub Pages and the Devpost requirement, and commit metadata is visible to anyone.
- **Effect on others:**
  - **Every commit id changed.** Entries in this file are titled by commit message, not id, so they still match.
  - Anyone who cloned before this must re-clone, or run `git fetch` then `git reset --hard origin/main` (that discards their local commits, so save work first).
- **How it was verified:** the tree of the new HEAD equals the old HEAD's tree; `git log` dates and messages match line for line; the GitHub API's commit list has one unique email, the noreply one.
- **Next:** make the repo public; turn on GitHub Pages.

### Live sharing on real Firebase; fix duplicate events and stale offline copies

- **Date:** 2026-11-21
- **Stage:** Hosting (BenStew) + fixes found testing on real Firebase
- **What changed:**
  - `config.js`: `FIREBASE_DB_URL` = `https://findthem-f4e5c-default-rtdb.firebaseio.com`. BenStew created the project (`findthem-f4e5c`, Spark free plan) and a Realtime Database in locked mode, and published `firebase-rules.json`.
  - **`sync.js`: only one send runs at a time** (`flushQueue` with a lock that loops while new events arrive), and the queue is re-read after each send before removing the sent item.
    - Bug: Nathan-test marked an area searched and sent a message right after. Two overlapping flushes both POSTed the first queued event, so the "searched" event was stored **twice**, which double-counted the search (the detection estimate went from 66% to 88%).
  - **`app.js`: `currentEvents()` drops duplicate events with the same `cid`** (keeping the first), so duplicates already in the database, or from two tabs on one phone sharing `localStorage`, can't skew the map or the police sheet.
  - `app.js`: a `storage` event listener refreshes the "updates waiting for signal" count when another tab changes the queue.
  - **`sw.js`: install saves files with `{ cache: 'reload' }` and background refresh uses `{ cache: 'no-cache' }`.**
    - Bug: the new worker (v8) pre-cached a **stale `app.js` from the browser's HTTP cache**, so the fix didn't show up even after reloads. GitHub Pages lets browsers cache files for 10 minutes, so this would also have hit real users after an update. `CACHE_VERSION` → v9.
  - `tests/sync.test.js`: a new test, "two events sent at the same moment each reach the database exactly once" (slow fake fetch, two overlapping `addEvent`s).
  - `README.md`: status says live sharing runs on real Firebase.
  - This file: the "Project context" tech bullet has the live database URL; this entry.
- **Why:** BenStew finished the Firebase setup and sent the database URL.
- **How it was verified:**
  - **Rules check with curl against the live database (8 checks, all as intended):** listing `searches` denied; writing outside `searches` denied; a non-32-hex search id denied; creating a case with a proper id allowed; overwriting that case denied; adding an event allowed; an event with a made-up type denied; reading a search by its id allowed.
  - **Two tabs in the built-in browser, no `?db=` override:** tab A ran the Demo and shared ("Shared live…"); tab B opened the link, marked Area A searched and sent a message. Tab A showed the same re-ranked areas (23% / 10% / 7%) and "Nathan (test): Test message through real Firebase" within ~2 s.
  - After the fixes, reloading tab A on the same search: the police sheet lists the search **once** (66%), even though Firebase still holds the duplicate.
  - `node --test`: **48/48 pass**.
- **Known issues / not done:**
  - **Test data in the live database:** two searches (the curl rules check `04c57dda…`, the browser test `1a80f9aa…`), including the duplicate event. The rules don't allow deleting from the app; BenStew can delete them in the Firebase console (Data tab) if wanted.
  - Not yet tested on two real phones.
  - The Jev proxy isn't deployed; the repo isn't public; GitHub Pages is off.
- **Next:** TypeSafe key + Cloudflare deploy for Jev; make the repo public and turn on GitHub Pages; test on two phones; video; Devpost.

### Benchmark: 1,000 simulated searches, FindThem vs. volunteers on their own vs. ring sweep

- **Date:** 2026-11-21
- **Stage:** Benchmark (required; built with Claude Code)
- **What changed:**
  - `bench/benchmark.js` (new):
    - **Cases:** 5 Fremont start points × direction known/unknown × 100 "true" people = 1,000 cases. Each person is a walker endpoint from `simulate` with **different settings** than the app's (two tunings: give-up 2,000/3,000 m, turn scale 45°/20°, heading scale 120°/60°, dead-end stop 0.45/0.2, trap 0.5/0.7).
    - **Search:** 6 volunteers search 200 m sectors in 20-minute turns. Detection uses `podForMinutes` from `grid.js`.
    - **Four strategies:**
      - on their own: random nearby sectors within 1 mile, weighted e^(−d/800 m), no shared record
      - ring sweep: nearest first, each once
      - FindThem: greedy with diminishing returns for a second searcher in the same sector, plus a sector-level Bayes update after each empty turn
      - FindThem + sighting: after turn 1, one sighting on the way (40–100% along the line to the true spot, ~100 m noise, direction and minutes-since, reliability 0.6), applied through `engine.replay` with the turn-1 searches
    - **Output:** the share found at 500 / 1,500 / 3,000 searcher-minutes with 95% margins, written to `bench/results.md`.
    - Seeded throughout, so results are reproducible. `npm run bench`, about 45 s.
  - `bench/results.md` (new): the latest output.
  - `engine/sim.js`: `simulate` takes an optional `tuning` override; the app never passes it.
  - `tests/bench.test.js` (new, 2 tests): a tiny run is in range, never decreases over time, and is reproducible.
  - `package.json`: a `bench` script.
  - `README.md`: a Benchmark section with the table, how it works and its limits; status line; file table; limits wording.
  - `ShortPlan.md`: benchmark ticked. **Every must-have box is now ticked.**
  - `CLAUDE.md`: "the benchmark is required" becomes "done; re-run if the engine changes".
  - This file: "Project context" benchmark bullet; this entry.
- **Why:** required by the plan since the first planning round. It's the evidence judges see for impact and technical execution.
- **Results (1,000 cases):**

  | Strategy | 500 | 1,500 | 3,000 searcher-min |
  |---|---|---|---|
  | On their own | 8% ±2 | 21% ±3 | 34% ±3 |
  | Ring sweep | 18% ±2 | 29% ±3 | 35% ±3 |
  | FindThem | 31% ±3 | 54% ±3 | 70% ±3 |
  | FindThem + sighting | 52% ±3 | 77% ±3 | 87% ±2 |

- **Decisions:**
  - **Sighting on the way, not at the final spot.** The first version put the sighting ~100 m from where the person ends up and gave 86% at 500 searcher-min, which was too optimistic. Now the sighting happens on the way, with direction and time since.
  - **The "true" people use different walker settings** so FindThem isn't graded on exactly its own assumptions. It's still the same family of model, and the README says so.
  - **The ring sweep is a single pass:** each area once. That's why it plateaus near 35% (one 20-minute search spots ~38%). This is stated in the README and results.
- **How it was verified:** `node --test`: **47/47 pass**. Full run: 1,000 cases in 45 s.
- **Known issues / not done:**
  - It's a simulation and not field-tested. Searchers are modeled as perfect at following assignments.
  - Repo not public yet; Firebase and Jev not set up; video and Devpost not done.
- **Next:** BenStew's account setups; make the repo public; deploy to GitHub Pages; video (2–3 min); Devpost write-up.

### Real engine: walkers, Bayesian grid, next areas, routes, top spots; fake engine removed

- **Date:** 2026-11-21
- **Stage:** Engine + integration (built with Claude Code)
- **What changed:**
  - `engine/sim.js` (new): 5,000 seeded walkers (mulberry32 + Box–Muller) per `PLAN.md`.
    - Start at the nearest node. The time budget is speed × minutes × 60 × 0.6, capped by a lognormal give-up distance.
    - Turn weight exp(−θ/30°); the first edge is weighted toward the stated heading.
    - Familiar-place pull ×1.5 within a 45° cone. Trap snap within 30 m with p = 0.6 (a point inside a park or wetland counts as in it).
    - Each walker is counted once per edge used.
  - `engine/grid.js` (new):
    - **Prior:** endpoints on 25 m cells, a 1-2-1 blur, and a 2% floor.
    - **`replay`:** events sorted by `at` then `id`. A `searched` event multiplies its sector by (1 − POD), POD = 1 − e^(−0.8 m/s × t × 20 m ÷ 40,000 m²), then renormalizes. A `sighting` reruns walkers from the sighting (seed + 7919k, ≥ 5 min), multiplies by earlier searches' miss factors, and blends by reliability. Other event types are ignored.
    - **Caching:** walker runs are cached per area and inputs.
    - **`nextSectors`:** greedy P × POD, ties by id.
    - **`topSpots`:** cells ≥ 150 m apart, probability within 75 m, snapped to a creek or park within 50 m when one is there; nearest named street via a 50 m segment index.
    - **Helpers:** `cellToLatLng`, `podForMinutes`, `sectorBoundsXY`.
  - `engine/routes.js` (new): `routeFor` walks the sector's streets (no driveways or parking aisles unless that's all there is), starting on the busiest street and always taking the busiest unwalked one, retracing when stuck so the line stays connected. It drops the final walk back; minutes = length ÷ 0.8 m/s.
  - `engine/index.js` (new): re-exports `prepareArea`, `replay`, `cellToLatLng`, `nextSectors`, `topSpots`, `routeFor`.
  - `engine/graph.js`: edges also carry `highway` (the street type).
  - **Integration:** `app.js` imports `./engine/index.js`; **`engine/fake.js` deleted**, along with its "practice results" note (`index.html`, `app.js`, and the `fakeEngine` strings in `i18n.js`).
  - `sw.js`: the offline list has the 5 engine files instead of `fake.js`; `CACHE_VERSION` → v6.
  - `tests/engine.test.js` (new, 15 tests):
    - walkers: determinism, edge counts, **calibration**, time and mobility, the heading pull, speed
    - replay: sums to 1 with searches, sightings and messages; independent of event order; Bayes lowers the searched sector and raises all others; POD formula; a sure sighting moves ≥ 30% of the mass near it
    - nextSectors vs. brute force
    - topSpots fields and spacing
    - routes inside their sector, connected, timed
    - unknown sector ids
  - `INTERFACES.md`: edges add `highway`; endpoints add `x, y`.
  - `README.md`: status line, the engine files, and a calibration and speed paragraph.
  - `ShortPlan.md`: ticked engine + tests, live shared map, routes, sightings, the 5 languages and Demo. Only the benchmark is still open.
- **Why:** BenStew asked for the rest of the engine. The official rules allow AI.
- **Decisions (found while calibrating on the Fremont map):**
  - **Calibrate to straight-line distance.** The research numbers (~0.8 km median, 89% within 1 mile) are straight-line, but Fremont's OSM data is mostly sidewalks (2,162 ways) and service ways (2,384) beside 1,650 residential streets, so walks wind. **`GIVE_UP_MEDIAN_M` = 2,500 m along the streets, σ = 0.6**, gives a median ≈ 0.74 km and ≈ 89% within a mile over 5 start points. The first try (850–1,100 m) gave medians of 74–405 m.
  - **Dead ends stop a walker only 30% of the time** (`DEAD_END_STOP_PROB`). Otherwise it turns back, and service-way dead ends (driveways, parking aisles) never stop it. With "always stop", walkers starting near parking lots barely moved.
  - **Street-type weights** (`HIGHWAY_WEIGHT`, service = 0.25): walkers don't follow parking aisles.
  - **Lasting heading pull** (`HEADING_SCALE_DEG` = 90°): with "NE", walkers used to end up NW as often as NE after a few curvy turns. Now ~3.7k of 5k end N/NE. The game plan found the direction is the biggest single gain.
- **How it was verified:**
  - `node --test`: **45/45 pass**.
  - In Node on the Demo case: prepare 22 ms, replay 79 ms, replay with a search + sighting 23 ms (cached walkers), 3 routes 4 ms, top spots 8 ms.
  - In the browser at 375×812:
    - Demo in 2.0 s (mostly loading the 3 MB data and drawing ~7,700 streets).
    - Areas A/B/C at 29% / 17% / 7% with routes of 1.3 mi / 0.3 mi / 0.5 mi.
    - Marking Area A searched (45 min) dropped it to 12% and re-ranked the areas (0.6 s with redraw).
    - A "sure" sighting moved the top spots next to it (0.27 s).
    - No new console errors; the old ones were the earlier test tab retrying stopped mock servers.
- **Known issues / not done:**
  - **The benchmark** (required).
  - The real Firebase and Jev aren't set up yet.
  - Routes can be long (a 200 m sector with many sidewalks gave 1.3 mi), and the route only covers the street network connected to its busiest street.
  - Top-spot reasons often say "Near <street>": few creeks lie close to the Demo's likely area.
  - The Demo takes ~2 s on a laptop, so a phone may take several seconds.
- **Next:** the benchmark (`bench/`); make the repo public; Firebase + Jev setup; video.

### Official rules allow AI: engine built with Claude Code; add engine/graph.js

- **Date:** 2026-11-21
- **Stage:** Engine step 1 + decision change
- **What changed:**
  - `engine/graph.js` (new, written by Claude Code):
    - `prepareArea(osm)` → `{ origin, graph: { nodes, edges }, traps }` per `INTERFACES.md`.
      - Nodes carry lat/lng plus local x/y meters and their edge list.
      - Edges are one per neighboring node pair in each way, with `length` and `bearingAB` (0 = north, clockwise).
    - Trap index: feature outlines get extra points every 10 m (`TRAP_STEP_M`), bucketed into 50 m squares (`TRAP_CELL_M`), plus area polygons with bounding boxes.
    - Helpers: `nearestTrap(area, x, y, maxM)` (3×3-square lookup; inside a park or pond counts as distance 0 via a ray-casting test), `nearestNode(area, lat, lng)`, `toXY`, `toLatLng`, `bearing`.
  - `tests/graph.test.js` (new, 8 tests): a tiny synthetic map (projection, edges, bearings including 180/270, node edge lists, no mutation, `nearestNode`, `nearestTrap` on a sparse two-point creek) and the real Fremont fixture (edge count = neighbor pairs, lengths in (0, 2000) m, bearings in [0, 360), speed).
  - `CLAUDE.md`: a new **"Event rules"** section summarizing the official rules; the "AI must not write engine code" rule is replaced by "the engine is built with Claude Code; disclose it".
  - `PLAN.md`, `ShortPlan.md`, `INTERFACES.md`, `README.md`: the engine is built with Claude Code; the README's "Who built what" table and status line are updated.
  - This file: "Project context" event and team bullets updated; this entry.
- **Why:** BenStew asked Claude to write `graph.js` and shared the official EvoHacks 2 rules. They *encourage* AI use and say nothing against AI building the whole project or about explaining your own code on video.
- **Decisions:**
  - **Drop the hand-written-engine rule**, which was based on the game plan's reading of an older page, and keep honest disclosure in the README and Devpost.
  - **Densify trap outlines** rather than measuring distance to segments. That's simpler and fast enough: OSM creeks can have points hundreds of meters apart, and the test's creek has two points 350 m apart.
  - **Inside a polygon = in the trap.** A walker stopping inside a park or wetland is already "in" it.
- **How it was verified:** `node --test`: 30/30 pass (8 new). `prepareArea` on the Fremont fixture (33,059 nodes, 7,695 ways) takes ~52 ms in Node.
- **Known issues / not done:**
  - `sim.js`, `grid.js`, `routes.js` and `index.js` aren't written yet, so the app still imports `engine/fake.js`.
  - The repo must be made **public** before submitting.
- **Next:** `engine/sim.js` (walkers), then `grid.js`, `routes.js`, `index.js`, integration (swap the import, delete `fake.js`), then the benchmark.

### Jev is TypeSafe's AI model, not a teammate: report box switches from DeepSeek to Jev; BenStew hand-writes the engine

- **Date:** 2026-11-21
- **Stage:** Decision change + report box
- **What changed:**
  - `proxy/jev.js` (new): `buildJevRequest()` sends one request with five questions:
    - `kind` choice: sighting / searched / message
    - `direction` choice: N…NW / unknown
    - `minutes` choice: 0/5/10/15/30/60/unknown
    - `sure` score: 3 levels → reliability 0.3/0.6/0.9
    - `place` choice: nearby place names + none
    The state holds the report, its language and the place names; coordinates are not sent to Jev.
  - `proxy/jev.js` also has `jevToDraft()`, which maps the answers to a `ReportDraft`:
    - **any answer below `MIN_CONFIDENCE` (0.5) is left empty for the person to fill in**
    - an unsure `kind` becomes a sighting with only the note filled
    - `note` is the report text itself, since Jev can't write text
    - the chosen place's coordinates become `lat`/`lng`
    `cleanPlaces()` dedupes and caps at 60.
  - `proxy/worker.js`: the DeepSeek call is replaced by `askJev()` (`POST https://api.typesafe.ai/v1/systemone`, `Bearer env.TYPESAFE_API_KEY`, model `jev-latest`, one retry on 429/529). The request/response contract, origin check, rate limit and `validateDraft` are unchanged.
  - `proxy/wrangler.toml`, `proxy/README.md`: the TypeSafe key secret, deploy steps, privacy (TypeSafe, a US company; coordinates not sent), and a multilingual curl test.
  - `report.js`: context is now `places: [{name, lat, lng}]` (≤ 60) instead of `streetNames`.
  - `app.js`: `nearbyStreetNames()` → `nearbyPlaces()`, which returns named streets **and** named creeks, parks and lakes, nearest to the last-seen point first.
  - `tools/mock-proxy.py`: matches place names from `context.places` → lat/lng; the wording no longer mentions DeepSeek.
  - `sw.js`: `CACHE_VERSION` → v5. `.gitignore`: ignores `__pycache__/`.
  - `tests/jev.test.js` (new, 8 tests): place cleaning, request shape (no coordinates sent), confident → full draft, low confidence → empty fields, unsure kind, unknown/none, the worker calling Jev with the key and retrying once on 529, and no key → 500 / wrong origin → 403. `fetch` is faked.
  - `CLAUDE.md`, `PLAN.md`, `ShortPlan.md`, `INTERFACES.md`, `README.md`, `config.js`: the team is now BenStew + Nathan; BenStew owns the hand-written engine; the report box uses Jev; DeepSeek is removed; no FastAPI.
  - This file: "Project context" team and tech bullets updated; this entry.
- **Why:** BenStew clarified that "Jev" in the team doc is an AI model (TypeSafe AI, Wikipedia "Jev (AI model)"), not a person. Every doc had assigned the engine to "Jev".
- **Decisions:**
  - **Jev goes in the report box**, its natural fit (typed multiple-choice answers with calibrated confidence), not in the engine. The map math stays hand-written and the LLM never sets probabilities, which keeps the "non-LLM core" and the benchmark story.
  - **BenStew hand-writes the engine**, with Claude only explaining, suggesting tests and reviewing. This follows the EvoHacks rule that AI may not build the whole project.
  - **No FastAPI.** The engine stays JavaScript on the phone so offline works; Jev is called from the existing Cloudflare Worker.
  - The confidence gate is the "knows when not to act" behavior the game plan recommends.
- **How it was verified:**
  - `node --test`: 22/22 pass (8 new Jev tests).
  - In the browser with the mock proxy, the Demo report "I think I saw her on Ralston Common 10 min ago heading east" sent 60 nearby places, nearest first (Plumas Way, Placer Way, Tehama Avenue…), including creeks and parks; the draft pinned to Ralston Common with 10 minutes.
- **Known issues / not done:**
  - **Not tested against the real Jev API:** it needs a TypeSafe key (paid, no free tier listed).
  - Jev's language support isn't documented, so check non-English reports with the curl test after deploying.
  - Question wording and `MIN_CONFIDENCE` are first guesses for Nathan to tune.
  - The engine isn't started.
- **Next:** BenStew starts `engine/graph.js` by hand, with Claude explaining; get a TypeSafe key and deploy the Worker; create Firebase.

### Rewrite README for the app as built; add ROADMAP.md

- **Date:** 2026-11-21
- **Stage:** Docs (BenStew)
- **What changed:**
  - `README.md` rewritten. It had described the app from before the game-plan merge (a `sim.js`, street marking, "copy summary", median 0.88 km, no sharing or report box). Now it has:
    - a status line: the numbers come from the stand-in engine until Jev's lands; Firebase and the proxy aren't set up yet
    - **What it does** (steps 0–8 plus home area, blue dot and Demo)
    - **How the prediction works** (walkers → 25 m grid → Bayes updates with Koopman detection → allocation; median ~0.8 km per the game plan)
    - a **Benchmark** section saying "not run yet", with what it will compare
    - languages and units
    - **Who built what, and how AI was used**: a table for BenStew (with Claude Code), Jev (engine by hand) and Nathan (tests, AI may help), plus the app's own narrow AI use
    - an updated file table
    - run locally plus `node --test`
    - Firebase setup, a new AI-proxy setup section, and GitHub Pages steps for the existing repo (make it public, turn on Pages)
    - a **Limits** list
    - credits, now including Koopman and Bayesian search theory
  - `ROADMAP.md` (new): "Future Plans (not yet built)" from the original prompt. Each item has, where it applies, an "Already in the app" line and a "Not built" line so the boundary is clear: live group search, caregiver profile, working with authorities, accessibility, privacy. Languages were moved out because they're built. Added the game-plan ideas that weren't built (time-aware map, "no one here" clues, GPS-trail coverage, doorbell-camera list, drill mode) and the open found-location dataset.
  - `CLAUDE.md` and the intro of this file now refer to `ROADMAP.md` as existing.
- **Why:** BenStew asked for the docs to be updated while Jev finishes the engine. The rules require disclosing AI use and separating built from planned work.
- **Decisions:**
  - **AI use is disclosed in the README**, naming Claude Code for the screen and noting that several screen files and the test servers were written by Claude Code sessions. That matches the commit log.
  - **The benchmark section is honest:** "not run yet" rather than placeholder numbers.
  - **The deploy steps match this repo:** it already exists and is private, so the steps are "make public → Pages" and the URL uses a placeholder username.
- **How it was verified:** docs only. Checked against the code: file names, buttons, behavior and settings (`FIREBASE_DB_URL`, `PROXY_URL`, `?db=`, `?proxy=`, `CACHE_VERSION`) all exist as described. README is 2,255 words; ROADMAP is 704.
- **Known issues / not done:** once the real engine and benchmark land, the README status line and Benchmark section need updating.
- **Next:** integration with Jev's engine; Firebase; proxy deploy; the benchmark.

### Screen E: offline worker on, app manifest, offline banner, Save my home area, GPS blue dot

- **Date:** 2026-11-21
- **Stage:** Screen E (BenStew)
- **What changed:**
  - `app.js`:
    - **Offline worker:** `registerServiceWorker()` turns on `sw.js`. `showOnlineState()` shows a yellow "You're offline – using saved data" line under the emergency banner on the `offline` event and hides it on `online`.
    - **My location:** a `LocateControl` button (◎) under the zoom buttons uses `watchPosition` to draw a blue dot with an accuracy circle and flies there on the first fix. Tap again to stop; denial shows a message.
    - **Save my home area** (`<details>` at the bottom of the panel): pick the point by address (`data.geocode`), by tapping the map (new `'home'` tap mode) or by GPS. A green ⌂ pin shows it. "Save this area for offline use" calls `data.loadArea` (downloads + stores, or finds it saved), remembers `{lat, lng, savedAt}` in `localStorage`, and shows "Saved on … works within about 2 miles, even with no signal".
  - `data.js`:
    - **Address search:** `geocode(query)` via Nominatim (one request per button tap, per their 1/second rule).
    - **Saved areas near a point:** `distanceM()` (haversine) and `findSavedAreaNear()`.
    - **`loadArea` order is now:** exact saved spot → saved area within 1,000 m → download → if the download fails, a saved area within 2,500 m → error. **A home area saved ahead of time now covers a last-seen point a few streets away**, which an exact-key cache couldn't. With `navigator.onLine === false` it tries Overpass once instead of five times.
  - `index.html`: `<link rel="manifest">`, the SVG favicon, the Apple touch icon, the offline banner, and the home-area section.
  - `style.css`: offline banner, home-area row, locate button, home pin.
  - `i18n.js`: 21 new strings in 5 languages.
  - `sw.js`: `CACHE_VERSION` → v4.
  - `README.md`: an updated offline test, and a note that while developing you reload twice / bump `CACHE_VERSION`.
  - `ShortPlan.md`: ticked "Works offline after the first visit".
- **Why:** Screen E in `PLAN.md`; the original prompt's offline PWA, GPS dot and "Save my home area".
- **Decisions:**
  - **Distance thresholds:** an area covers 3.2 km around its center and walkers need ~2 km around the last-seen point. So a saved area is reused online only within 1 km, and offline within 2.5 km, since a looser fit beats nothing.
  - **Offline banner follows the browser's events.** With no signal the app still opens from cache; "offline" means the phone, not our server.
  - **The locate button is a map control**, so it's always one tap away and doesn't take panel space.
  - **Home saving reuses `loadArea`**, so a home area is just a saved area; nothing new to keep in sync.
- **How it was verified** (built-in browser at 375×812):
  - The service worker is active and controls the page; `findthem-shell-v4` holds 18 files including `config.js`; a `findthem-tiles` cache exists; `manifest.json` loads; the locate button is labeled "Show my location".
  - The offline banner shows on an `offline` event with the right text and hides on `online`.
  - Blue dot: with a stand-in `watchPosition` (no GPS in the test browser), the dot and accuracy circle drew and the button showed pressed.
  - Home area: Fremont data seeded into IndexedDB, then a home point ~1 km from its center was tapped. Save took 0.05 s with no download, the remembered entry was saved, and the green pin appeared. Address search found "Fremont Central Park, …, Fremont" through Nominatim.
  - **Real offline test:** web server stopped, page reloaded. The app opened from the cache, remembered the home area, and the Demo ran with results.
  - `node --test`: 14/14 pass. `missingKeys()` is `{}`.
- **Known issues / not done:**
  - **Real GPS wasn't tested** (stand-in only).
  - **The offline fallback path wasn't exercised** (download fails → saved area within 2.5 km), because the test machine had internet.
  - Saving a home area that isn't saved yet needs Overpass, which can be busy.
  - The page shows the saved home's date but doesn't list or delete saved areas.
  - The manifest's start_url `./` works on GitHub Pages under `/FindThem/`, but that isn't tested yet.
- **Next:** integration with Jev's engine (swap `engine/fake.js`, Nathan's tests); create Firebase; deploy the proxy; then the required benchmark.

### Screen D: voice/text report box that fills in the sighting form or a message, confirm before anything is added

- **Date:** 2026-11-21
- **Stage:** Screen D (BenStew)
- **What changed:**
  - `index.html`, `style.css`:
    - a "Type or say what you saw" button opening the report box: example, textarea, **Speak** (turns red while listening), **Fill in the form**, a status line, and a privacy note ("sent to an AI service only to fill in the form; leave out names and medical details; you check everything")
    - a yellow "Check this: it was filled in from your report" note at the top of the sighting form
  - `app.js`:
    - `toggleReportBox`; `toggleVoice` / `stopListening` with `report.startVoice` (words appear as heard; the Speak button is hidden where the browser has no voice input)
    - `nearbyStreetNames()`: up to 50 named streets, nearest the last-seen point first, sent as context
    - `readReport()`:
      - **sighting** → the report box closes and the sighting form opens **pre-filled** (minutes, direction, how sure, note). If the draft has a location it's shown as a draft pin and the map flies there; otherwise "Now tap the map where they were seen".
      - **message** → the text goes into the message box, waiting for Send.
      - **searched** → explains how to mark an area under "Next areas".
      - Errors (offline / not set up / unreadable) → a message, and the **manual sighting form opens**.
    - `openSightingForm({ draft })` can now pre-fill.
  - `report.js`:
    - `PROXY_URL` constant replaced by `setProxyUrl()` / `isProxyConfigured()`, so app.js sets it from `config.js`
    - `startVoice()` gained an `onEnd` callback (it never said when listening stopped)
  - `config.js`: `PROXY_URL` (empty until the proxy is deployed); `?proxy=` override on localhost, sharing one `localOverride()` helper with `?db=`.
  - `tools/mock-proxy.py`: a keyword-rule stand-in for the proxy on port 9100 (no AI, no key) for testing. "here" pins the draft to the last-seen point.
  - `i18n.js`: 18 new strings in 5 languages. The word "chatbot" appears only in code comments.
  - `proxy/README.md`: points to `PROXY_URL` in `config.js`.
  - `sw.js`: `CACHE_VERSION` → v3.
  - `ShortPlan.md`: ticked "Messaging between searchers" (tested in Screen C) and "Voice/text report box".
- **Why:** Screen D in `PLAN.md`; the team doc's voice/text "report box"; the rule that nothing unconfirmed reaches the engine.
- **Decisions:**
  - **The confirm step is the existing forms.** A draft only ever fills in the sighting form or the message box; the person taps "Add sighting to the map" or "Send" as usual. No separate confirm dialog, and the engine only sees normal events.
  - **Close the report box after a draft** so the filled-in form is right below. Testing showed the open box pushed the form out of view.
  - **Every failure falls back to the manual form**, so the report box can never block reporting.
  - **`searched` drafts don't become events:** a searched event needs a sector, which only the map can give.
  - The privacy note sits right under the button, before anything is sent.
- **How it was verified:**
  - Built-in browser at 375×812 with `tools/mock-proxy.py`, Demo case:
    - "I think I saw a man in a blue coat by the lake 10 min ago heading east" → form with 10 / East / Probably / "blue coat", the check note, "Now tap the map…", and no sighting on the map.
    - "Definitely saw her right here 5 minutes ago, red sweater, going north" → pinned draft with 5 / North / Sure / "red sweater". **The top spots were unchanged until "Add sighting" was tapped**, then changed, with "Sighting added…".
    - A message-type report filled the message box, and nothing was sent until Send.
    - No proxy → "The report box isn't set up on this site yet…" and the manual form opened. Empty text → "Type or say your report first."
  - `node --test`: 14/14 pass.
  - Console errors seen were only the earlier test tab's live stream retrying the stopped mock database. The current page makes none.
- **Known issues / not done:**
  - **Voice input was not tested** (no microphone in the test browser).
  - **The real proxy isn't deployed:** DeepSeek and the Cloudflare account are still to do (`proxy/README.md`), and `ALLOWED_ORIGIN` is `*`.
  - With a proxy set but unreachable, the message says "No signal" (`report.js` treats network failures as offline).
  - The draft pin uses the same orange "!" look as confirmed sightings.
- **Next:** Screen E (register `sw.js`, link the manifest, Save my home area, GPS dot); create Firebase; deploy the proxy.

### Add offline worker, app manifest and icons, report box module and LLM proxy (from a parallel session)

- **Date:** 2026-11-21
- **Stage:** Screens D/E groundwork (BenStew's files, written by another session)
- **What changed:** files a parallel session wrote into the folder while Screen C was being built, committed as-is apart from two lines in `sw.js`:
  - `sw.js`: service worker.
    - Pre-caches the app shell + `/lib` + icons on install, skipping any missing file.
    - Deletes old shell caches on activate.
    - OSM tiles: cache-first, only tiles actually viewed, capped at 2,000 (oldest trimmed), never prefetched.
    - Other sites (Overpass, Nominatim, Firebase, the proxy): network-only.
    - Same-site files: cache-first with a background refresh, so the demo file is cached on first use.
    - Two lines changed in Screen C: `config.js` added to the shell list, `CACHE_VERSION` bumped to `v2`.
    - **Not registered by the page yet** (Screen E).
  - `manifest.json`, `icons/`, `tools/make-icons.py`: the PWA manifest (name FindThem, theme `#b00020`, standalone), 192/512/maskable PNGs, an Apple touch icon and an SVG, drawn by a pure-standard-library Python script. **`index.html` doesn't link the manifest yet** (Screen E).
  - `report.js`: the report box logic (no UI text).
    - voice through the Web Speech API (`startVoice`, `isVoiceSupported`)
    - `parseReport` POSTs to the proxy with a 15 s timeout
    - `validateDraft` cleans the LLM output (kinds, lat/lng pairs, compass directions, minutes 0–1440, reliability snapped to 0.3/0.6/0.9, text lengths)
    - `draftToEvent` makes an Event only after Confirm: a sighting needs a pin, and `searched` returns null because it needs a sector from the map
    - `PROXY_URL` is empty until the proxy is deployed
  - `proxy/` (`worker.js`, `wrangler.toml`, `README.md`): a Cloudflare Worker.
    - The DeepSeek key is a Worker secret (`wrangler secret put DEEPSEEK_API_KEY`), never in the repo.
    - The system prompt says the report is data, not instructions; it uses JSON mode at temperature 0, and the output goes back through `validateDraft`.
    - Best-effort per-IP rate limit (20/min); origin check via `ALLOWED_ORIGIN` (`*` for now; set the real site before the demo).
  - `tests/report.test.js`: 8 tests for `validateDraft`, `draftToEvent`, `parseReport` without a proxy, and no voice in Node.
- **Why:** BenStew asked for these files to be committed and pushed with Screen C.
- **Decisions:**
  - Kept as written: they were reviewed in Screen C and found sound (no keys in code, untrusted text handled as data, everything validated twice).
  - Committed separately from Screen C so the history shows they came from a different session.
- **How it was verified:**
  - `node --test`: 14/14 pass (sync + report).
  - A grep for API keys and secrets in these files found nothing.
  - The icons are 20 KB in total.
- **Known issues / not done:**
  - The report-box UI isn't wired into the page.
  - The proxy isn't deployed and `PROXY_URL` is empty.
  - `ALLOWED_ORIGIN` is `*`.
  - The service worker isn't registered and the manifest isn't linked.
  - Not tested in a browser yet.
- **Next:** create Firebase; Screen D (report box UI + proxy deploy); Screen E (register `sw.js`, link the manifest, Save my home area, GPS dot).

### Screen C: live sharing via Firebase REST, share/join links, names, messages, police hand-off sheet

- **Date:** 2026-11-21
- **Stage:** Screen C (BenStew)
- **What changed:**
  - `sync.js`: Firebase Realtime Database through plain REST, with no SDK.
    - `setDbUrl`, `isConfigured`, `newSearchId` (128-bit hex)
    - `createSearch` (PUT the case, adding `createdAt`)
    - `addEvent` (POST; queues in `localStorage` with no signal or no DB, and sends the queue first, in order)
    - `flushQueue`, `pendingCount`, `queuedEvents`
    - `applyChange` (pure put/patch mirror), `sortedEvents` (by `at`, then id)
    - `loadSearch`, and `subscribe` (EventSource live stream: `put`/`patch`/`cancel`, flushes on `open` and `online`)
    - No DOM or UI text, so it runs in Node.
  - `config.js`: `FIREBASE_DB_URL` (empty for now). On localhost only, `?db=` overrides it for testing.
  - `app.js`:
    - **Share this search:** creates the search in Firebase, moves this phone's events into it, then uses the Web Share API, falling back to the clipboard, then to a read-only link field.
    - **The link:** `#s=<id>&c=<case>&a=<demo|live>`. The case is packed into the link (base64url JSON), so it shows the same starting map even without the database.
    - **Opening a link** fills in the case (the database copy wins), joins the live stream and runs the map.
    - **Events:** `recordEvent()` gives every event a `cid` (its id on this phone), `by` (the name) and `at`. When shared, events show immediately ("optimistic") until Firebase echoes them back, and queued ones show too.
    - The engine re-runs only when `searched`/`sighting` events change, not for messages.
    - **Your name** is saved in `localStorage`.
    - **Message feed:** text only via `textContent`, never HTML, since messages come from other people.
    - **Hand-off sheet:** plain text in a `<dialog>` with Copy / Print / Close. It covers last seen (coords + time), mobility, heading, familiar places, a timeline of searches/sightings/messages, the top 8 places with coords and %, the live link and the disclaimer. A non-English sheet gets an English copy below it. Printing shows only the sheet.
    - A new last-seen point or Demo leaves the shared search.
  - `index.html`, `style.css`: share box (name, Share button, live status, fallback link field), message feed and input, hand-off button and dialog, print styles.
  - `i18n.js`: 41 new strings in all 5 languages, plus `tIn(lang, key)` and `formatTime`. `missingKeys()` is `{}`.
  - `firebase-rules.json`:
    - no listing of searches
    - read only with a 32-hex id
    - the case can be written once
    - events can only be added, with type whitelisted and text/note ≤ 300 characters
  - `tools/mock-firebase.py`: an in-memory stand-in for the Firebase REST API and live stream (port 9000) for testing with no account.
  - `README.md`: a "Set up live sharing (Firebase)" section.
  - `ShortPlan.md`: ticked "Share link" and "Police hand-off sheet".
  - `tests/sync.test.js`: tests for the sync API (from a parallel session, see below).
- **Why:** Screen C in `PLAN.md`. Sharing is "a big one" in the team doc.
- **Decisions:**
  - **Parallel session:** while Screen C started, another session or agent wrote `sync.js`, `report.js`, `sw.js`, `manifest.json`, `icons/`, `proxy/`, `tests/sync.test.js`, `tests/report.test.js` and `tools/make-icons.py` into this folder without committing. This session overwrote that `sync.js` by mistake; it wasn't in git, so it couldn't be recovered. `sync.js` was rebuilt to the API those tests expect (all 14 tests pass), plus the live stream. The other files are kept as they were, except two changes to `sw.js`: `config.js` added to its offline file list and `CACHE_VERSION` bumped to v2. They are **not committed here**; their owner should commit them (they're Screens D/E work).
  - **Every phone computes the map itself:** only the case and append-only events are in Firebase.
  - **The link carries the case** as well as the search id, so a link still shows the starting map when the database is down, blocked or not set up.
  - **Area source is shared** (`area: 'demo'|'live'` in the case and `a=` in the link), so joiners use the same street data as the starter.
  - **`nextFrame` uses `setTimeout(30)`, not `requestAnimationFrame`.** Testing found rAF never fires in a background tab, so a joining tab hung on "Loading streets…". The same would happen to a phone with the app in the background.
- **How it was verified:**
  - `node --test`: 14/14 pass.
  - Two browser tabs with `tools/mock-firebase.py`. Tab A ran Demo and shared ("Shared live…"). Tab B opened the link and got the same inputs, top spots and areas. B marked Area A searched and sent a message; A re-ranked the areas the same way and showed "Ben 1:00 PM: I have the park, heading north" within ~1 s. Reloading B rejoined with the demo data even from a link that said `a=live`, because the database case says `demo`.
  - The hand-off sheet in Spanish, with its English copy, has every section.
  - With no database: "Live sharing isn't set up…", and the link has `#c=` only.
  - No console errors. In the test browser the clipboard is blocked, so the fallback link field appeared as intended.
- **Known issues / not done:**
  - **Firebase isn't created yet:** BenStew has to make the project and paste the URL into `config.js` (README steps). Until then only the mock has been tested, not real Firebase.
  - Anyone with a link can read and add to that search (no accounts).
  - The hand-off English copy still formats dates and numbers in the current language.
  - The live link contains `?db=` when testing on localhost.
  - Hand-off numbers come from the fake engine.
  - The report-box UI (Screen D) isn't wired yet, though `report.js` and `proxy/` exist. `sw.js` isn't registered yet (Screen E).
- **Next:** create the Firebase project; commit the parallel session's files; Screen D (report box UI with `report.js` + proxy deploy); Screen E (register `sw.js`, Save my home area, GPS dot).

### Screen B: first steps, rings, colored streets, next areas with routes, sightings

- **Date:** 2026-11-21
- **Stage:** Screen B (BenStew)
- **What changed:**
  - `index.html`:
    - **First steps** (`<details>`, open until the first run): a big tap-to-call button with the local number, a 6-point "tell the dispatcher" script, and a 7-item house-and-yard checklist that turns green and strikes through when checked.
    - In the results: a **Report a sighting** button and form (tap the map; minutes ago; direction; how sure: maybe/probably/sure = 0.3/0.6/0.9; note).
    - **Next areas to search** list.
  - `app.js` (rewritten around one `recompute()`):
    - Every run, "searched" and sighting calls `engine.replay(area, case, state.events)`, then `drawResults()`.
    - New layers: streets colored by `edgeCounts` (5 purple steps, log scale), dashed rings at 0.5/1/1.5 mi with unit-aware labels, gray squares over searched sectors, orange "!" markers for sightings.
    - **Next areas:** `nextSectors(…, 20 min, 3)` shown as A/B/C squares on the map and in the list, with chance, route length and minutes from `routeFor`. Opening one draws its route and offers "Searched, nobody found" with minutes (defaults to the route's minutes). That adds a `searched` event.
    - Events get local ids (`local-<time>-<n>`); Screen C will use Firebase push ids. A new last-seen point or Demo clears the events. First steps collapse after a run.
  - `engine/fake.js` (still fake):
    - builds a bare node/edge list from `osm.ways` so colored streets can be drawn and tested
    - edge counts = walkers that stopped within ~75 m
    - sightings blend in a 250 m Gaussian blob weighted by reliability
  - `i18n.js`: 46 new strings in all 5 languages. `missingKeys()` is still `{}`.
  - `style.css`: styles for the new sections, plus **`pointer-events: none` on the status message**.
- **Why:** Screen B in `PLAN.md`.
- **Decisions:**
  - **Status message lets taps through.** Testing found the bottom-of-map message ("Tap the map where they were seen") swallowed the very tap it asked for. It now has `pointer-events: none`.
  - **Area letters vs. spot numbers.** Areas use letters on blue squares so they can't be confused with the numbered red "Check these first" spots.
  - **Search effort:** areas are ranked for 20 searcher-minutes (`DEFAULT_SEARCH_MINUTES`); the minutes typed when marking searched go into the event.
  - **No names yet:** `searched` events carry `by: ''` until Screen C adds names and sharing.
  - **Layer order** (bottom → top): streets, colored streets, heatmap, rings, searched, areas, route, spots, sightings, pins.
- **How it was verified:** built-in browser at 375×812, Demo case.
  - Demo in 0.88 s: first steps collapse; A/B/C areas with "9% chance they are here · Walking route: 800 m, about 15 min"; rings labeled 800 m / 1.6 km / 2.4 km (metric was on); rings visible when zoomed out.
  - Opening Area A draws its route. Marking it searched shows "Marked as searched…" and re-ranks the areas: the searched one drops out, the others move up.
  - Sighting: the tap lands (after the pointer-events fix); saving with "sure" moves the top spots near the sighting, adds the "!" marker with the note, and closes the form.
  - Chinese strings render. No console errors. Fake `replay` with 2 events on the Fremont data: 34 ms.
- **Known issues / not done:**
  - **Everything shown comes from the fake engine:** square routes (always 800 m / 15 min), streets colored only near endpoints, "searched" halves a sector, and the sighting is a blob. Jev's engine replaces all of it.
  - Events live only in this phone's memory; Screen C syncs them.
  - The house checklist isn't saved, so a reload clears it.
  - The live Overpass path is still untested in the browser.
- **Next:** Screen C: Firebase sync (two phones, one map), share/join links with names, message feed, police hand-off sheet.

### Screen A: map, inputs, 5 languages, data loading, fake engine, Fremont demo

- **Date:** 2026-11-21
- **Stage:** Screen A (BenStew)
- **What changed:**
  - `index.html`, `style.css`: phone-first layout.
    - Emergency banner: tap-to-call, can't be closed.
    - Full-height map.
    - Bottom panel: last-seen button, minutes, direction, mobility (big radio rows), up to 3 named familiar places, Run, Demo, language picker, mi/km button.
    - "Check these first" results with the "guide, not a guarantee" note.
    - On wide screens the panel moves to the left.
  - `app.js`:
    - map with OSM tiles; tap modes for the last-seen point and familiar places
    - builds the `CaseInput` from `INTERFACES.md`; loads the area, then `prepareArea` → `replay` → draws gray street lines, a heatmap from `grid.p`, and the top 8 spots (3 shown, "Show more")
    - tapping a spot flies to it; language and units are remembered in `localStorage`
    - `DEMO_LOCATION` / `DEMO_CASE` are at the top
  - `i18n.js`:
    - every UI string in en/es/fr/zh/ja; `t()`, `applyTranslations()`
    - region detection → emergency number table (default 911) and units (US/LR/MM imperial)
    - `formatDistance`, `formatPercent`, `formatDateTime`, `missingKeys()`
  - `data.js`:
    - Overpass query (walkable ways + trap features, `out body geom`), `parseOverpass` → `OsmData`
    - skips `waterway=pressurised` and culverts
    - retries across 3 Overpass servers with backoff (3 s, 6 s, 12 s…)
    - IndexedDB cache keyed by the point rounded to 3 decimals; `loadBundledArea` for the demo
  - `engine/fake.js`: dev-only stand-in with the `INTERFACES.md` exports. Walkers scatter in straight lines and ignore streets; "searched" just halves a sector. It exports `IS_FAKE`, so the UI shows a "practice results" note. **Delete it at integration** and switch the import in `app.js` to `./engine/index.js`.
  - `tests/fixtures/demo-area.json` (3.0 MB, 0.6 MB gzipped): real Fremont `OsmData`, 3.2 km around 37.5530, −121.9700. It has 33,059 nodes, 7,695 ways and 228 features (83 creeks, 18 water, 6 wetland, 2 river, 4 woods, 2 brush, 84 grass, 29 parks). It serves as both the Demo data and the engine test fixture.
  - `tools/make-fixture.js`: rebuilds that fixture (download, or from a saved Overpass answer).
  - `lib/`: Leaflet 1.9.4 (`leaflet.js`, `leaflet.css`) and Leaflet.heat 0.2.0 (`leaflet-heat.js`), from unpkg.
  - `package.json`: `{"type": "module"}` + `npm test` → `node --test`, with no dependencies.
- **Why:** Screen A in `PLAN.md`: give the screen something real to show before Jev's engine exists.
- **Decisions:**
  - **Demo uses bundled data.** Both public Overpass servers answered "at capacity" (502/504) for about 20 minutes during this build, so the Demo button loads the bundled Fremont file instead of downloading. The demo then works for judges no matter what Overpass is doing.
  - **Demo case:** last seen on Placer Way / Tehama Avenue (37.5405, −121.9795), a residential street with a drainage creek ~100 m away. 45 min, heading NE, slow walker, familiar place Lake Elizabeth (37.5485, −121.9630), seed 20261121. The map opens at the fixture center near Central Park.
  - **Streets are drawn from `osm.ways`, not `area.graph`.** The fake engine doesn't build a graph, so it doesn't duplicate Jev's work. Colored-by-use streets (Screen B) will use the real graph's `edgeCounts`.
  - **Heatmap:** the top 4,000 cells, weight = p / max p, `max: 3`. With `max: 1` it saturated into one red blob; with `max: 6` nothing reached red.
  - **No separate page code for the fixture:** the fixture lives under `tests/` (the path in `INTERFACES.md`) and the website loads it from there too, rather than keeping two copies.
  - `.claude/launch.json` (dev server config) is not committed; the repo owner's global git ignore excludes `.claude/`.
- **How it was verified:**
  - Built-in browser at 375×812. Banner, tap modes, inputs, adding/removing familiar places, and switching en → es → ja all worked with no console errors. `missingKeys()` returns `{}`.
  - Demo: results in 0.41 s. Spot text such as "Creek 50 ft off Ralston Common – 9% of walkers" with the hazard line; tapping a spot zooms to it; mi/km switches ("10 m"); "Show 5 more" shows 8.
  - The fake engine on its own: `replay` 12 ms, `grid.p` sums to 1.
  - `node --check` on every JS file.
- **Known issues / not done:**
  - **The live download path (a last-seen point outside the demo area) wasn't tested in the browser**, because Overpass was at capacity. The same code worked from Node once a server came back (6.3 MB in 49.5 s), so a real search can take close to a minute on a busy day.
  - Fake-engine spot text can be wrong (e.g., the creek distance is really the spot-to-street distance). The real engine replaces it.
  - The Overpass query skips relations (multipolygon parks and lakes), so some large parks or lakes may be missing.
  - The translations are AI-written and unchecked by native speakers.
  - No service worker yet (Screen E), so nothing works offline.
- **Next:** pause for BenStew's check. Then Screen B: colored streets, rings, sectors + routes UI, 911 script + house checklist, sighting form.

### Merge the team's planning doc: team roles, routes, messaging, report box, Fremont

- **Date:** 2026-11-21
- **Stage:** Setup
- **What changed:**
  - `PLAN.md`: rewritten to merge the team's planning doc.
    - team table: BenStew screen + hosting, Jev engine by hand, Nathan tests/debugging/speed
    - routes for searchers, a message feed and the voice/text report box (DeepSeek through a serverless proxy, confirm before use)
    - prior from several public sources; Fremont, CA as the demo area
    - new files `report.js`, `proxy/`, `engine/routes.js`, `bench/`
    - new schedule, cut order and LLM privacy limit
  - `ShortPlan.md`: updated "what it does" (routes, messages, report box), the "not a chatbot" wording, the team line, and the must-have list.
  - `INTERFACES.md`:
    - team names, and three-way agreement for changes
    - `message` event type, and "the engine ignores event types it doesn't use"
    - new `routeFor(area, prediction, sectorId) → Route`
    - the `ReportDraft` shape for the report box
    - skip `waterway=pressurised` and culverts when finding creeks
    - a routes test
  - `CLAUDE.md`: team section with names and files; the "never call it a chatbot" rule; Fremont; the two online parts (Firebase + LLM proxy); never put an API key in website code.
  - `CommitHistory.md`: "Project context" rewritten; this entry.
- **Why:** the team wrote its own planning doc ("Components of What We're Going to Build"). BenStew asked for every document to be updated to match it.
- **Decisions:**
  - BenStew is the repo owner and builds screen + hosting. Nathan's tests may be written with AI help; Jev's engine may not.
  - **Messaging and the report box are must-haves by the deadline**, not after the core. That reverses the earlier "no messaging, no chatbot" decision.
  - The report box is narrow: LLM output is a draft, the person confirms, and the engine only sees normal events. It isn't called a chatbot, following the team doc's "people don't want to see chatbot when they are panicking".
  - The DeepSeek key lives in a serverless proxy, not the page. Cloudflare Workers is the leading option, since Firebase Cloud Functions needs a paid plan. Final choice is BenStew's hosting research.
  - **Demo area: Fremont, CA** instead of Austin. The team doc wants the engine to be "an expert in Fremont", and BenStew asked for the city I'd recommend. Fremont has dense OSM data, several creeks and drainage channels, and parks, and the team can do a field drill there.
  - Routes come from the engine (`routeFor`), inside the sector chosen by greedy allocation.
- **How it was verified:**
  - Overpass query within 1,600 m of 37.5530, −121.9700: 3,408 walkable ways and 85 trap features (Laguna, Mission and Irvington creeks, drains, parks). It also found Bay Division Pipelines tagged `waterway=pressurised`, hence the skip rule.
  - Docs only otherwise.
- **Known issues / not done:**
  - Jev and Nathan haven't reviewed `INTERFACES.md`.
  - The LLM provider's privacy terms aren't checked; reports leave the phone.
  - The README body is still pre-merge.
  - The scope is now large for the time left; `PLAN.md` has the cut order.
- **Next:** push; all three review `INTERFACES.md`; then the skeleton and Screen A.

### Add ShortPlan.md: 2-minute read of what FindThem is

- **Date:** 2026-11-21
- **Stage:** Setup
- **What changed:**
  - `ShortPlan.md` (new): a one-sentence summary, why it matters (2 stats), who it's for, the 7 steps a user goes through, how it works in plain words, what it is NOT, the must-work-by-the-deadline checklist, and the benchmark under "after the core works (still required)".
  - `CLAUDE.md`: reading order is now ShortPlan → PLAN → INTERFACES → CommitHistory → README. New rule: update `ShortPlan.md` in the same commit whenever the product changes (who, what, what it is NOT, priorities) and tick its checkboxes as features work.
  - `README.md`: a pointer to `ShortPlan.md` at the top, since the README itself still describes the pre-merge app.
  - `CommitHistory.md`: the intro points to `ShortPlan.md` first; this entry.
- **Why:** the repo owner wanted a quick read for themselves and their teammate, kept up to date automatically.
- **Decisions:**
  - Audience is the two builders, not judges. Mostly bullets, light on the how, no formulas.
  - Sections: why, who, what it does, how it works, what it is NOT, priorities. Team split and the evidence/limits sections are left to `PLAN.md`.
  - Update rule: when the product changes, not on every commit.
- **How it was verified:** word count checked: 562 by `wc -w`, including markdown symbols, about a 2-minute read.
- **Known issues / not done:** the README body is still pre-merge.
- **Next:** push so the teammate can review `INTERFACES.md` and `ShortPlan.md`; then the skeleton and Screen A.

### Add INTERFACES.md: contract between screen and engine

- **Date:** 2026-11-21
- **Stage:** Setup
- **What changed:** `INTERFACES.md` (new) defines everything that passes between the screen (`app.js`, `data.js`, `sync.js`) and the hand-written engine (`engine/`, `tests/`):
  - ground rules: ES modules with one entry point, `engine/index.js`; pure and deterministic, no `Math.random` or `Date.now`; units; local x/y meters
  - input shapes: `OsmData` (what `data.js` returns, with the OSM tag → trap-type table and `HAZARD_TYPES`), `CaseInput`, and `Event` (`searched` / `sighting` / `assigned`)
  - engine exports: `prepareArea`, `replay` (the main call), `cellToLatLng`, `nextSectors`, `topSpots`, with their output shapes
  - tunable constants, the tests the engine must ship, and the Firebase data layout
- **Why:** two people build in parallel (screen vs. engine), so the hand-off has to be fixed before either starts. `PLAN.md` calls for this file first.
- **Decisions:**
  - **One main call.** `replay(area, caseInput, events)` instead of the screen chaining `simulate` → grid → updates. Every phone rebuilds the same map from the case + event list, so Firebase stores only small, append-only events.
  - **Fixed times.** `CaseInput` is one object (not the original 8-argument `simulate`). `minutes` is fixed when the search is created and sightings store `minutesSince` at report time, so results stay deterministic. Limit: the map doesn't grow over time.
  - **Sighting seeds:** `(seed + 7919·k) >>> 0` for the k-th sighting.
  - **Grid:** 25 m cells, sectors of 8×8 cells (200 m), grid radius 3,200 m (the same as the Overpass radius).
  - **Engine vs. screen:** the engine returns numbers and names; the screen builds all translated text (no strings in the engine). `data.js` maps OSM tags to trap types; the engine never sees raw tags.
  - **Imports:** `engine/fake.js` (screen-owned, dev only) has the same exports until integration.
  - **Give-up distance:** `GIVE_UP_SIGMA` ≈ 0.52 makes a lognormal with median 850 m put ~89% within 1 mile.
- **How it was verified:** docs only. The teammate hasn't reviewed it yet.
- **Known issues / not done:** `topSpots` (clustering) adds engine work. If the engine side runs short on time, it can move to the screen side, but only by agreement. `package.json`, `engine/fake.js` and the demo fixture don't exist yet.
- **Next:** the teammate reviews and agrees `INTERFACES.md`. Then the skeleton: `package.json`, `engine/index.js` + `engine/fake.js`, `/lib`, the Firebase project. Then Screen A.

### Merge EvoHacks II game plan; commit CLAUDE.md and PLAN.md

- **Date:** 2026-11-21
- **Stage:** Planning (before Stage 1)
- **What changed:**
  - `PLAN.md` (new): the merged build plan. It combines the original build prompt with the EvoHacks II game plan ("FirstHour": Bayesian search, sectors, shared coverage, sightings, hand-off, benchmark).
  - `CLAUDE.md` (now committed): rules for AI agents. Team split, "AI must not write engine code", the required benchmark, the commit-log rules, code rules, how to run.
  - `CommitHistory.md`: "Project context" rewritten for the merged plan; this entry.
  - `.gitignore`: also ignores `.claude/settings.local.json` (personal permissions).
- **Why:** the repo owner received the game plan and asked for it to be merged with the original prompt. Their teammate needs `CLAUDE.md` and the plan through `git pull`.
- **Decisions:**
  - **Name:** FindThem, not FirstHour.
  - **Model:** walkers feed the grid, not grid-only or walkers-only. Walkers capture real streets, dead ends and creeks; the grid does detection, updates and allocation.
  - **Sync:** Firebase RTDB through REST, not Supabase (needs a ~100 KB library) or our own server (more to build).
  - **Benchmark:** required but built after the core, because the Nov 22 deadline leaves about a day and a half.
  - **AI disclosure:** AI use is disclosed in the repo, which reverses the previous entry's "AI tool files stay out of git" decision. Commits still carry no attribution lines.
  - **Ignore rule:** the repo owner's global git ignore (`~/.config/git/ignore`) lists `CLAUDE.md`, so it was force-added once. It's tracked normally from now on.
- **How it was verified:** docs only. `git status` checked before committing.
- **Known issues / not done:**
  - `README.md` still describes the pre-merge app (no sectors, sync or sightings; median 0.88 km) and doesn't yet disclose AI use. Update it with Stage 1.
  - `ROADMAP.md` and `INTERFACES.md` aren't written. The Firebase project isn't created.
- **Next:** setup. Write `INTERFACES.md` with the teammate, add skeleton files and `/lib`, create the Firebase project, update the README, then Screen A (map + inputs + i18n + `data.js` + fake engine).

### Add project docs and gitignore

- **Date:** 2026-11-21
- **Stage:** Planning (before Stage 1)
- **What changed:**
  - `README.md`: describes the *finished* app (features, how the prediction works, languages and units, file table, running locally, GitHub Pages deploy, credits). Most of what it lists doesn't exist yet; a status note near the top says so.
  - `CommitHistory.md`: this file.
  - `.gitignore`: ignores `.DS_Store`.
- **Why:** the README came first so the plan was written down before any code. This log exists so anyone, including an AI agent without the planning chat, has the full context from the repo alone.
- **Decisions:**
  - Each developer's AI tool instruction files and local tool settings are not committed. Each person ignores them on their own machine (in `.git/info/exclude`), not in `.gitignore`. The "How to add an entry" rules at the top of this file are the shared copy of the logging rules.
  - The repository is private on GitHub. GitHub Pages on a free account needs a public repo, so it has to be made public before deploying.
  - The README credits Robert Koester's lost-person behavior research for the dementia statistics (median ~0.88 km, ~89% within 1 mile). That citation hasn't been checked.
- **How it was verified:** docs only; `git status` checked before committing so only these three files were added.
- **Known issues / not done:** no app code. `ROADMAP.md` isn't written yet.
- **Next:** Stage 1 (map + inputs). If two people build in parallel, first agree the hand-off points between `data.js`/`sim.js` and the UI files in an `INTERFACES.md`.
