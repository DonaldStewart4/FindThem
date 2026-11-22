# Search planner: design note

Branch `planner` (worktree `findthem-planner`). Owner: Nathan. Written Nov 22 before any planner code, and **revised the same day once the code and tests existed** (changes are marked "As built"). It replaces `nextSectors` and `routeFor`. All new code goes in `engine/planner/`, with its own tests and benchmark. `app.js`, `grid.js`, `sim.js` and `surface.js` are not edited on this branch.

## What is wrong with `nextSectors` and `routeFor`

Read from the code at `c04d311`:

- **Everyone gets the same list.** `nextSectors` ranks 200 m squares by probability × one fixed POD. It does not know where a searcher stands or who is already searching where. The engine ignores `assigned` events. Ten phones show the same top squares, so volunteers pile up.
- **Squares are not places.** A 200 m square cuts through houses, parks and creeks. `routeFor` walks the streets whose middle falls inside it, starting at the street the most walkers used, not where the volunteer is.
- **Detection ignores what can be seen.** One sweep width (20 m) for every kind of ground, day or night. POD comes from minutes spent in the square, not from the route walked.
- **Hazards are only flagged.** A square of water shows "for professionals"; nobody is sent to look at the creek from the path.
- **No measure of progress.** Nothing reports the chance the search so far would have found the person, or when to widen the search.

Measured on the Fremont fixture (Demo start, 60 minutes, map split onto 10 m squares):

| Where the probability sits | Share |
|---|---|
| Visible from a street or path (road, sidewalk, front 15 m) | 50.5% |
| Inside a building | 26.0% |
| Back and side yards | 18.2% |
| Open ground (parks, lots) | 3.0% |
| Water, creek, brush | 1.5% |

So a plan that only credits walking the street can reach about half the probability. The rest needs doors knocked and yards checked, and that needs permission.

## The design in one sentence

**Cut the map into real search segments, build a walkable route for each from where each searcher stands, score it by the chance of finding the person that the route adds beyond what teammates already cover, and give each searcher their best three, with danger reported as a separate number.**

## 1. Inputs and the adapter

The planner core never imports the engine. `engine/planner/adapter.js` is the only file that does; merging means editing that file.

Static, built once per case (typed arrays, so it can be posted to a Web Worker):

- ground class per 10 m square, distance to the nearest road, and a rail / motorway mask (from `OsmData.layers.lines`)
- the street graph as flat arrays, in meters from the case's grid origin
- bus stops, the last-seen point

Each re-plan:

- `p`: probability per 10 m square, summing to `1 − restOfWorld`
- `hazard`: the engine's hazard layer
- `searchers`: `{ id, lat, lng, mode: 'foot' | 'car', updatedAgoMin }`
- `events`: assignment events (below)
- `clock`: `{ nowMs, minutesSinceLastSeen }`

What the adapter covers until the prior session lands:

- Today `grid.p` is on 25 m squares. The adapter splits each square's value **evenly** over its 10 m squares (ASSUMPTION; the sum is unchanged). When the engine gives a 10 m map, the adapter passes it through.
- Today there is no `grid.hazard` on this branch. The adapter then works out the same statistic itself: for each water, creek or wetland square, the probability within 100 m.

## 2. Tasks, not squares

Segments are cut once per case from the ground map and cached. Ids come from the lowest square index in the segment, so every phone names them the same.

| Type | What it is | How it is cut |
|---|---|---|
| `hasty` | Roads and paths leading away from the last-seen point, walked briskly | 8 compass wedges around the last-seen point, out to `HASTY_RADIUS_M` |
| `yards` | Yards and structures of one block. The **ask-permission** type | Built-up ground enclosed by streets, water or rail (flood fill) |
| `park` | A park or open space, swept in lines | Joined-up park, grass, woods and brush squares |
| `hazard_check` | A stretch of creek, pond edge or wetland: "check from the path or bank, don't enter" | Joined-up hazard squares near the likely area, cut along their length |
| `containment` | Stand and watch a bridge, transit stop or key intersection | Points on the main ways out |
| `drive` | A loop for a searcher in a car | 4 quadrants, drivable roads only |

Sizing:

