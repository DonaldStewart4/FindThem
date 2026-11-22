# FindThem: build plan

This merges three sources:
- the original build prompt: a plain-JS PWA that runs 5,000 simulated walkers on the OpenStreetMap street graph, with a heatmap, "Check these first", offline mode and share links
- the EvoHacks II game plan: Bayesian search theory, sectors, a shared live record of what's been searched, sightings, a police hand-off, and evidence
- the team's planning doc ("Components of What We're Going to Build"): engine vs. screen, routes for searchers, messaging, a voice/text report box, Firebase

> **Update 2 (Nov 21):** the official EvoHacks 2 rules *encourage* AI use and say nothing against AI building the whole project or about explaining your own code on video (that came from the game plan's reading of an older page). **The engine is now built with Claude Code** at BenStew's request. Submission needs a public repo, setup instructions and a **2–3 minute** video; judging is 25% each for impact, technical execution, creativity and presentation.
>
> **Update (Nov 21, afternoon):** "Jev" in the team doc is **not a teammate**. It's TypeSafe AI's Jev model, now used in the report box instead of DeepSeek. The team is BenStew + Nathan. (The engine was briefly planned as hand-written by BenStew; Update 2 replaced that.)

EvoHacks II's theme is **social good**. **Deadline: Sun Nov 22, 2026, 12:00 pm**, with freeze at 9:30 am.

## Status (Nov 21, night)
**Done and pushed:**
- all five screens
- the real engine, calibrated to the research
- live sharing on real Firebase (`findthem-f4e5c`, rules tested)
- report box code (Jev proxy, tested with a fake Jev), plus a voice bot (Deepgram speech → text, ElevenLabs read-back in English) that falls back to the phone's voice input without keys; proxy deployed with both voice keys
- map search (magnifying glass), clear offline messages, Demo offline
- offline PWA
- 5 languages
- the benchmark (FindThem 54% vs. 21% on their own at 1,500 searcher-minutes)
- 72 tests
- report box backup reader on the phone (`quickread.js`, 5 languages) for when Jev can't answer, and a 40-report scorer for Jev (`npm run jev-eval`)
- report box safety layer (branch `agent-contract`, not merged yet): Jev's answers are cross-checked against the report's own words, conflicting fields are left empty, and drafts carry `unsure` / `flags` codes (water, vehicle, emergency...); 74 adversarial reports scored right / abstained / dangerous (`npm run safety-eval`), 0 dangerous for the backup reader; street corners pinned where the streets cross; `INTERFACES.md` §5 updated (ReportDraft v2). The screen doesn't show the flags yet: the exact list is in `docs/AGENT-CONTRACT.md`, "Screen work". Contract for future agent features: `docs/AGENT-CONTRACT.md`
- the app asks for location on start; searchers see each other as green dots in a shared search (rules published and tested on the live database)
- commit emails switched to the GitHub noreply address
- "What you know" is five numbered steps that fold into a summary after Find; the map redraws every 5 minutes as time passes (all phones in step)
- full test pass in the browser (Nov 21, 9:17–9:40 PM): phone and laptop sizes, all 5 languages, two-tab shared search, database dropping out, offline, a brand-new area (Palo Alto, live download 35 s). Fixed 8 issues (see the "Testing pass" entries in `CommitHistory.md`)
- laptop layout fixed: only the side panel scrolls; the loading bar no longer hides under the map search box
- first phone feedback fixed: red/orange/yellow likely areas instead of the all-blue heatmap, a clear "tap the map" bar, a turnable direction arrow, a loading bar

**Left, in order:**
1. ✅ **Repo public, GitHub Pages on:** live at **https://donaldstewart4.github.io/FindThem/**. Checked: all files load, Demo 0.6 s, sharing through Firebase, offline worker registered.
2. **Proxy deployed** at `https://findthem-proxy.findthem-evohacks.workers.dev` with the Deepgram and ElevenLabs keys; `PROXY_URL` is set. **Still needed:** the TypeSafe key (Nathan, `NATHAN.md`).
3. **Test on two real phones:** sharing and the green searcher dots, **voice with a real microphone** (iPhone especially), offline, and the speed of the Demo.
4. Nathan's UI review and Jev scoring once the key is in (his full list is in `NATHAN.md`).
5. **Video script and Devpost write-up** (not started), then **film** (Sun 8–10 am), Nathan edits and submits by 11:00.


## The user and the moment
A family member or neighbor in the first hour after a person with dementia goes missing, before professionals arrive. The app tells them where to look first, gives each searcher a route, keeps everyone talking on one shared map, and updates as places come up empty or someone reports a sighting.

## Team
| Who | Part | AI use |
|---|---|---|
| **BenStew** (repo owner) | **Screen + hosting**: UI, map, data fetching, sync, messaging, report box, PWA, picking the free hosting and LLM provider, security | AI helps build |
| **BenStew** | **Engine**: prior, detection, allocation (routes), updates | Built with Claude Code (allowed by the official rules) |
| **Nathan** | **Optimization**: tests, debugging, speed and reliability; tuning the Jev questions | AI may help write tests; Nathan reviews them and can explain them |

The official rules encourage AI use; we disclose who and what built each part.

## Decisions
- **Name:** FindThem.
- **Model:** walkers feed the grid. Walker endpoints become the starting probability map on a 25 m grid; the grid does detection, updates and allocation.
- **Live data:** Firebase Realtime Database through its REST API (`fetch` + `EventSource`), no SDK. Supabase is the fallback if Firebase doesn't work out.
- **Report box, not a "chatbot":** the word "chatbot" never appears in the UI, because people who are panicking don't want one.
  - The searcher types or speaks a report ("saw him by the creek on Paseo Padre ten minutes ago").
  - **Jev** (TypeSafe AI) answers five multiple-choice questions about it: kind, direction, minutes ago, how sure, and which nearby named place. Each answer comes with a confidence, and anything below `MIN_CONFIDENCE` is left empty for the person to fill in.
  - The person confirms it, and only then does it go to the engine as an event.
  - The LLM never sets probabilities. The manual sighting form is always there as a fallback, and is the only option when offline.
- **AI key safety:** the Jev (TypeSafe) key must never be in the website's code. A free Cloudflare Worker holds it as a secret (Firebase Cloud Functions would need a paid plan). There is no FastAPI or other server.
- **Hosting:** BenStew researches free providers and security. GitHub Pages is the default for the static site; the repo must go public before deploying there.
- **Demo and tuning area: Fremont, CA**, around Central Park / Lake Elizabeth (about 37.553, −121.970). The team knows the area. Within 1 mile there are 3,408 walkable ways and 85 trap features (Laguna Creek, Mission Creek, Irvington Creek, drainage channels, parks). The app still works anywhere.
- **AI disclosure:** the README and Devpost text name the AI tools and say what each built.
- **Must-haves by the deadline:**
  - engine + tests
  - map + inputs
  - shared searched areas
  - routes for searchers
  - sightings
  - **messaging between searchers**
  - **the voice/text report box**
  - share link
  - police hand-off sheet
  - offline PWA
  - all 5 languages (en/es/fr/zh/ja)
  - Demo button
- **Benchmark vs. uncoordinated volunteers: required, built after the core works.**
- **Kept from earlier:**
  - units from the phone's region, with a mi/km toggle
  - local emergency number as a tap-to-call banner that can't be dismissed
  - one commit per stage, each with a `CommitHistory.md` entry

## What it does
0. **Call 911 first.** A script to read to the dispatcher. The banner is always on screen.
1. **House and yard, 2 minutes.** A checklist: closets, under beds, garage, parked cars, shed, neighbors' yards. In Koester's data, 18% were found in a house.
2. **When and which way.** Last-seen pin, minutes since last seen, heading (a doorbell camera often shows it), mobility, up to 3 familiar places.
3. **The map.**
   - heatmap
   - streets colored by walker use
   - rings at 0.5/1/1.5 mi
   - the top 3 places to check first, shown large (8 when expanded), each with a reason such as "Creek 130 ft off Main St – 12% of walkers"
4. **Searchers get routes.**
   - Each searcher joins by share link and gets a sector and a walking route through it, highest-probability streets first.
   - The next assignment comes from greedy allocation (probability gained per searcher-minute).
   - Water and dense brush are flagged for professionals.
5. **Talk and report.**
   - A shared message feed for everyone on the search.
   - A report box (type or speak) that turns a report into a sighting or "searched" update after the person confirms it.
6. **Updates.** Marking a route or sector searched, or confirming a sighting, syncs to every phone and updates the map with Bayes.
7. **Hand-off sheet.** One tap gives police a sheet with the timeline, areas searched and how well, sightings, what's left, and the top spots.
8. **Before an emergency:** "Save my home area" (address search, map tap or GPS) stores the map data for offline use.

"This is a guide to help focus the search, not a guarantee" shows under the results.

## The engine (BenStew, built with Claude Code)
- **Prior: the hard part.** A "smart map" built from several reliable public sources:
  - Koester's lost-person statistics for dementia (distance from the last-seen point, distance from roads, where people were found)
  - OSM streets, paths and trap features
  - familiar places
  - walking time
  - BenStew picks and documents each source. Walkers carry it onto the real street graph.
- **Walkers.**
  - 5,000 per run from a seeded random number generator.
  - Each one starts at the nearest node. The first edge is weighted by the heading, if one was given.
  - Budget = min(speed × minutes × 60 × 0.6, a lognormal give-up distance with median ~850 m). Speeds: 1.0 / 0.7 / 0.45 m/s.
  - At each intersection the turn weight is exp(−turn / 30°). No U-turns. Stop at dead ends.
  - Edges heading toward the nearest familiar place get × 1.5.
  - At the end, a walker within 30 m of a trap feature moves into it with probability 0.6.
- **Grid prior.** Endpoints smoothed onto 25 m cells, plus a small floor so no cell is zero.
- **Detection (the easy part).** POD = 1 − e^(−coverage), Koopman's formula.
- **Allocation.**
  - Greedy sector choice by probability gained per minute, verified against brute force on tiny grids.
  - **Routes for people:** an ordered walking route along the streets of the assigned sector, highest-probability streets first.
- **Updates: grids, routes, everything.**
  - Empty search: p_cell × (1 − POD), then renormalize.
  - Sighting: rerun the walkers from the sighting and blend with reliability r.
  - Routes and recommendations recompute after every event.
- **Statistics to double-check against Koester:** median found distance 0.8 km (the original prompt said 0.88), 89% within 1 mile, median 30 m from a road.

## Files
| File | Owner | Job |
|---|---|---|
| `index.html`, `style.css` | BenStew | layout, mobile-first styles |
| `app.js` | BenStew | map, inputs, layers, panels, steps 0–8 |
| `data.js` | BenStew | Overpass fetch + IndexedDB cache + Nominatim; returns raw OSM ways, nodes and features |
| `sync.js` | BenStew | Firebase REST + EventSource: case, events, messages; offline write queue |
| `report.js` | BenStew | voice (Deepgram via the proxy, or the browser's speech recognition) or text → Jev proxy → structured draft for the person to confirm; optional ElevenLabs read-back |
| `proxy/worker.js`, `proxy/jev.js` | BenStew (Nathan tunes the questions) | Cloudflare Worker that holds the Jev key, asks Jev five questions, returns a `ReportDraft` |
| `i18n.js` | BenStew | all UI text in 5 languages, emergency numbers, units |
| `sw.js`, `manifest.json`, `icons/`, `lib/` | BenStew | PWA, Leaflet 1.9.4 (Leaflet.heat removed Nov 21 evening: replaced by likely-area bands) |
| `engine/graph.js`, `engine/sim.js`, `engine/grid.js`, `engine/routes.js`, `engine/index.js` | BenStew (with Claude Code) | graph, walkers, grid math, routes |
| `tests/*.test.js`, `bench/` | Nathan | `node --test`, speed checks, later the benchmark |
| `INTERFACES.md` | all | exact function signatures and data shapes; change only by agreement |
| ~~`engine/fake.js`~~ | — | dev-only fake engine; **deleted** when the real engine was integrated |
| `ShortPlan.md`, `PLAN.md`, `CLAUDE.md`, `README.md`, `ROADMAP.md`, `CommitHistory.md` | all | docs |

**Sync design.**
- Every phone recomputes the map from the same inputs, seed and event list (the engine is deterministic).
- Firebase stores only small events under `searches/<random 128-bit id>`: `case`, and `events` (`searched`, `sighting`, `assigned`, `message`). The engine ignores `assigned` and `message`.
- Access is by exact search id only, with no accounts in this version.
- While offline, writes queue in `localStorage` and flush on reconnect.

## Not built now
Chatbot persona, camera integration, trackers, GPS-trail coverage, drill mode, accounts, photos, and everything in `ROADMAP.md`.

## Schedule
1. ✅ **Setup:**
   - docs and `INTERFACES.md` (all three agree)
   - skeleton files, `/lib`, `package.json`
   - Firebase project, demo fixture for Fremont
   - BenStew starts the hosting/proxy research
2. ✅ **Screen A:** map + inputs + i18n + `data.js` + fake engine results.
3. ✅ **Screen B:** heatmap, colored streets, rings, top spots, sectors and routes UI, 911 script + house checklist, sighting form.
4. ✅ **Screen C:** Firebase sync (two phones share one map), share and join links, message feed, hand-off sheet.
5. ✅ **Screen D:** report box (voice/text → proxy → confirm → event), with the manual form as fallback.
6. ✅ **Integration with the real engine:** `fake.js` swapped for the real engine, and the tests pass.
7. ✅ **Screen E:** offline PWA, Save my home area, GPS dot, Demo button. Nathan does a speed and reliability pass.
8. ✅ **Benchmark** (required, after the core works; Nathan + BenStew): uncoordinated volunteers vs. ring sweep vs. FindThem allocation, with a results table in the README.
9. **Freeze at 9:30 am Nov 22.** Deploy, 3-minute video, Devpost text. Submit by 11:00.

**If time runs short, cut from the end of this list:** engine + tests → shared coverage → sightings → share link → routes → messaging → report box → hand-off → demo → benchmark → offline → languages beyond en/es.

## Verification
- `node --test`:
  - the same seed gives the same output
  - probabilities sum to 1 after every update
  - greedy allocation matches brute force on a tiny grid
  - routes stay inside their sector and on real streets
- Phone-size browser (375×812).
- Two tabs on one search id: a searched area, a message and a confirmed report each show up in the other tab within ~1 s.
- Report box: messy inputs ("i think i saw her near the lake like 10 min ago??") give a sensible draft, and nothing reaches the engine without a confirm tap.
- Offline: the map, prediction, manual sighting form and queued writes all still work; the report box says it needs signal.
- The Demo button runs end to end in under 5 s on the Fremont area.

## Limits to state
- The source data is small, old and mostly rural (87 Virginia cases).
- Nothing has been validated on real searches.
- Untrained volunteers should not enter water or dense brush.
- Browser GPS only works while the page is open.
- Anyone with a search link can see and edit that search.
- **Reports sent to Jev leave the phone.** TypeSafe is a third-party service, so the report box warns before sending. Language support isn't documented; test Spanish, French, Chinese and Japanese reports, and fall back to the manual form if needed.
