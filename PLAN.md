# FindThem: build plan

This merges two documents: the original build prompt (a plain-JS PWA that runs 5,000 simulated walkers on the OpenStreetMap street graph and shows a heatmap, "Check these first", offline mode and share links) and the EvoHacks II game plan ("FirstHour": Bayesian search theory, sectors for volunteers, a shared live record of what's been searched, sightings, a police hand-off, and evidence from tests and a benchmark).

EvoHacks II's theme is **social good**. **Deadline: Sun Nov 22, 2026, 12:00 pm.** That leaves about a day and a half, so scope follows what the game plan says wins: a non-LLM core, a shared coverage record, clue updates, evidence and a one-tap demo.

## The user and the moment
A family member or neighbor in the first hour after a person with dementia goes missing, before professionals arrive. The app tells them where to look first, splits the area between volunteers, and updates as areas come up empty or someone reports a sighting.

## Decisions (2026-11-21)
- **Name:** FindThem.
- **Team:**
  - The **screen builder** (repo owner) makes the map, inputs, data fetching, sync, UI and PWA, with AI help.
  - The **engine builder** (teammate) writes the walkers, grid, Bayes updates, allocation and tests **by hand**, using AI only as a tutor.
  - The rules say AI may not build the whole project and each person explains their own code on video.
- **Model:** walkers feed the grid. Walker endpoints become the starting probability map on a 25 m grid; the grid does detection, updates and allocation.
- **Live sync:** Firebase Realtime Database through its REST API (`fetch` to write, `EventSource` to stream). No SDK.
- **AI disclosure:** the README and Devpost text name the AI tools and say what each person wrote by hand. `CLAUDE.md` is committed.
- **Must-haves beyond the core:** all 5 languages (en/es/fr/zh/ja), offline PWA, police hand-off sheet.
- **Benchmark vs. uncoordinated volunteers: required, built after the core works.**
- **Kept from the original prompt:**
  - units from the phone's region, with a mi/km toggle
  - local emergency number as a tap-to-call banner that can't be dismissed
  - demo location near Shoal Creek, Austin TX (checked against Overpass)
  - one commit per stage, each with a `CommitHistory.md` entry
  - GitHub Pages hosting (the repo must be made public before deploying)

## What it does
0. **Call 911 first.** A script to read to the dispatcher.
1. **House and yard, 2 minutes.** A checklist: closets, under beds, garage, parked cars, shed, neighbors' yards. In Koester's data, 18% were found in a house.
2. **When and which way.** Last-seen pin, minutes since last seen, heading (a doorbell camera often shows it), mobility (normal / slow / walker or cane), up to 3 familiar places.
3. **The map.**
   - heatmap
   - streets colored by walker use
   - dashed rings at 0.5/1/1.5 mi
   - the top 3 places to check first, shown large (8 when expanded), each with a reason such as "Creek 130 ft off Main St – 12% of walkers"
4. **Volunteers.**
   - The area is split into sectors of about 200 m. Each volunteer gets one sector by link.
   - The next-best sector comes from greedy allocation: the most probability gained per searcher-minute.
   - Hazards like water are flagged for professionals, not untrained volunteers.
5. **Updates.**
   - Marking a sector searched (with minutes spent) syncs to every phone and lowers that sector with a Bayes update.
   - A sighting ("heading east at 3:40", with a reliability) folds into the map.
6. **Hand-off sheet.** One tap gives police a sheet with the timeline, sectors searched and how well, what's left, and the top spots.
7. **Before an emergency:** "Save my home area" (address search, map tap or GPS) stores the map data for offline use. Familiar places and past found spots are saved on the phone.

"This is a guide to help focus the search, not a guarantee" shows under the results.

## The engine (hand-written)
- **Graph.** OSM nodes and way segments with length and bearing.
  - walkable ways: footway, path, pedestrian, residential, living_street, service, tertiary, secondary, primary, unclassified, track, steps, cycleway (no motorway or trunk)
  - trap features: waterway, wood, scrub, wetland, water, forest, meadow, grass, park
- **Walkers.**
  - 5,000 per run, from a seeded random number generator, so the same inputs always give the same map.
  - Each one starts at the nearest node. The first edge is weighted by the heading, if one was given.
  - Budget = min(speed × minutes × 60 × 0.6, a lognormal give-up distance with median ~850 m). Speeds: 1.0 / 0.7 / 0.45 m/s.
  - At each intersection the turn weight is exp(−turn / 30°). No U-turns. Stop at dead ends.
  - Edges heading toward the nearest familiar place get × 1.5.
  - At the end, a walker within 30 m of a trap feature moves into it with probability 0.6.
- **Grid prior.** Walker endpoints smoothed onto 25 m cells, plus a small floor so no cell is zero.
- **Detection.** POD = 1 − e^(−coverage), Koopman's formula. Coverage comes from searcher-minutes, sweep width and sector area.
- **Update after an empty search.** p_cell × (1 − POD), then renormalize.
- **Sighting.** Rerun the walkers from the sighting point, heading and time, then blend: (1 − r) · current + r · sighting map.
- **Allocation.** Greedy by probability gained per minute. Verified against brute force on tiny grids.
- All tunable numbers are named constants at the top of each file. Statistics to double-check against Koester: median found distance 0.8 km (the original prompt said 0.88), 89% within 1 mile, median 30 m from a road.

## Files
| File | Owner | Job |
|---|---|---|
| `index.html`, `style.css` | screen | layout, mobile-first styles |
| `app.js` | screen | map, inputs, layers, panels, steps 0–6 |
| `data.js` | screen | Overpass fetch + IndexedDB cache + Nominatim; returns raw OSM ways, nodes and features |
| `sync.js` | screen | Firebase REST + EventSource; offline write queue |
| `i18n.js` | screen | all UI text in 5 languages, emergency numbers, units |
| `sw.js`, `manifest.json`, `icons/`, `lib/` | screen | PWA, Leaflet 1.9.4 + Leaflet.heat 0.2.0 |
| `engine/graph.js`, `engine/sim.js`, `engine/grid.js` | engine | graph, walkers, grid math |
| `tests/*.test.js` | engine | `node --test`, no dependencies |
| `INTERFACES.md` | both | exact function signatures and data shapes; written first, agreed by both |
| `engine/fake.js` | screen | dev-only fake engine with the same interface; deleted at integration |
| `PLAN.md`, `CLAUDE.md`, `README.md`, `ROADMAP.md`, `CommitHistory.md` | both | docs |

**Sync design.**
- Every phone recomputes the map from the same inputs, seed and event list (the engine is deterministic).
- Firebase stores only small events under `searches/<random 128-bit id>`: `case`, `assignments`, `searched[]` (sector, minutes, searcher, time) and `sightings[]`.
- Access is by exact search id only. No accounts in this version; that's stated as a limit.
- While offline, writes queue in `localStorage` and flush on reconnect.

## Not built now
Chatbot, camera integration, trackers, GPS-trail coverage, drill mode, accounts, messaging, photos, and everything in `ROADMAP.md`.

## Schedule
1. **Setup (~1 h, push first so the engine builder can start):**
   - this plan and `CLAUDE.md`
   - `INTERFACES.md`
   - skeleton files and `/lib`
   - Firebase project (the repo owner creates the account)
   - a demo-area check
2. **Screen A:** map + inputs + i18n + `data.js` + fake engine results. *Pause for a check.*
3. **Screen B:** heatmap, colored streets, rings, top spots, sector UI, 911 script + house checklist, sighting form.
4. **Screen C:** Firebase sync (two phones share one map), volunteer sector links, hand-off sheet.
5. **Integration with the engine** (target: evening of Nov 21): swap `fake.js` for the real engine and run `node --test`. *Pause for a check.*
6. **Screen D:** offline PWA, Save my home area, GPS dot, share link, Demo button.
7. **Benchmark** (required, after the core works):
   - simulated wanderers
   - three strategies: uncoordinated volunteers, coordinated ring sweep, FindThem allocation
   - a results table in the README, whatever it shows
8. **Freeze at 9:30 am Nov 22.**
   - deploy: make the repo public, turn on Pages
   - 3-minute video
   - Devpost text
   - submit by 11:00

**If time runs short, cut from the end of this list:** engine + tests → shared coverage → clues → demo link → benchmark → offline → hand-off → languages beyond en/es.

## Verification
- `node --test`:
  - the same seed gives the same output
  - probabilities sum to 1 after every update
  - greedy allocation matches brute force on a tiny grid
- Phone-size browser (375×812).
- Two tabs on one search id: marking a sector in one updates the other within ~1 s.
- Offline: stop the server, reload, and check the cached map and prediction still work and queued writes flush later.
- The Demo button runs end to end in under 5 s on the preloaded area.

## Limits to state
- The source data is small, old and mostly rural (87 Virginia cases).
- Nothing has been validated on real searches.
- Untrained volunteers should not enter water or dense brush.
- Browser GPS only works while the page is open.
- Anyone with a search link can see and edit that search.
