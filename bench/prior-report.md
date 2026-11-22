# Prior v2: evaluation report

Made by `node bench/prior-eval.js` and `node bench/prior-report.js` on 2026-11-22. 60 held-out Fremont start points (never used in calibration), 20 true locations per start and time, 6000 cases in all. True locations are placed from ISRID statistics only, never by our walkers. Score: area searched before reaching the person, most likely squares first (km², lower is better). The charts are in `bench/prior-report.html`.

## Verdict

- **The new prior reaches the person in less searched ground than the old engine and than distance rings, at every time tested.** For where people end up: median 0.989 km² searched, against 2.54 km² for the old engine as its app drew it (4.10 km² for its raw map) and 1.30 km² for rings. At 60 minutes: 0.920 against 2.06 and 1.21 km².
- **It is close to the upper bound, and that is partly by construction.** The ISRID statistics map scores 1.03 km² (end) and 0.896 km² (60 min). It is the recipe that placed the true locations, and the new prior is 95% that map.
- **The evaluation chose a walkers' share of 0.05.** With true locations placed from ISRID statistics alone, the walkers add little to a map with no clues. They still decide what a direction, a familiar place, a sighting or a search does to the map, which this evaluation cannot score.
- **Calibration fits the urban distances** (26.4 / 49.9 / 80.5% within 0.3 / 1.1 / 3.2 km on held-out starts; ISRID 25 / 50 / 75) **and does not fit the mobility hours**: the model's median is 2.65 h against ISRID's 0.25 h. Both are reported as they came out.
- **Phone budget (cold replay under 2,000 ms with the processor slowed four times): met for first-hour cases**, 886 to 1432 ms in Chrome for the Demo and for 75-minute cases with 7 searches and 3 sightings. Older cases are slower because the walkers have walked longer: 1197 ms for a case 4 hours old, 1775 ms for a case 12 hours old. These timings move by about ±30% with what else the laptop is doing.

## Evidence

### Where people end up (no time limit)

892 cases on the map, 308 off it.

| Method | Median km² | Found within 0.25 km² | Found within 0.5 km² | Found within 1 km² | Found within 2 km² | R (our 6.4 km map) | R (25 km extent) |
|---|---|---|---|---|---|---|---|
| Distance rings | 1.30 | 31% | 39% | 47% | 57% | 0.713 | 0.787 |
| Old engine, raw map | 4.10 | 11% | 18% | 27% | 38% | 0.465 | 0.775 |
| Old engine, as the app drew it | 2.54 | 12% | 21% | 31% | 45% | 0.647 | 0.784 |
| New prior | 0.989 | 34% | 41% | 50% | 59% | 0.754 | 0.789 |
| ISRID statistics map (upper bound) | 1.03 | 34% | 42% | 50% | 59% | 0.758 | 0.789 |

New prior against rings: 458 wins, 190 ties, 244 losses (wins 65% of the cases that are not ties; a tie is both within 0.05 km²). Total ground searched over all cases: rings 5240 km², new prior 4486 km² (14% less). Against the old engine as its app drew it: 658 wins, 30 ties, 204 losses; total 6446 km² against 4486 km² (30% less).

**About the two old-engine rows.** The old engine's own 25 m map is 5,000 end points on street lines over an even 2% floor, so about half the true locations sit on a floor square and tie with tens of thousands of others. The old app blurred that map by about 150 m before drawing it. "As the app drew it" applies the same blur and is the fair comparison; the raw row is what the engine's own numbers said.

**About R.** r = (n + m/2) / N and R = (0.5 − r) / 0.5 (Sava, Twardy, Koester, Sonwalkar 2016); 1 is perfect, 0 is a blank map. The first R column is over our own 6.4 km map and only the cases on it. The second is over a 25 × 25 km extent, the one Sava et al. used, and includes the 308 cases off our map, for which every method alike must search the whole map and then outward in rings. That is why the methods barely differ there: the score is dominated by the far cases no map of this size can help with. Sava et al. report 0.78 for rings on 376 real cases; our 0.79 for rings is on simulated cases that follow the ISRID urban curve exactly, so the closeness says the extent and the distance curve are comparable, not that the two tests are the same.

