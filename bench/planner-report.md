# Search planner: benchmark report

Made by `node bench/planner-eval.js` on 2026-11-22 (2 min). 16 setups (8 start points × 2 times since last seen) × 250 simulated people = 4,000 cases, each played by every strategy. 6 searchers on foot, 180 minutes of searching, in daylight.

**Read this first.** Everything here is simulated. The people come from ISRID statistics, the searchers and the chance of spotting someone are modeled, and no real search was run. The numbers say how the strategies compare under these assumptions, not how many people a real team would find. Ranges in brackets are 95% intervals from resampling setups; with this few setups they are wide.

## Everyone

| Strategy | Found by 30 min | Found by 60 min | Found by 120 min | Found by 180 min | Expected minutes to find (capped at 180) |
|---|---|---|---|---|---|
| On their own, with memory | 11% (7%–14%) | 14% (10%–17%) | 18% (14%–23%) | 21% (18%–25%) | 153 (146–159) |
| Ring sweep, cycling | 15% (12%–19%) | 18% (15%–22%) | 22% (18%–25%) | 24% (21%–28%) | 146 (140–152) |
| Greedy on the plain statistics map | 15% (12%–19%) | 19% (16%–22%) | 22% (20%–25%) | 24% (22%–27%) | 145 (140–150) |
| Old app: nextSectors + routeFor | 14% (11%–17%) | 17% (14%–20%) | 20% (17%–22%) | 22% (19%–24%) | 149 (144–154) |
| Planner | 13% (11%–16%) | 18% (15%–20%) | 22% (19%–25%) | 24% (21%–27%) | 147 (142–152) |
| Planner on the plain statistics map | 15% (12%–17%) | 19% (16%–21%) | 23% (20%–26%) | 26% (23%–29%) | 145 (140–150) |
| Planner, 25 m map split evenly | 14% (11%–16%) | 17% (15%–20%) | 21% (19%–24%) | 24% (21%–26%) | 147 (143–152) |
| Planner, hazard-first rule off | 14% (12%–17%) | 19% (16%–22%) | 23% (20%–26%) | 24% (21%–27%) | 145 (140–150) |
| Planner, containment off | 14% (11%–17%) | 18% (15%–21%) | 22% (19%–25%) | 25% (21%–28%) | 146 (141–151) |
| Planner, no door-knocking | 14% (11%–17%) | 17% (15%–21%) | 20% (17%–23%) | 23% (19%–26%) | 148 (143–153) |

Who they are: 20% end up off the map and can only be found on their way out; 50% are still walking when the search starts; 35% end up in or at a structure; 10% in water or a drainage.

## Planner against each baseline (same people, paired)

| Planner minus … | Found by 30 min, points | Found by 60 min, points | Found by 120 min, points | Found by 180 min, points | Minutes to find |
|---|---|---|---|---|---|
| On their own, with memory | +3 (+0 to +5) | +4 (+1 to +7) | +3 (+0 to +7) | +2 (−1 to +5) | −5 (−10 to −1) |
| Ring sweep, cycling | −2 (−4 to +0) | −1 (−2 to +1) | −0 (−2 to +2) | −1 (−3 to +1) | +1 (−1 to +4) |
| Greedy on the plain statistics map | −2 (−4 to −1) | −2 (−3 to −0) | −1 (−3 to +1) | −1 (−3 to +1) | +2 (−0 to +5) |
| Old app: nextSectors + routeFor | −1 (−3 to +1) | +1 (−1 to +3) | +2 (+0 to +3) | +2 (+0 to +4) | −2 (−4 to +1) |

A range that does not include 0 is a difference this run can tell from chance. Negative minutes mean the planner is faster.

## What each part of the planner is worth

| Planner minus … | Found by 30 min, points | Found by 60 min, points | Found by 120 min, points | Found by 180 min, points | Minutes to find |
|---|---|---|---|---|---|
| Planner on the plain statistics map | −2 (−3 to −0) | −1 (−2 to +0) | −1 (−3 to −0) | −2 (−4 to −1) | +3 (+1 to +4) |
| Planner, 25 m map split evenly | −1 (−1 to +0) | +1 (−0 to +1) | +0 (−1 to +2) | −0 (−1 to +1) | −0 (−2 to +1) |
| Planner, hazard-first rule off | −1 (−3 to +0) | −1 (−2 to −0) | −1 (−2 to +0) | −1 (−2 to +0) | +2 (+0 to +4) |
| Planner, containment off | −1 (−2 to +0) | −0 (−1 to +0) | −0 (−1 to +0) | −1 (−2 to −0) | +1 (+0 to +2) |
| Planner, no door-knocking | −1 (−2 to +1) | +0 (−1 to +1) | +1 (+0 to +2) | +1 (−0 to +2) | −1 (−2 to +0) |

