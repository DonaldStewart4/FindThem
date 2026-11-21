# FindThem: build plan

This merges three sources:
- the original build prompt: a plain-JS PWA that runs 5,000 simulated walkers on the OpenStreetMap street graph, with a heatmap, "Check these first", offline mode and share links
- the EvoHacks II game plan: Bayesian search theory, sectors, a shared live record of what's been searched, sightings, a police hand-off, and evidence
- the team's planning doc ("Components of What We're Going to Build"): engine vs. screen, routes for searchers, messaging, a voice/text report box, Firebase

EvoHacks II's theme is **social good**. **Deadline: Sun Nov 22, 2026, 12:00 pm**, with freeze at 9:30 am.

## The user and the moment
A family member or neighbor in the first hour after a person with dementia goes missing, before professionals arrive. The app tells them where to look first, gives each searcher a route, keeps everyone talking on one shared map, and updates as places come up empty or someone reports a sighting.

## Team
| Who | Part | AI use |
|---|---|---|
| **BenStew** (repo owner) | **Screen + hosting**: UI, map, data fetching, sync, messaging, report box, PWA, picking the free hosting and LLM provider, security | AI helps build |
| **Jev** | **Engine**: prior, detection, allocation (routes), updates | **Written by hand.** AI may explain and review only |
| **Nathan** | **Optimization**: tests, debugging, speed and reliability | AI may help write tests; Nathan reviews them and can explain them |

The rules say AI may not build the whole project and each person explains their own code on video.

## Decisions
- **Name:** FindThem.
- **Model:** walkers feed the grid. Walker endpoints become the starting probability map on a 25 m grid; the grid does detection, updates and allocation.
- **Live data:** Firebase Realtime Database through its REST API (`fetch` + `EventSource`), no SDK. Supabase is the fallback if Firebase doesn't work out.
- **Report box, not a "chatbot":** the word "chatbot" never appears in the UI, because people who are panicking don't want one.
  - The searcher types or speaks a report ("saw him by the creek on Paseo Padre ten minutes ago").
  - An LLM (DeepSeek) turns it into structured data.
  - The person confirms it, and only then does it go to the engine as an event.
  - The LLM never sets probabilities. The manual sighting form is always there as a fallback, and is the only option when offline.
- **LLM key safety:** the DeepSeek key must never be in the website's code. A tiny free serverless proxy holds it (BenStew's hosting research). Cloudflare Workers is the leading option, since Firebase Cloud Functions needs a paid plan.
- **Hosting:** BenStew researches free providers and security. GitHub Pages is the default for the static site; the repo must go public before deploying there.
- **Demo and tuning area: Fremont, CA**, around Central Park / Lake Elizabeth (about 37.553, −121.970). The team knows the area. Within 1 mile there are 3,408 walkable ways and 85 trap features (Laguna Creek, Mission Creek, Irvington Creek, drainage channels, parks). The app still works anywhere.
- **AI disclosure:** the README and Devpost text name the AI tools and say who wrote what by hand.
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

## The engine (Jev, by hand)
- **Prior: the hard part.** A "smart map" built from several reliable public sources:
  - Koester's lost-person statistics for dementia (distance from the last-seen point, distance from roads, where people were found)
  - OSM streets, paths and trap features
  - familiar places
  - walking time
  - Jev picks and documents each source. Walkers carry it onto the real street graph.
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
| `report.js` | BenStew | voice (Web Speech API) or text → LLM proxy → structured draft for the person to confirm |
| `proxy/` | BenStew | tiny serverless function that holds the DeepSeek key and returns JSON only |
| `i18n.js` | BenStew | all UI text in 5 languages, emergency numbers, units |
| `sw.js`, `manifest.json`, `icons/`, `lib/` | BenStew | PWA, Leaflet 1.9.4 + Leaflet.heat 0.2.0 |
| `engine/graph.js`, `engine/sim.js`, `engine/grid.js`, `engine/routes.js` | Jev | graph, walkers, grid math, routes |
| `tests/*.test.js`, `bench/` | Nathan | `node --test`, speed checks, later the benchmark |
| `INTERFACES.md` | all | exact function signatures and data shapes; change only by agreement |
| `engine/fake.js` | BenStew | dev-only fake engine with the same interface; deleted at integration |
| `ShortPlan.md`, `PLAN.md`, `CLAUDE.md`, `README.md`, `ROADMAP.md`, `CommitHistory.md` | all | docs |

**Sync design.**
- Every phone recomputes the map from the same inputs, seed and event list (the engine is deterministic).
- Firebase stores only small events under `searches/<random 128-bit id>`: `case`, and `events` (`searched`, `sighting`, `assigned`, `message`). The engine ignores `assigned` and `message`.
- Access is by exact search id only, with no accounts in this version.
- While offline, writes queue in `localStorage` and flush on reconnect.

## Not built now
Chatbot persona, camera integration, trackers, GPS-trail coverage, drill mode, accounts, photos, and everything in `ROADMAP.md`.

## Schedule
1. **Setup:**
   - docs and `INTERFACES.md` (all three agree)
   - skeleton files, `/lib`, `package.json`
   - Firebase project, demo fixture for Fremont
   - BenStew starts the hosting/proxy research
2. **Screen A:** map + inputs + i18n + `data.js` + fake engine results. *Pause for a check.*
3. **Screen B:** heatmap, colored streets, rings, top spots, sectors and routes UI, 911 script + house checklist, sighting form.
4. **Screen C:** Firebase sync (two phones share one map), share and join links, message feed, hand-off sheet.
5. **Screen D:** report box (voice/text → proxy → confirm → event), with the manual form as fallback.
6. **Integration with Jev's engine** (target: evening of Nov 21): swap `fake.js` for the real engine; Nathan's tests pass. *Pause for a check.*
7. **Screen E:** offline PWA, Save my home area, GPS dot, Demo button. Nathan does a speed and reliability pass.
8. **Benchmark** (required, after the core works; Nathan + Jev): uncoordinated volunteers vs. ring sweep vs. FindThem allocation, with a results table in the README.
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
- **Reports sent to the LLM leave the phone.** DeepSeek is a third-party service, so the report box warns before sending and doesn't send names or medical details on purpose.