### By time since last seen

| Minutes since last seen | Cases on map | Distance rings, median km² | Old engine, raw map, median km² | Old engine, as the app drew it, median km² | New prior, median km² | ISRID statistics map (upper bound), median km² | New prior: share off the map |
|---|---|---|---|---|---|---|---|
| 15 min | 1193 | 0.132 | 0.371 | 0.393 | 0.100 | 0.101 | 0% |
| 30 min | 1195 | 0.459 | 0.875 | 0.963 | 0.325 | 0.319 | 0% |
| 60 min | 1194 | 1.21 | 2.24 | 2.06 | 0.920 | 0.896 | 0% |
| 120 min | 1176 | 2.82 | 5.31 | 3.68 | 2.03 | 2.00 | 1% |
| where they end up | 892 | 1.30 | 4.10 | 2.54 | 0.989 | 1.03 | 23% |

| Minutes since last seen | Distance rings, found within 0.5 km² | Old engine, raw map, found within 0.5 km² | Old engine, as the app drew it, found within 0.5 km² | New prior, found within 0.5 km² | ISRID statistics map (upper bound), found within 0.5 km² |
|---|---|---|---|---|---|
| 15 min | 92% | 51% | 63% | 92% | 92% |
| 30 min | 53% | 32% | 27% | 62% | 62% |
| 60 min | 33% | 18% | 21% | 38% | 38% |
| 120 min | 29% | 13% | 17% | 32% | 32% |
| where they end up | 39% | 18% | 21% | 41% | 42% |

The end-state row has smaller areas than the 120-minute row because 26% of end-state truths are beyond the map and left out of it; at 120 minutes almost everyone is still on the map, including those on their way out.

At 60 minutes, new prior against rings: 675 wins, 195 ties, 324 losses; against the old engine as drawn: 875 wins, 36 ties, 283 losses.

### By distance of the true location (end state), median km²

| Distance | Cases | Distance rings | Old engine, raw map | Old engine, as the app drew it | New prior | ISRID statistics map (upper bound) |
|---|---|---|---|---|---|---|
| under 0.5 km | 402 | 0.045 | 1.18 | 0.775 | 0.048 | 0.048 |
| 0.5 to 1.5 km | 259 | 2.42 | 6.31 | 3.73 | 2.08 | 2.07 |
| 1.5 to 3 km | 187 | 14.1 | 23.6 | 16.2 | 12.5 | 11.8 |
| over 3 km | 44 | 34.2 | 23.7 | 30.8 | 27.9 | 28.6 |

### By find type (end state), median km²

| Find type | Cases | Distance rings | Old engine, raw map | Old engine, as the app drew it | New prior | ISRID statistics map (upper bound) |
|---|---|---|---|---|---|---|
| structure | 342 | 0.857 | 5.40 | 2.54 | 0.843 | 0.842 |
| road | 374 | 0.959 | 2.40 | 2.09 | 0.746 | 0.696 |
| linear | 79 | 2.30 | 2.94 | 3.34 | 1.29 | 1.24 |
| field | 60 | 1.39 | 23.1 | 3.57 | 2.18 | 2.15 |
| water | 18 | 16.8 | 23.2 | 15.3 | 2.92 | 3.66 |
| drainage | 18 | 5.59 | 21.7 | 4.93 | 2.19 | 2.08 |
| woods | 1 | 16.4 | 23.1 | 10.9 | 4.17 | 4.09 |

### Mismatch: gone 100 minutes, the app is told 60

1194 cases with the true location placed for 100 minutes.

| Map | Median km² | Found within 1 km² |
|---|---|---|
| Distance rings | 1.93 | 39% |
| Old engine as drawn, told 60 | 2.69 | 27% |
| Old engine as drawn, told 100 (correct) | 2.85 | 28% |
| New prior, told 60 | 1.69 | 42% |
| New prior, told 100 (correct) | 1.63 | 41% |
| ISRID statistics map, told 60 | 1.70 | 42% |
| ISRID statistics map, told 100 (correct) | 1.64 | 41% |

### Stability across seeds

