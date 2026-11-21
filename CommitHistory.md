# Commit History

A detailed log of every commit, for people and AI agents who don't have the chat history behind this project. `git log` gives one-line titles; this file explains what changed, why, what was decided, and what's left.

**Read `ShortPlan.md` first** (2 minutes) if you're picking up the project cold, then this file and `PLAN.md`. Then read `README.md` (what the app is) and `ROADMAP.md` (what's deliberately not built, once written).

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

Current decisions. Updated 2026-11-21 after merging the team's planning doc ("Components of What We're Going to Build") into `PLAN.md`. `PLAN.md` has the full plan; this section overrides the original prompt where they differ.

- **What it is:** FindThem, a phone-first PWA for the first hour after a person with dementia goes missing. Simulated walkers on the real OpenStreetMap street graph give a starting probability map on a 25 m grid. Searchers join by share link and each gets a sector and a walking route. A shared message feed and a voice/text report box keep everyone in touch. Each empty search and each confirmed sighting updates the map with Bayesian search theory, live on every phone. A hand-off sheet goes to police at the end.
- **Event:** EvoHacks II, theme social good. **Deadline Sun Nov 22, 2026, 12:00 pm**; code freeze 9:30 am; submit by 11:00 am. The rules say AI may not build the whole project, each person explains their own code on video, and AI use is disclosed.
- **Team:**
  - **BenStew** (repo owner): screen + hosting, with AI help. Also researches the free hosting, the LLM proxy and security.
  - **Jev:** engine (`engine/`), **hand-written**. AI must not write engine code.
  - **Nathan:** tests, debugging, speed (`tests/`, `bench/`). AI may help write tests.
  - `INTERFACES.md` is the contract; changes need all three to agree.
- **Tech:**
  - plain HTML/CSS/vanilla JS, no frameworks, no build step
  - Leaflet 1.9.4 + Leaflet.heat 0.2.0 in `/lib`
  - OSM tiles; Overpass for streets and terrain; IndexedDB cache; service worker
  - Firebase Realtime Database through REST (no SDK) for the case, events and messages, with Supabase as the fallback
  - a tiny serverless proxy (Cloudflare Workers is the leading option) holding the DeepSeek key for the report box
  - the prediction runs on the phone; tests use `node --test`
- **Must-haves by the deadline:** engine + tests, map + inputs, shared searched areas, routes for searchers, sightings, messaging, the voice/text report box, share link, police hand-off sheet, offline PWA, all 5 languages (en/es/fr/zh/ja), Demo button.
- **Report box rules:** never called a "chatbot" in the UI. The LLM turns text or voice into a draft; the person confirms before it becomes an event; the LLM never sets probabilities; the manual form is the fallback and works offline.
- **Required, after the core works: the benchmark.** Simulated wanderers; uncoordinated volunteers vs. coordinated ring sweep vs. FindThem allocation; a results table in the README.
- **Demo and tuning area: Fremont, CA**, around Central Park / Lake Elizabeth (~37.553, −121.970). It replaces Austin. Checked against Overpass: 3,408 walkable ways and 85 trap features within 1 mile. `waterway=pressurised` (underground pipes) must be skipped.
- **Kept from the first planning round:**
  - **Units:** the phone's region decides (US, Liberia, Myanmar → miles/feet; elsewhere km/m), with a mi/km toggle. Rings are always 0.5/1/1.5 mi on the ground.
  - **Emergency banner:** the local number from a country table (default 911), tap-to-call, can't be dismissed.
  - **Save my home area:** from an address search (Nominatim), a map tap, or GPS.
  - **Deploy:** GitHub Pages by default, pending BenStew's research. The repo is private now and must go public before deploying there.
- **Replaced:** "mark streets searched" and "copy summary for police" (the old stretch goals) became syncing sectors/routes and the hand-off sheet. The "no Claude in the repo" rule is dropped: AI tools are disclosed openly and `CLAUDE.md` is committed.
- **Do not build** a chatbot persona, camera integration, trackers, GPS-trail coverage, drill mode, accounts or photos, or anything else on the roadmap.

## Log

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