- Target 30–45 minutes (Nathan's requirement; `TASK_MAX_MIN = 45`). A segment that would take longer is cut in two along its longer side, again and again.
- Measured: 503 built-up blocks of at least 2,000 m²; median 1.9 ha, three quarters under 3.8 ha, the largest 156 ha. The 489 with buildings have a median of 26 buildings and about 870 m of street frontage. Walking that at 0.8 m/s plus one minute a door comes to 24 / 45 / 74 minutes at the quartiles, so **about half the blocks get cut** to fit 45 minutes.
- Segments under `TASK_MIN_MIN = 3` minutes are not tasks. Their squares still count: any route passing within range covers them (section 3).
- 38 segments hold 71% of the probability in the measured case, one block alone 27%. Only the likeliest segments, and those near each searcher, get routes on a re-plan.

## 3. Detection: what a searcher can actually see

Every square has a visibility class. Detection is worked out per square from the track walked.

- One pass at distance `d` from a square spots a person there with probability `0.9 · e^(−1.8 d / W)`. `W` is the sweep width of that square's class; the area under this curve is exactly `W`, which is the definition of sweep width (Koopman), and a test integrates it to check. The 0.9 (`P0`, ASSUMPTION) means even a person right on the track is missed 1 time in 10.
- A track's coverage of a square uses its closest approach, counted once. Walking a street there and back is not two looks.
- Looks by different searchers, or on different tasks, are independent: misses multiply.
- A park sweep uses Koopman's random-search formula over the segment, POD = `1 − e^(−coverage)`, the formula the engine already uses.
- The same function scores a planned route and a GPS trail. An `assigned` event carries the route's track; a `completed` event may carry the trail actually walked, which then replaces it.

| Visibility class | Squares | `W` by day | `W` at night | Label |
|---|---|---|---|---|
| From the street | roads, paths, and open ground within 15 m of one | 30 m | 12 m | ASSUMPTION |
| Open ground | parks, grass, lots beyond 15 m | 40 m | 12 m | ASSUMPTION |
| Private yard | yard squares beyond 15 m of a street | 4 m | 2 m | ASSUMPTION |
| Inside a building | building squares | 0 | 0 | by definition: walls |
| Water or brush | water, creek, wetland, woods, brush | 16 m | 6 m | 16 m is DATA (low end); night ASSUMPTION |

- The only measured sweep widths we have are 16–142 m for an adult-sized target in forest and wildland (Koester, Cooper, Frost & Robe 2004, DTIC ADA511593, checked Nov 22). No urban figure was found. The values above sit at the low end because houses, fences and cars block more than trees. The benchmark runs the search with "true" widths drawn ±50% around these.
- Pace changes `W`: hasty walking ×0.7, driving ×0.5 (ASSUMPTION).
- **Canvass.** A `yards` task knocks at each building. That gives the building's squares and the yards behind it a POD of their own: `POD_CANVASS_BUILDING = 0.4`, `POD_CANVASS_YARD = 0.5` (ASSUMPTION: about half of residents answer, and most who answer would check and find). Without the ask-permission task these squares get only what the street view gives.
- **As built: a block's doors count once.** A second person knocking on the same doors gets the same answers, so those looks are not independent. Within `CANVASS_REPEAT_MIN = 120` minutes (ASSUMPTION) only the first canvass of a block is credited; anyone else sent there is offered a walk past (no doors, no permission needed, shorter) and credited only for what they see from the street. This was found when the first working planner sent three searchers to canvass the same block.
- **Night** comes from the case clock and the sun's height at the last-seen point (standard solar-position formula; night = sun more than 6° below the horizon).

## 4. Routes

Routes are sequences of street-graph edges, plus the pattern to follow. They are rebuilt and re-scored on the current map every re-plan.

- **Orienteering, for `hasty` and `drive`.** Within the time budget, the route collecting the most probability. Each street piece's prize is the probability its look would find now. As built:
  1. start at the piece with the best prize per meter, counting the real travel to it;
  2. choose more pieces, each the best prize per meter of straight-line distance (× 1.3 for streets) from the last, until the budget is used;
  3. 2-opt: reverse stretches of that order while it shortens the straight-line path;
  4. walk it on the real streets by shortest paths; pieces passed on the way count too;
  5. if time is left, choose again from where the walk ended.

  The final score is recomputed from the squares the whole route actually passes, so overlapping prizes are not counted twice. A hasty walker may use any public street within 1.7 km of the last-seen point, but is credited only along the roads and paths of their wedge.
  - Measured on 64 real Fremont wedge routes against a slow reference (true street distance at every step, best of 5 starts): the fast method collects a **median 97%, mean 97%, worst 77%** of the reference's prize.
  - Measured against brute force on a 4 × 4 street grid (its worst case: every walk goes round corners): mean 76%, worst 48% of the best possible. An earlier version that ran a shortest-path search at every step was closer on the grid but took 100+ ms per re-plan.
- **Full street coverage, for `yards` and `hazard_check`.** The shortest closed walk that covers every public street piece of the block (rural postman): join the pieces, pair up the odd corners by shortest path (exact for up to 10 odd corners, greedy with improvement above), walk the Euler circuit. The tour is cached per segment and rotated to start at the corner nearest the searcher.
- **`park`.** Travel to the nearest entry, then sweep the segment in lines `W` apart. The route data is the entry point, the outline and the line spacing.
- **`containment`.** Travel to the point and stay.
- **Travel** uses shortest paths on the same graph from where the searcher stands (measured: 0.9 ms for a 2 km reach), at walking or driving speed. Travel minutes are always part of an option's time.

## 5. Assignment: no pile-ups

Events (added to the shared search like any other; the engine ignores types it doesn't use):

```js
{ id, type: 'assigned',  searcherId, taskId, at, expiresAt, track, searchMin, canvass?, partnerId? }
{ id, type: 'released',  searcherId, taskId, at, track? }          // gave it up; partial trail optional
{ id, type: 'completed', searcherId, taskId, at, track?, partnerId? } // done; GPS trail optional
```

- A searcher's task is their latest `assigned` that is not released, completed or past `expiresAt`. Events are ordered by `at`, then `id`, as the engine does.
- **Work in progress counts.** Every active assignment's route lowers the map the others are scored on, square by square, by `CLAIM_CREDIT = 0.8` × its detection (ASSUMPTION: not everyone follows the route). The credit fades when the searcher's last update is older than 10 minutes.
- Because the accounting is per square, a second searcher on the same ground only gains what the first would miss. Shrinking returns are not a special rule; they are the arithmetic.
- **What is maximized (as built).** Each searcher's *marginal* gain per minute, travel included: what their route would find that everyone else's routes would not. This is search theory's rule for dividing effort: put each bit of effort where the return on it is highest (Koopman; Stone, *Theory of Optimal Search*, 1975). When every task takes the same time it is exactly "maximize the joint chance of finding the person".
  - The first design used a "team score" that split each square's detection among searchers in proportion. It was dropped: when a second searcher joined a task it took share away from the first, so the score fell even when the team's real chance rose, and plans came out unstable under their own re-plan.
- **Solving it.** Greedy: fix the best (searcher, task) pair by marginal gain per minute, lower the map, repeat. Then each searcher in turn moves to their own best option given where everyone else now is, until nobody moves (at most 3 rounds). Ties break by id, so the same events give the same plan.
  - Brute force on the tiny test town (every assignment listed, scored by a separate evaluator): the planner found the best assignment in **80 of 80** equal-time cases with 2 and 3 searchers. With unequal times and 2–4 searchers, **0 of 675** single-searcher moves would have done better.
- **Doubling up** on a task someone else holds must beat the searcher's best other option by `DOUBLE_UP_FACTOR = 1.25` (ASSUMPTION). A second searcher on a block only walks past it (section 3). A containment point takes one watcher, never two.
- **The POS gain shown for an assigned route** counts what teammates who *finish earlier* would not already have found (work in progress first, then routes by their minutes). Added up over the team these gains are exactly the chance that someone finds the person; the tests check that sum against the Bayes update after everything is completed. Alternatives are shown with the cautious figure: what they would add if every teammate finished first.
- Searchers who hold a task are offered block, park and containment alternatives; hasty routes (the costly ones to build) are built for free searchers only.
- **Pairs.** `hazard_check` needs two searchers who walk together and count as one look. A lone searcher is never assigned one; the task is listed as needing a partner.
- **Hysteresis.** A searcher keeps their task unless another option's gain per minute beats the remaining gain per minute of the current one by `SWITCH_FACTOR = 1.5` (ASSUMPTION).

Each searcher gets up to three options. Each is data only; the screen turns codes into text in the five languages.

```js
Option = {
  taskId, type,
  posGain,                 // chance this route finds them, beyond what teammates' routes cover
  posGainAlone,            // the same with no teammates
  travelMin, searchMin, ratePerMin,     // ratePerMin = posGain / (travelMin + searchMin): the ranking
  danger: { level: 0..3, warnings: [ 'high_traffic_crossing', 'rail_crossing', 'water_nearby', 'night', ... ] },
  reasons: [ { code: 'share_of_map', value: 0.27 }, { code: 'hazard_first' }, ... ],
  route: { points, lengthM, track, pattern: 'walk' | 'sweep' | 'post' | 'drive', outline },
  permission: 'none' | 'ask', needsPair, partnerId, urgent, keep
}
```

**Probability and danger are never combined.** Ranking uses `ratePerMin` only. `danger` is reported beside it and is used only by the safety rules.

## 6. Hazard-first rule (ASSUMPTION)

Water and drainage near the likely area become `hazard_check` tasks, and they are scheduled early by an explicit rule, not by changing their score:

- At a re-plan, hazard stretches whose score on the engine's hazard layer is at least 0.005 (the engine's own threshold for "near the likely area") are taken in order of that score. If the bank check itself has `posGain ≥ HAZARD_MIN_POS = 0.005`, nobody holds it, it was not checked in the last 2 hours, and two searchers on foot are free, it is assigned to the two nearest **before** the ranked allocation.
- At most one pair per four searchers is used this way at once (and at least one pair when the team has two or more). The first working version had no gain test and sent a second pair to a stretch worth 0.15%; the gain test stops that.
- Other hazard stretches still compete on their numbers: a pair is sent when its two shares beat what the two would get apart.
- A stretch with no public street or path beside it cannot be checked by volunteers. It is listed in `unfilled` with `no_public_view`; one that lacks a partner is listed with `needs_partner`. Either raises the `hazard_unchecked` signal.
- The option carries `urgent: true` and the reason `hazard_first`. Its `posGain` and `ratePerMin` stay what they are.

Why: a person in a channel or at the water's edge cannot be seen from the street and may not be able to get out. Rowe et al. 2011: deaths "most commonly occurred in unpopulated areas due to exposure and drowning". ISRID urban finds: water 6%, drainage 4%. This is our judgment about urgency, not a published rule, so **the benchmark runs the planner with and without it** and reports both: time to find overall, and time to find for people who are in water or a drainage.

## 7. Safety rules (enforced, each with a test)

- Routes use street-graph edges only. Off-street movement exists only inside a `park` segment, whose squares are park, grass, woods, brush or path.
- **Water:** no route square is water, creek or wetland unless it is a mapped street crossing it (a bridge). `hazard_check` routes stay on paths and streets beside the water.
- **Rail and freeways:** the graph has no motorway or trunk edges (the download excludes them). No off-street square is rail or motorway. A street that crosses a rail line is the only way over; it carries the `rail_crossing` warning, because the data cannot tell a bridge from a level crossing.
- **Private property:** driveways (`service` ways with houses or yards on both sides) are never walked. Yard and building squares are only credited through the `yards` task, which says `permission: 'ask'`.
- **High-traffic crossings:** crossing or walking along a primary or secondary road is flagged and raises the danger level.
- **Pairs** for every `hazard_check`.
- **Cars** use drivable road types only, and get `drive` and `containment` tasks only.

Danger level (as built): 0 none; 1 night, a secondary-road crossing, walking along a main road, or 100 m or more of the route within 30 m of water; 2 a primary-road crossing or a rail crossing; 3 a `hazard_check` task. The first version flagged any route that came within 30 m of water at level 2, which in Fremont was nearly every route; a warning on everything warns of nothing.

A street piece belongs to a block when at least two of its squares touch the block's side (a street that only meets the block at a corner belongs to the next block).

## 8. Measures

- **Cumulative POS:** the chance that the completed searches would have found the person: 1 − (probability left ÷ probability at the start), from the planner's own coverage record.
- **Remaining probability:** on the map, and per task.
- **Rest of world:** when searches come back empty, Bayes raises "not on this map". The planner reports its value after each completed task and its slope over the last hour.
- **Expand signal:** `expand: { signal, reasons }` when rest of world passes `ROW_EXPAND = 0.5`, or the best option anywhere finds less than `MIN_USEFUL_RATE` per minute (ASSUMPTION). The reasons are codes: `rest_of_world_high`, `map_exhausted`, `hazard_unchecked`.
- Until `grid.js` reads `completed` events, the planner applies them itself: `p × (1 − detection)`, renormalized with rest of world. A search ages if the person may still be walking: its effect fades by the chance they are mobile (ISRID mobility, n = 42: 50% have stopped within 15 minutes, 75% within 3.8 h) with a time constant of 30 minutes (ASSUMPTION).

## 9. Phone budget

- Re-plan with 10 searchers: under 300 ms on a phone. Target on the laptop in Node: under 60 ms, leaving a factor of 5.
- **Measured on the laptop** (Node 22, Fremont fixture, median of 9 runs, while another session was using the machine): all 10 searchers free **31 ms**; all 10 holding a task **16 ms**; 1 free and 9 holding (the usual re-plan) **22 ms**. No phone has run it yet; that is on Nathan's test list.
- One-off costs: building the world and segments about 0.4–0.6 s; the first plan of a case about 0.3–0.5 s (tours and footprints are built once and kept).
- Where the time went, and what was done: a shortest-path search at every step of the hasty router (replaced), a team score recomputed from scratch for every trial move (replaced by marginal gains), and 13 MB of whole-map arrays allocated per re-plan (now reused).
- `engine/planner/worker.js` wraps the planner for a Web Worker: one message with the static world, one per re-plan. No DOM, no `Date.now()`, no `Math.random()`.

## 10. Tests (`tests/planner.test.js`)

All built; 27 tests, results in the test output's diagnostic lines.

- **Brute force on tiny hand-made worlds:** every possible assignment is listed, and each is scored by a separate evaluator written in the test (it adds up, square by square, the chance at least one searcher detects, by listing detection outcomes). The planner's choice is compared with the best. On random tiny worlds the worst ratio seen is reported, not assumed.
- **No pile-up:** N searchers, at least N worthwhile tasks, random maps: N different tasks unless the doubling rule's threshold is met; a second searcher's gain on a held task is strictly lower.
- **Never blocked:** over many plans on the fixture, no route square is water, rail, motorway, a private driveway or a yard; every edge joins the next; cars only on drivable roads; lone searchers never get a hazard task.
- **Stability:** a small change in the map or a searcher moving 20 m does not change held tasks; a clearly better task does.
- **Determinism:** same inputs, same plan; event order does not matter.
- **Sums:** posterior + rest of world = 1 after every completed task; cumulative POS never goes down; an option's `posGain` equals the drop in remaining probability when its track is applied.
- **Routes:** the postman tour covers every required edge; the orienteering route respects its time budget and is never beaten by brute force on a tiny graph by more than the reported margin.
- **Speed:** re-plan time with 10 searchers on the fixture.

## 11. Benchmark (`bench/planner-eval.js` → `bench/planner-report.md`)

- Calls the real planner on the engine's real map.
- **True locations come from ISRID, not from our walkers:** urban distance curve (0.3 / 1.1 / 3.2 / 12.6 km), find-location shares by ground class, limited by how far the person could have walked. People beyond the map are never found, and count.
- **The person can be moving:** by the ISRID mobility figures some are still walking, along streets toward where they will end up, at a speed drawn from Toots et al.
- **Imperfect searchers:** real travel time on the street graph, a share who do not follow their route, varied pace, and true sweep widths that differ from the planner's.
- **Baselines:** volunteers on their own who remember where they have been; a ring sweep that starts over when it reaches the edge; greedy on the plain statistics map; the old `nextSectors` + `routeFor`.
- **Variants:** hazard-first on and off; containment on and off.
- **Reported:** found-by-time curves, expected time to find (capped at the run length), and 95% intervals from resampling **setups**, then cases inside them, so the interval reflects how few start points there are. Differences against each baseline are paired on the same people.

## 12. Constants

| Constant | Value | Label and source |
|---|---|---|
| POD = 1 − e^(−coverage) | | DATA: Koopman; Koester et al. 2004 (checked) |
| Sweep widths (section 3) | | ASSUMPTION, anchored to Koester et al. 2004's 16–142 m |
| `P0` (chance of spotting someone right on the track) | 0.9 | ASSUMPTION |
| `CANVASS_REPEAT_MIN` | 120 | ASSUMPTION |
| `HAZARD_RECHECK_MIN` | 120 | ASSUMPTION |
| `WATER_NEAR_MIN_M` | 100 | ASSUMPTION |
| `SEARCH_SPEED_MPS` | 0.8 | ASSUMPTION (the engine's value) |
| `HASTY_SPEED_MPS` | 1.2 | ASSUMPTION |
| `TRAVEL_SPEED_MPS` | 1.3 | ASSUMPTION until Bohannon 1997 is re-read |
| `DRIVE_SEARCH_MPS` / `DRIVE_TRAVEL_MPS` | 6.7 / 8.9 | ASSUMPTION (15 and 20 mph) |
| `KNOCK_MIN` per building | 1.0 | ASSUMPTION |
| `TASK_MAX_MIN` / `TASK_MIN_MIN` | 45 / 3 | Nathan's requirement / ASSUMPTION |
| `HASTY_RADIUS_M` | 1,500 | ASSUMPTION (ISRID urban median is 1.1 km) |
| `FRONT_DEPTH_M` | 15 | ASSUMPTION (ISRID track offset median is 15 m) |
| `CLAIM_CREDIT`, `DOUBLE_UP_FACTOR`, `SWITCH_FACTOR` | 0.8, 1.25, 1.5 | ASSUMPTION |
| `HAZARD_MIN_POS` | 0.005 | ASSUMPTION (same value as the engine's `HAZARD_MIN_CHANCE`) |
| Containment: `PASS_SHARE`, `CATCH_M`, `POD_POST` | 0.25, 300, 0.9 | ASSUMPTION |
| Mobility over time | 0 / 0.25 / 3.8 / 18 h | DATA: ISRID temperate, n = 42 (checked) |
| `ROW_EXPAND`, `MIN_USEFUL_RATE` | 0.5, 0.0002 /min | ASSUMPTION |

**Not checked.** A background check of the remaining sources (night sweep widths, urban or vehicle detection, canvass effectiveness, walking speed, the standard definitions of hasty search and containment) was started and was cut off by a usage limit before it returned anything. Nothing in this table was upgraded from ASSUMPTION because of it. All tunable numbers live in `engine/planner/params.js` with these labels.

## 13. What merging will need

The exact plan comes with the last stage. In outline:

- `engine/index.js`: export `planSearch` and the adapter's helpers; keep `nextSectors` and `routeFor` until the screen has switched.
- Screen: send `assigned` / `released` / `completed` events, pass searcher positions and mode to the planner, draw options from codes, add the codes' text to `i18n.js` in five languages. Every screen change is logged in `UPDATESBYNATE.md`.
- `grid.js` (prior session): read `completed` events so the shared map reflects planner coverage; then one flag in the adapter turns off the planner's own update.
- `INTERFACES.md`: the new events and the `Plan` shape. Needs Ben's OK.

## Known limits

- Containment's value rests on three assumptions; the benchmark's on/off runs say whether it earns its place.
- OSM has no `access=private` in our download, so "private" is inferred from land use.
- Indoor search of public buildings is not modeled.
- Segments depend on the map download; two phones with different OSM snapshots could cut a block differently. Tracks in events are in case squares, so coverage still matches.

## Stages

1. This note.
2. The planner and its tests.
3. The benchmark and report, then the merge plan.