## The hazard-first rule (ASSUMPTION), tested

People who end up in water or a drainage (408 of 4,000):

| Strategy | Found by 30 min | Found by 60 min | Found by 120 min | Found by 180 min | Expected minutes to find (capped at 180) |
|---|---|---|---|---|---|
| Old app: nextSectors + routeFor | 19% (14%–24%) | 22% (17%–27%) | 26% (21%–31%) | 28% (22%–34%) | 140 (131–148) |
| Planner | 18% (12%–24%) | 22% (17%–28%) | 25% (20%–31%) | 28% (22%–34%) | 140 (130–149) |
| Planner, hazard-first rule off | 19% (14%–24%) | 23% (18%–28%) | 26% (20%–32%) | 28% (22%–34%) | 140 (130–149) |

Rule on minus rule off, for these people: −1 (−4 to +3) points by 30 min; −0 (−3 to +3) points by 60 min; −0 (−4 to +3) points by 120 min; +0 (−3 to +4) points by 180 min; +0 (−4 to +5) minutes to find.

Rule on minus rule off, for everyone: −1 (−3 to +0) points by 30 min; −1 (−2 to −0) points by 60 min; −1 (−2 to +0) points by 120 min; −1 (−2 to +0) points by 180 min; +2 (+0 to +4) minutes to find.

## By where the person ends up (planner and old app)

| Group | People | Planner, found by 180 min | Old app, found by 180 min | Planner, minutes | Old app, minutes |
|---|---|---|---|---|---|
| In or at a structure | 1399 | 14% (11%–18%) | 9% (7%–12%) | 161 | 166 |
| On a road | 1478 | 28% (23%–33%) | 28% (23%–32%) | 141 | 141 |
| Path or other linear feature | 331 | 32% (24%–42%) | 30% (21%–40%) | 133 | 135 |
| Field or open ground | 224 | 26% (17%–36%) | 27% (18%–38%) | 145 | 144 |
| Water or drainage | 408 | 28% (22%–34%) | 28% (22%–34%) | 140 | 140 |
| Woods or brush | 160 | 32% (20%–43%) | 29% (19%–40%) | 134 | 136 |
| Still walking when the search starts | 1984 | 5% (2%–7%) | 5% (2%–8%) | 173 | 173 |
| Already stopped | 2011 | 42% (38%–48%) | 38% (34%–43%) | 122 | 126 |
| Ends up off the map | 809 | 4% (2%–7%) | 4% (1%–7%) | 173 | 173 |

## What the searchers did

| Strategy | Tasks per search | Share of time travelling | Task types |
|---|---|---|---|
| On their own, with memory | 27 | 50% | area 100% |
| Ring sweep, cycling | 34 | 32% | area 100% |
| Greedy on the plain statistics map | 36 | 25% | area 100% |
| Old app: nextSectors + routeFor | 38 | 22% | area 100% |
| Planner | 29 | 12% | hasty 36%, yards 35%, containment 15%, hazard_check 8%, park 6% |
| Planner on the plain statistics map | 29 | 15% | hasty 54%, yards 36%, hazard_check 5%, containment 3%, park 2% |
| Planner, 25 m map split evenly | 30 | 12% | yards 36%, hasty 30%, containment 19%, park 8%, hazard_check 7% |
| Planner, hazard-first rule off | 33 | 12% | yards 37%, hasty 34%, containment 22%, park 6% |
| Planner, containment off | 28 | 12% | yards 44%, hasty 41%, hazard_check 8%, park 7% |
| Planner, no door-knocking | 30 | 14% | hasty 39%, containment 27%, yards 20%, park 7%, hazard_check 7% |

## Setup by setup: found by the end