The same case run with two different seeds; overlap of the two hot zones (the smallest set of squares holding 80% of the chance on the map), median over 20 starts.

| Map | At 60 min | End state (12 h) |
|---|---|---|
| New prior (the blend) | 97% | 95% |
| Walkers alone (5,000) | 55% | 34% |

### Calibration: target against model

Walkers run for 12 hours with spotting on. "Calibration" = the 24 start points the fit used; "held out" = 600 walkers from each of 24 start points it never saw. Score (lower is closer): defaults 44.1, calibration starts 3.89, held-out starts 3.9.

| Statistic | Target | Before (defaults) | Model, calibration starts | Model, held-out starts | Fitted? |
|---|---|---|---|---|---|
| Found within 0.3 km (ISRID 25%) | 25% | 62.3 | 25.3 | 26.4 | yes, weight 3 |
| Found within 1.1 km (ISRID 50%) | 50% | 93.1 | 49.0 | 49.9 | yes, weight 4 |
| Found within 3.2 km (ISRID 75%) | 75% | 99.6 | 80.9 | 80.5 | yes, weight 3 |
| Found at a structure | 35% | 66.7 | 37.6 | 38.3 | yes, weight 1 |
| Found on a road | 36% | 14.9 | 36.2 | 37.6 | yes, weight 1.5 |
| Found on a path (linear) | 9% | 3.7 | 10.2 | 8.8 | yes, weight 0.75 |
| Found in a field / open ground | 6% | 6.5 | 2.3 | 1.7 | yes, weight 0.5 |
| Found in water | 6% | 0.6 | 5.1 | 5.4 | yes, weight 1 |
| Found in a drainage | 4% | 7.6 | 8.6 | 8.1 | yes, weight 1 |
| Found in woods | 3% | 0.0 | 0.0 | 0.0 | yes, weight 0.25 |
| Found in brush | 1% | 0.0 | 0.0 | 0.0 | yes, weight 0.25 |
| Track offset, 25% | 4 m | 10 | 10 | 10 | no, check only |
| Track offset, 50% | 15 m | 10 | 14 | 14 | yes, weight 0.5 |
| Track offset, 75% | 71 m | 20 | 30 | 34 | yes, weight 0.5 |
| Track offset, 95% | 307 m | 42 | 56 | 56 | no, check only |
| Dispersion angle, 25% | 11° | 10 | 14 | 15 | no, check only |
| Dispersion angle, 50% | 23° | 23 | 31 | 31 | yes, weight 0.25 |
| Dispersion angle, 75% | 66° | 45 | 60 | 59 | no, check only |
| Mobility, 25% | 0 h | 0.12 | 0.67 | 0.60 | no, check only |
| Mobility, 50% | 0.25 h | 0.33 | 2.76 | 2.65 | no, check only |
| Mobility, 75% | 3.8 h | 0.83 | 5.69 | 5.50 | no, check only |
| Mobility, 95% | 18 h | 2.27 | 12.00 | 12.00 | no, check only |
| Found within 1 mile (Rowe 2011) | 53% | 97.2 | 60.7 | 60.2 | no, check only |

Elevation (temperate: 19% up, 42% down, 39% same) is not modeled.

Why walkers stopped (held-out starts): still moving 6.2%, mobility time over 2.8%, went to a structure 26.4%, walked into water 2.8%, stuck in terrain 8.1%, noticed by the public 36.6%, left the map 17.1%.

### The spotting rate, fitted jointly

One rate does two jobs. Fitted value: **0.01024 per minute on a main road** (scaled down by road type).

1. **It produces the road finds.** A walker that stops walking steps off the road, so "found on a road or path" only happens by being noticed. Model: road 37.6% (ISRID 36%), path 8.8% (ISRID 9%); 36.6% of all walkers end by being noticed.
2. **It explains "still missing".** The weight left on a walker who has spent the time on that kind of road:

| Road | After 10 min | After 30 min | After 60 min |
|---|---|---|---|
| main road (primary) | 0.902 | 0.734 | 0.539 |
| secondary road | 0.937 | 0.823 | 0.678 |
| collector (tertiary) | 0.96 | 0.884 | 0.781 |
| residential street | 0.982 | 0.946 | 0.895 |
| footway | 0.99 | 0.97 | 0.94 |
| driveway / parking aisle | 0.994 | 0.982 | 0.964 |

