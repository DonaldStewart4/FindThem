# Prior v2: design note

Branch `prior-v2`. Owner: Nathan (engine, tests, bench). Written Nov 22 before any engine code changed.

## What is wrong with the current prior

From the audit of `main`:

- Every walker has the same speed and the calibration only holds with unlimited time (median 799 m at 600 min, 481 m for the Demo).
- Walkers can only stand on street lines. Nothing models leaving the road, buildings, fences, or how far off the road people are found.
- The 2% floor is spread evenly over the map; nothing says "they may be off this map".
- The grid is anchored to each phone's own download, so two phones can mean different ground by the same sector id.
- Familiar places barely pull; sightings never age and are discounted by searches made before them.

## What the new prior is

One sentence: **particles on a 10 m ground map, blended with an ISRID statistics map, for a stated time since last seen, with an explicit share for "not on this map".**

### 1. Ground map (`engine/surface.js`)
- A 640 × 640 raster of 10 m cells, ±3.2 km around the **case's grid origin** (not the phone's download).
- Classes: road, path, service way, building (blocked), fence/wall/hedge/rail/motorway (blocked), water, creek/ditch, wetland, woods, brush, grass, park, yard, open lot, plain developed ground, no data.
- Built from OSM only. Roads and paths are burned last, so a road over a creek or through a fence line stays open (bridges, gates).
- Extra layers per cell: how exposed to the public a road is (by road type, plus bus stops), distance to the nearest road or path, "next to a building", distance to water.
- New OSM layers come from an extended Overpass query (`OsmData.layers`). An area saved before this change has none: the raster is then streets + water + parks on plain ground, and everything still runs.
- **Elevation is skipped.** The urban ISRID row has no elevation statistic, the Fremont test area is flat, and terrain tiles would add a second download to the first minutes of a search. The temperate numbers (19% up / 42% down / 39% same) are recorded in the calibration table as "not modeled".

### 2. Walkers as particles (`engine/sim.js`)
- 5,000 walkers, each with its own seeded random stream, so a walker's path does not depend on how long the others are simulated.
- Position stored **every minute** (cell index), so a later clue can reweight whole paths.
- Per walker:
  - **speed**: truncated normal, mean 0.62, SD 0.23 m/s (DATA: Toots et al. 2019, n = 309 older adults with cognitive impairment), scaled by the mobility input;
  - **share of time moving** and **minutes of mobility** (how long before they settle), each from a distribution; ISRID mobility hours (n = 42) are a check, not an input;
  - **behavior**: keeps one course / wanders / heads for a familiar place / stays near a structure, with calibrated weights;
  - **road habit**: 34% follow roads, 66% cross or leave them (DATA, ISRID).
- Ways to stop: mobility runs out; goes into a structure; stuck in brush, woods, wetland or a drainage channel; walks into water (decided once per walker, a small calibrated chance; the hazard layer does not depend on it).
- Familiar places pull through a cost-to-reach field over the ground map, so a goal-seeker walks around lakes and blocks instead of into them.
- The start is snapped to the nearest cell joined to the main street network.

### 3. Time
- The map is for **t minutes since last seen**: where each walker is at minute t.
- **Still missing** evidence: a person not yet found at t probably did not spend long on busy roads, where the public would have noticed. Each walker's weight is multiplied by (1 − rate × exposure) for every minute on a road. In calibration the same rate *finds* walkers on roads, which is where ISRID's 36% road finds come from.

### 4. Hybrid map (stage 3)
- **ISRID statistics map**: the urban distance curve, limited by how far a person could have gone in t minutes, times the find-location share of each cell's class.
- Blend: `w × walker density + (1 − w) × statistics map`. `w` is chosen by evaluation on the calibration start points and reported, including if it ends at a limit.
- Updates are Bayesian on both parts together (each part keeps its own evidence weight), so the blend shifts toward whichever part the searches support.

### 5. Rest of world
- Walkers that leave the raster, and the statistics map's mass beyond it, are **rest of world**. `Prediction.restOfWorld` is its probability, and `grid.p` sums to `1 − restOfWorld`. It replaces the 2% floor.

### 6. Two layers
- **POA** (`grid.p`): where they probably are.
- **Hazard** (`grid.hazard`, new): water, creeks and drainage channels in or beside the likely area, scored by how much probability is nearby. Hazard flags on spots and areas come from this layer. No walker is pushed into a creek to make a flag appear.

### 7. Calibration and evaluation (stage 4)
- `tools/calibrate.js`: random search plus local refinement over the ASSUMPTION constants, fitting the urban ISRID statistics on Fremont start points, with other start points held out. Writes `engine/calibrated.json` (and a `.js` copy the browser can import).
- `bench/prior-eval.js`: true locations placed from ISRID statistics only. Compares urban rings, the statistics map (an upper bound: it is the recipe that placed the truths), the old engine (frozen copy of `main` in `bench/old-engine/`), and the new prior.