| Setup | Since last seen | On their own, with memory | Ring sweep, cycling | Greedy on the plain statistics map | Old app: nextSectors + routeFor | Planner | Planner on the plain statistics map | Planner, 25 m map split evenly | Planner, hazard-first rule off | Planner, containment off | Planner, no door-knocking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (37.5405, -121.9795) | 60 min | 19% | 22% | 24% | 20% | 19% | 22% | 20% | 20% | 20% | 18% |
| 2 (37.553, -121.97) | 60 min | 25% | 20% | 23% | 21% | 22% | 30% | 22% | 22% | 24% | 23% |
| 3 (37.548, -121.985) | 60 min | 35% | 32% | 27% | 27% | 28% | 30% | 30% | 28% | 28% | 26% |
| 4 (37.56, -121.975) | 60 min | 29% | 34% | 35% | 33% | 27% | 34% | 29% | 32% | 34% | 28% |
| 5 (37.545, -121.96) | 60 min | 18% | 15% | 20% | 13% | 14% | 17% | 15% | 14% | 14% | 16% |
| 6 (37.556, -121.982) | 60 min | 19% | 23% | 25% | 24% | 27% | 31% | 28% | 28% | 28% | 26% |
| 7 (37.55, -121.976) | 60 min | 30% | 33% | 30% | 26% | 30% | 34% | 28% | 31% | 30% | 31% |
| 8 (37.544, -121.972) | 60 min | 36% | 39% | 34% | 28% | 35% | 35% | 30% | 36% | 36% | 36% |
| 9 (37.5405, -121.9795) | 120 min | 14% | 16% | 17% | 13% | 18% | 19% | 16% | 17% | 16% | 15% |
| 10 (37.553, -121.97) | 120 min | 23% | 24% | 24% | 22% | 24% | 26% | 25% | 24% | 26% | 22% |
| 11 (37.548, -121.985) | 120 min | 18% | 28% | 23% | 22% | 24% | 23% | 23% | 24% | 24% | 22% |
| 12 (37.56, -121.975) | 120 min | 16% | 20% | 21% | 22% | 21% | 22% | 22% | 21% | 21% | 20% |
| 13 (37.545, -121.96) | 120 min | 12% | 17% | 22% | 13% | 14% | 17% | 18% | 16% | 15% | 11% |
| 14 (37.556, -121.982) | 120 min | 11% | 17% | 20% | 16% | 23% | 24% | 23% | 24% | 23% | 18% |
| 15 (37.55, -121.976) | 120 min | 15% | 23% | 23% | 23% | 24% | 23% | 24% | 24% | 24% | 22% |
| 16 (37.544, -121.972) | 120 min | 20% | 25% | 24% | 24% | 28% | 28% | 27% | 28% | 28% | 26% |

## How it works

- **People.** Distance from the last-seen point and kind of place are drawn from ISRID urban dementia statistics (0.3 / 1.1 / 3.2 / 12.6 km at 25 / 50 / 75 / 95%; structure 35, road 36, linear 9, field 6, water 6, drainage 4, woods 3, brush 1), then a real square of that kind at that distance is picked on the Fremont map. None of this uses the app's walkers.
- **Movement.** Each person walks to their place along the shortest street path at a pace drawn from Toots et al. 2019 (0.62 ± 0.23 m/s), moving 60% of the time (ASSUMPTION), starting when they were last seen. Those who have not arrived are on the way while the search runs. A quarter of ISRID's distances are beyond this 6.4 km map: those people walk off it and can only be found before they leave.
- **Searchers.** 6 on foot, starting within about 300 m of the last-seen point. Travel is walked on the street graph at 1.3 m/s times each searcher's own pace (±15%). 20% of tasks are not done as planned: the searcher wanders nearby for the same time, and half of those still report the task done, so the plan is credited with work that did not happen.
- **Detection.** A searcher passing within 45 m spots the person with probability 0.9 · e^(−1.8 d / W) at their closest approach, where W is the TRUE sweep width for the kind of ground the person is on: the planner's value times a factor drawn per setup between 0.5 and 1.5. Travelling counts as a hasty look. A person inside a building is never seen from outside. Door-knocking finds a person in that block's buildings or back yards with the true door-knock value (the planner's ± 50%), and a household gives the same answer every time it is asked.
- **The map each strategy sees.** The planner and the old app both get the engine's real map, re-run every 5 minutes of clock time as the app does. The planner is given no GPS trails: it believes its routes were walked as planned.
- **Planner variants.** "On the plain statistics map": the planner is given the statistics baseline's map instead of the app's, so the two differ only in method. "Split evenly": the app's 25 m map is shared out evenly over 10 m squares instead of by ISRID find-location shares. The others switch one rule off.
- **Baselines.** "On their own": each volunteer picks a 200 m area within a mile at random, closer being likelier, never one they searched themselves. "Ring sweep": areas within a mile, nearest first, starting over at the end. "Statistics map": the old greedy rule on a map made from the ISRID recipe itself (60,000 draws per setup), with Bayes after each empty search. "Old app": the engine's `nextSectors` top three; a volunteer takes the first one nobody else is in. All four walk the old `routeFor` routes, giving each area a turn of 20 to 30 minutes (a short route is walked again until 20 minutes are up) and skipping areas with under 150 m of street.
- **Intervals.** 1,000 resamples of setups with replacement, then of people inside each resampled setup. Differences are computed inside each resample on the same people.

## Limits

- One town. Every setup is in Fremont, on one map download.
- The "statistics map" baseline is given the same recipe that placed the people, so it is the best any map could be for people who have stopped. The planner uses the app's map, which does not know that recipe, except in the "on the plain statistics map" row.
- The detection model has the same shape as the planner's own. Its numbers are shifted per setup, but a real search could differ in shape too.
- Searchers in cars and searches at night are not in this run.
- A found person ends the case. Nothing here models a sighting, a phone call, or the person coming home.
- Each setup uses one team start and one draw of who does not follow the plan.