### Mobility: the mismatch, as it is

|  | 25% | 50% | 75% | 95% |
|---|---|---|---|---|
| ISRID mobility hours (temperate, n = 42) | 0 | 0.25 | 3.8 | 18 |
| Model, held-out starts (hours until the walker stops) | 0.60 | 2.65 | 5.50 | 12.00 |

(The model's 95% value is 12 h because the walkers are simulated for 12 hours.) At 0.62 m/s, moving 60% of the time, 15 minutes covers about 330 m of path. ISRID's urban median distance is 1,100 m in a straight line. The two samples cannot both hold for one population at that speed. Distance has 336 cases and is what a search plan is drawn from, so it is the fitted target; mobility is shown, not fitted, and not adjusted to look closer.

### The blend, chosen by evaluation

On the 24 calibration start points (not the held-out ones), 3590 true locations at 30, 60 and 120 minutes and the end state. Typical area searched (geometric mean, km²) for each share given to the walkers:

| Walkers' share | 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| km² | 0.397 | 0.399 | 0.411 | 0.430 | 0.455 | 0.486 | 0.523 | 0.569 | 0.623 | 0.694 | 1.173 |

Best: **0.05**. The curve is nearly flat from 0 to 0.1 and rises steadily after that; walkers alone (1.0) are the worst choice by a wide margin.

What this does and does not say: with no clues, on true locations drawn from the ISRID recipe, the recipe's own map is hard to beat, and 5,000 walkers add sampling noise to it. It does not say the walkers are useless: they are what a search or a sighting re-weighs in time order, and when a case lists familiar places a further 25% of the map goes to walkers heading there (`SHARE_GOAL`, an assumption this evaluation cannot score, because ISRID has no number for it).

### Numbers that ended at a limit

- MOBILE_SIGMA (low)
- P_STRUCT_STAYER (high)

### Fitted numbers

| Number | Default | Fitted | Allowed range | At a limit? |
|---|---|---|---|---|
| `MOBILE_MEDIAN_MIN` | 60 | 1146 | 10 to 1440 | no |
| `MOBILE_SIGMA` | 1.4 | 0.5 | 0.5 to 2.5 | **low** |
| `SHARE_WANDER` | 0.2 | 0.118 | 0.02 to 0.6 | no |
| `SHARE_STAYER` | 0.25 | 0.1377 | 0.02 to 0.9 | no |
| `STAYER_MOBILE_MEDIAN_MIN` | 10 | 14.77 | 1 to 60 | no |
| `TURN_SCALE_DEG` | 35 | 47.61 | 15 to 90 | no |
| `WANDER_TURN_SCALE_DEG` | 90 | 63.05 | 30 to 180 | no |
| `COURSE_SCALE_DEG` | 45 | 50.67 | 15 to 120 | no |
| `ROAD_STICK` | 8 | 5.205 | 1.5 to 40 | no |
| `OPEN_BOOST` | 1 | 1.24 | 0.3 to 8 | no |
| `P_STRUCT_STEP` | 0.004 | 0.000445 | 0.0003 to 0.05 | no |
| `P_STRUCT_STAYER` | 0.08 | 1 | 0.005 to 1 | **high** |
| `P_WATER_ENTER` | 0.15 | 0.3564 | 0.01 to 0.9 | no |
| `P_CREEK_STUCK` | 0.2 | 0.03082 | 0.001 to 0.9 | no |
| `P_WOODS_STUCK` | 0.02 | 0.001274 | 0.001 to 0.3 | no |
| `P_BRUSH_STUCK` | 0.05 | 0.003291 | 0.001 to 0.3 | no |
| `SPOT_RATE_PER_MIN` | 0.03 | 0.01024 | 0.001 to 0.5 | no |

Walker kinds as fitted: keeps a course 68%, wanders 15%, stays near a structure 17%. 401 settings tried in 247 s.

### Sensitivity

One number changed at a time, ±50% (DATA numbers ±20%), kept inside its range; everything else as fitted. Fitted score 3.943.

| Number | Kind | Score if lower | Score if higher | Moves most (lower) | Moves most (higher) |
|---|---|---|---|---|---|
| `HEADING_MEMORY` | ASSUMPTION | 4.401 (+0.458) | 25.384 (+21.441) | structure -5.7 | structure +25.7 |
| `COURSE_SCALE_DEG` | ASSUMPTION | 9.038 (+5.095) | 5.202 (+1.259) | structure +9.6 | structure -4.0 |
| `MOVE_FRAC_MAX` | ASSUMPTION | 8.884 (+4.94) | 4.23 (+0.287) | within3200m +6.9 | within3200m -1.5 |
| `SHARE_STAYER` | ASSUMPTION | 7.152 (+3.208) | 8.447 (+4.504) | structure -7.3 | within300m +5.6 |
| `SPOT_RATE_PER_MIN` | ASSUMPTION | 7.425 (+3.481) | 8.335 (+4.392) | road -9.7 | road +5.7 |
| `SPEED_MEAN_MPS` | DATA | 6.638 (+2.695) | 4.448 (+0.504) | within3200m +3.8 | within3200m -3.0 |
| `MOBILE_MEDIAN_MIN` | ASSUMPTION | 5.928 (+1.985) | 3.824 (-0.119) | road -4.1 | structure -0.5 |
| `TURN_SCALE_DEG` | ASSUMPTION | 5.444 (+1.501) | 4.068 (+0.125) | road -2.3 | within3200m +0.8 |
| `P_STRUCT_STEP` | ASSUMPTION | 3.796 (-0.148) | 5.39 (+1.446) | structure -2.8 | structure +3.5 |
| `P_CREEK_STUCK` | ASSUMPTION | 3.719 (-0.224) | 4.775 (+0.832) | drainage -3.3 | drainage +2.9 |
| `SHARE_WANDER` | ASSUMPTION | 4.667 (+0.724) | 4.518 (+0.574) | road -1.7 | within1100m +1.6 |
| `STRUCT_MIN_M` | ASSUMPTION | 4.487 (+0.544) | 4.16 (+0.217) | road -1.0 | within1100m -1.0 |
| `OPEN_BOOST` | ASSUMPTION | 4.005 (+0.062) | 4.307 (+0.363) | structure -1.2 | road -0.9 |
| `MOBILE_SIGMA` | ASSUMPTION | 3.943 (+0) | 4.301 (+0.357) | within300m +0.0 | structure +1.3 |
| `ROAD_STICK` | ASSUMPTION | 4.211 (+0.268) | 3.932 (-0.011) | road -1.0 | structure -0.8 |
| `WANDER_TURN_SCALE_DEG` | ASSUMPTION | 4.203 (+0.259) | 4.067 (+0.124) | within1100m -0.9 | within300m +0.5 |
| `ROAD_FOLLOWER_SHARE` | DATA | 4.101 (+0.158) | 3.839 (-0.104) | within1100m -0.5 | road +0.9 |
| `P_WATER_ENTER` | ASSUMPTION | 3.955 (+0.012) | 4.099 (+0.156) | water -1.5 | water +1.7 |
| `P_STRUCT_STAYER` | ASSUMPTION | 3.887 (-0.056) | 3.943 (+0) | structure -0.3 | within300m +0.0 |
| `STAYER_MOBILE_MEDIAN_MIN` | ASSUMPTION | 3.909 (-0.035) | 3.964 (+0.021) | structure -0.4 | structure +0.2 |
| `P_WOODS_STUCK` | ASSUMPTION | 3.943 (+0) | 3.949 (+0.006) | within300m +0.0 | woods +0.0 |
| `P_BRUSH_STUCK` | ASSUMPTION | 3.943 (+0) | 3.943 (+0) | within300m +0.0 | within300m +0.0 |

### Time and memory

| Measure | Value |
|---|---|
| Cold replay, laptop (median over the held-out starts, at 60 min) | 292 ms (slowest 569 ms) |
| 5-minute clock tick, laptop | 2 ms; 99 ms for the one tick in three that starts a new 15-minute block of walking |
| Chrome, processor slowed 4×: Demo case at 45 min (1 familiar place, no events) | 886 ms cold; 313 ms for the next clock tick (one that starts a new block of walking, except at the 12 h cap) |
| Chrome, processor slowed 4×: new case at 75 min, 7 searches + 3 sightings | 1432 ms cold; 476 ms for the next clock tick (one that starts a new block of walking, except at the 12 h cap) |
| Chrome, processor slowed 4×: another new case at 75 min, 7 searches + 3 sightings | 1302 ms cold; 468 ms for the next clock tick (one that starts a new block of walking, except at the 12 h cap) |
| Chrome, processor slowed 4×: a case 4 hours old, no events | 1197 ms cold; 675 ms for the next clock tick (one that starts a new block of walking, except at the 12 h cap) |
| Chrome, processor slowed 4×: a case 12 hours old, no events | 1775 ms cold; 10 ms for the next clock tick (one that starts a new block of walking, except at the 12 h cap) |
| Chrome, unslowed: Demo case at 45 min (1 familiar place, no events) | 280 ms cold |
| Chrome, unslowed: new case at 75 min, 7 searches + 3 sightings | 369 ms cold |
| Chrome, unslowed: another new case at 75 min, 7 searches + 3 sightings | 345 ms cold |
| Chrome, unslowed: a case 4 hours old, no events | 300 ms cold |
| Chrome, unslowed: a case 12 hours old, no events | 453 ms cold |
| Memory per walker-minute | 4 bytes (a 16-bit map square and a 16-bit exposure total) |
| Walkers, a case at 45 min / 2 h / the 12 h cap | 2.2 MB / 3.4 MB / 15.4 MB |
| Ground map; one familiar-place field | 1.6 MB; 1.6 MB |
| Map data in memory (the Demo's 6.9 MB file) | about 23 MB, plus about 29 MB for the street network; twice that with the worker's copy |

## Honest limits

- No real cases. Every "true location" is drawn from published ISRID statistics. The ranking of methods is only as good as that recipe, and the recipe is also half of what is being tested.
- The upper bound and the new prior share the recipe. "New prior is close to the upper bound" mostly says the blend leans on the statistics map; it is not independent evidence that the map is right.
- ISRID's 95% distance (12.6 km) cannot be tested: the map reaches 3.2 km. 26% of end-state truths fall off the map and are excluded from the area numbers (they are in the 25 km R). The model sends 17.1% of walkers off the map.
- The mobility mismatch is real: ISRID's mobility sample (temperate, n = 42) says half stop within 15 minutes; the urban distances (n = 336) need people to keep going far longer at the measured walking speed. We fitted the distances.
- Time-conditioned truths ("t minutes after") use our own rule, the smaller of the ISRID end distance and pace × t. ISRID has no distance-by-time table, so the 15 to 120 minute rows rest on that assumption and on the gait-speed study (people with cognitive impairment, not all diagnosed dementia).
- One city. Start points, ground classes and calibration are all Fremont. The dispersion angle (n = 11) and track offset come from non-urban samples.
- The spotting rate is identified only through the road-find share and the road-type exposure table, which is our assumption. Track offset below 10 m cannot be resolved on 10 m squares.
- The old engine is scored on a download centered on each start, the best case for it, and both raw and blurred as its app drew it. Direction, familiar places, sightings and searches are not part of this evaluation.
- Elevation is not modeled. The sea would be treated as plain ground.

## Reproduce

```bash
node tools/calibrate.js            # about 10 minutes; writes engine/calibrated.json and .js
node bench/prior-eval.js           # about 6 minutes; writes bench/prior-results.json
node bench/real-cases.js           # the real-world check (reads docs/research/cases-public.csv)
node bench/real-cases-maps.js      # optional, needs the internet: the prior on real found places
node bench/prior-report.js         # writes this file and bench/prior-report.html
node --expose-gc bench/phone-budget.js      # time and memory in Node
node tools/browser/budget.mjs      # time in Chrome slowed 4x (see tools/browser/README.md)
```
