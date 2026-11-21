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

Current decisions. Updated 2026-11-21 after merging the EvoHacks II game plan into the original build prompt. `PLAN.md` has the full plan; this section overrides the original prompt where they differ.

- **What it is:** FindThem, a phone-first PWA for the first hour after a person with dementia goes missing. Simulated walkers on the real OpenStreetMap street graph give a starting probability map on a 25 m grid. Volunteers get sectors by link. Each empty search and each sighting updates the map with Bayesian search theory, live on every phone. A hand-off sheet goes to police at the end.
- **Event:** EvoHacks II, theme social good. **Deadline Sun Nov 22, 2026, 12:00 pm**; code freeze 9:30 am; submit by 11:00 am. The rules say AI may not build the whole project, each person explains their own code on video, and AI use is disclosed.
- **Team:**
  - The repo owner builds the **screen** (UI, map, data fetching, sync, PWA) with AI help.
  - A teammate writes the **engine** (`engine/`, `tests/`) **by hand**. AI must not write engine code.
  - `INTERFACES.md` is the contract between the two halves.
- **Tech:**
  - plain HTML/CSS/vanilla JS, no frameworks, no build step
  - Leaflet 1.9.4 + Leaflet.heat 0.2.0 in `/lib`
  - OSM tiles; Overpass for streets and terrain; IndexedDB cache; service worker
  - Firebase Realtime Database through its REST API (no SDK), for live sync only; the prediction runs on the phone
  - engine tests with `node --test`
- **Must-haves:** engine + tests, map + inputs, shared searched-sectors sync, sightings, Demo button, all 5 languages (en/es/fr/zh/ja), offline PWA, police hand-off sheet.
- **Required, after the core works: the benchmark.** Simulated wanderers; uncoordinated volunteers vs. coordinated ring sweep vs. FindThem allocation; a results table in the README.
- **Kept from the first planning round:**
  - **Units:** the phone's region decides (US, Liberia, Myanmar → miles/feet; elsewhere km/m), with a mi/km toggle. Rings are always 0.5/1/1.5 mi on the ground.
  - **Emergency banner:** the local number from a country table (default 911), tap-to-call, can't be dismissed.
  - **Save my home area:** from an address search (Nominatim), a map tap, or GPS.
  - **Demo location:** near Shoal Creek, Austin TX, to be checked against Overpass. It's `DEMO_LOCATION` at the top of `app.js`.
  - **Deploy:** GitHub Pages. The repo is private now and must go public before deploying.
- **Replaced:** "mark streets searched" and "copy summary for police" (the old stretch goals) became syncing sectors and the hand-off sheet. The "no Claude in the repo" rule is dropped: AI tools are disclosed openly and `CLAUDE.md` is committed.
- **Do not build** chatbots, camera integration, trackers, GPS-trail coverage, drill mode, accounts, messaging or photos, or anything else on the roadmap.

## Log

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