## Numbers used, checked against their sources (Nov 22)

Koester, *Lost Person Behavior*, dementia chapter (https://www.dbs-sar.com/LPB/Dementia.pdf):

| Statistic | Value | Checked |
|---|---|---|
| Urban distance from the IPP, 25/50/75/95% (n = 336) | 0.3 / 1.1 / 3.2 / 12.6 km | yes |
| Temperate flat distance (n = 175), the alternative | 0.3 / 1.0 / 2.4 / 12.8 km | yes |
| Urban find location (n = 223) | structure 35, road 36, linear 9, field 6, water 6, drainage 4, woods 3, brush 1 | yes; these eight sum to 100 |
| Track offset 25/50/75/95% (n = 110) | 4 / 15 / 71 / 307 m | yes |
| Dispersion angle 25/50/75/95% (temperate, n = 11) | 11 / 23 / 66 / 70° | yes |
| Elevation (temperate) | 19% up, 42% down, 39% same | yes; not modeled |
| Mobility 25/50/75/95% (temperate, n = 42) | 0 / 0.25 / 3.8 / 18 h | yes |
| Cross or depart from a road | 66% | yes |
| Alive when found within 24 h / after 24 h | 95% / 77% | yes |

Other sources:

- Rowe et al. 2011, BMC Geriatrics 11:28 (325 newspaper reports): of those on foot, 53% found within 1 mile and 75% within 5 miles. **Correction to our brief:** of walkers found dead, **50%** were within 0.5 mile (not "most"); deaths "most commonly occurred in unpopulated areas".
- Toots et al. 2019, J Alzheimers Dis 71(s1): usual gait speed 0.62 ± 0.23 m/s, n = 309, community-dwelling, cognitive impairment (not all diagnosed dementia).
- Sava, Twardy, Koester, Sonwalkar 2016, Transactions in GIS 20(1): r = (n + m/2)/N, R = (0.5 − r)/0.5; distance rings scored 0.78 (95% CI 0.74–0.82, 376 cases) on a 25 × 25 km map of 5 m pixels. Our raster is 6.4 km across, so R is only comparable when computed over the same 25 km extent.
- Koester, Cooper, Frost, Robe 2004 (DTIC ADA511593): POD = 1 − e^(−coverage) (Koopman); sweep widths for an adult-sized target 16–142 m in forest and wildland. No urban figure was found, so the search constants stay ASSUMPTION.

## Contract changes (need Ben's OK)

- `engine/index.js` keeps `prepareArea, replay, cellToLatLng, nextSectors, topSpots, routeFor` with the same shapes.
- New, optional: `OsmData.layers`; `caseInput.gridOrigin`; `caseInput.minutesAt`; `Prediction.restOfWorld`, `grid.origin`, `grid.hazard`.
- `grid.p` sums to `1 − restOfWorld` instead of 1.
- Grid and sector ids are anchored to the case: `gridOrigin`, or the last-seen point rounded if it is absent. The exact list of what `app.js` and the share link must pass is in the stage 3 commit.

## Constant labels

Every tunable constant carries one of:

- **DATA**: a published number, never tuned (sensitivity ±20%).
- **EXPERT**: a described behavior whose number we chose.
- **ASSUMPTION**: our choice, tuned by `tools/calibrate.js` (sensitivity ±50%).

## As built (added after stage 4)

The note above was written before any code. What changed along the way:

- **Positions are kept at 25 m, not 10 m.** Each walker-minute is 4 bytes: a 16-bit square of the 25 m map and a 16-bit running total of exposure to the public. The 10 m ground map is still what the walkers walk on.
- **Tired walkers step off the road.** ISRID says urban subjects are found "in structures or walking along roads", so in the model a road find can only happen by being noticed. That ties the spotting rate to the 36% road finds, and the same rate is the "still missing" evidence.
- **The blend came out at 5% walkers, 95% statistics map**, by evaluation on the calibration start points. With no clues and ISRID-drawn truths, the walkers add little.
- **Goal-seekers have their own share.** When a case lists familiar places, 25% of the map (`SHARE_GOAL`, an assumption) goes to walkers heading there, outside the blend, because the statistics map can't express it.
- **Mobility hours are not fitted.** The fitted "minutes of mobility" is so long (median 19 h, at the low limit of its spread) that walkers almost never stop from tiredness: they stop by being noticed (37%), at a structure (26%), stuck in terrain (8%), in water (3%), or by leaving the map (17%). ISRID's mobility sample says half stop within 15 minutes. The report shows the mismatch.
- **Downloads are squares in two phases**, centered on the grid origin, so the whole map has data and the first map doesn't wait for buildings.
- **The engine runs in a Web Worker**, warmed up at page load; walkers are simulated in 15-minute blocks.
- Evaluation, calibration table, sensitivity, limits: `bench/prior-report.md`.
