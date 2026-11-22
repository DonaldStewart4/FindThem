# Search planner: benchmark report

Made by `node bench/planner-eval.js` on 2026-11-22 (3 min). 16 setups (8 start points × 2 times since last seen) × 250 simulated people = 4,000 cases, each played by every strategy. 6 searchers on foot, 180 minutes of searching, in daylight.

**Read this first.** Everything here is simulated. The people come from ISRID statistics, the searchers and the chance of spotting someone are modeled, and no real search was run. The numbers say how the strategies compare under these assumptions, not how many people a real team would find. Ranges in brackets are 95% intervals from resampling setups; with this few setups they are wide.

## Everyone

| Strategy | Found by 30 min | Found by 60 min | Found by 120 min | Found by 180 min | Expected minutes to find (capped at 180) |
|---|---|---|---|---|---|
| On their own, with memory | 11% (8%–14%) | 13% (10%–17%) | 17% (14%–21%) | 20% (16%–24%) | 154 (147–159) |
| Ring sweep, cycling | 15% (12%–18%) | 18% (15%–22%) | 22% (18%–26%) | 24% (21%–28%) | 146 (140–152) |
| Greedy on the plain statistics map | 15% (12%–18%) | 19% (16%–22%) | 23% (20%–26%) | 25% (22%–28%) | 145 (140–150) |
| Old app: nextSectors + routeFor | 14% (12%–17%) | 17% (14%–20%) | 20% (17%–23%) | 22% (19%–25%) | 148 (143–153) |
| Planner | 15% (12%–18%) | 18% (16%–21%) | 22% (20%–25%) | 25% (22%–28%) | 145 (141–150) |
| Planner on the plain statistics map | 15% (12%–17%) | 19% (16%–21%) | 23% (20%–26%) | 26% (23%–29%) | 145 (140–150) |
| Planner, 25 m map split evenly | 14% (11%–16%) | 18% (15%–21%) | 22% (19%–25%) | 25% (22%–27%) | 146 (142–151) |
| Planner, hazard-first rule off | 15% (12%–18%) | 19% (16%–22%) | 23% (20%–26%) | 25% (22%–28%) | 144 (139–149) |
| Planner, containment off | 15% (12%–18%) | 19% (16%–21%) | 22% (20%–25%) | 25% (22%–28%) | 145 (141–150) |
| Planner, no door-knocking | 14% (11%–16%) | 17% (14%–20%) | 21% (18%–24%) | 23% (20%–27%) | 148 (143–152) |

Who they are: 20% end up off the map and can only be found on their way out; 50% are still walking when the search starts; 35% end up in or at a structure; 10% in water or a drainage.

## Planner against each baseline (same people, paired)

| Planner minus … | Found by 30 min, points | Found by 60 min, points | Found by 120 min, points | Found by 180 min, points | Minutes to find |
|---|---|---|---|---|---|
| On their own, with memory | +4 (+2 to +6) | +5 (+3 to +8) | +5 (+3 to +8) | +5 (+2 to +8) | −8 (−12 to −4) |
| Ring sweep, cycling | +0 (−2 to +2) | −0 (−2 to +2) | +1 (−1 to +3) | +0 (−2 to +3) | −0 (−4 to +3) |
| Greedy on the plain statistics map | −0 (−2 to +2) | −0 (−2 to +1) | −0 (−2 to +1) | −0 (−2 to +1) | +1 (−2 to +3) |
| Old app: nextSectors + routeFor | +0 (−1 to +2) | +1 (+0 to +3) | +2 (+1 to +4) | +3 (+1 to +4) | −3 (−5 to −1) |

A range that does not include 0 is a difference this run can tell from chance. Negative minutes mean the planner is faster.

## What each part of the planner is worth

| Planner minus … | Found by 30 min, points | Found by 60 min, points | Found by 120 min, points | Found by 180 min, points | Minutes to find |
|---|---|---|---|---|---|
| Planner on the plain statistics map | +0 (−1 to +1) | −0 (−1 to +1) | −1 (−2 to +1) | −1 (−2 to +0) | +1 (−1 to +2) |
| Planner, 25 m map split evenly | +1 (+0 to +3) | +0 (−1 to +2) | +1 (−0 to +2) | +0 (−1 to +1) | −1 (−2 to +1) |
| Planner, hazard-first rule off | −0 (−1 to +1) | −1 (−2 to +0) | −1 (−2 to +1) | −0 (−2 to +1) | +1 (−1 to +3) |
| Planner, containment off | −0 (−1 to +0) | −0 (−1 to +0) | +0 (−0 to +1) | −0 (−1 to +0) | +0 (−0 to +1) |
| Planner, no door-knocking | +1 (−0 to +2) | +1 (+0 to +2) | +2 (+0 to +3) | +1 (+0 to +3) | −2 (−4 to −0) |

## The hazard-first rule (ASSUMPTION), tested

People who end up in water or a drainage (408 of 4,000):

| Strategy | Found by 30 min | Found by 60 min | Found by 120 min | Found by 180 min | Expected minutes to find (capped at 180) |
|---|---|---|---|---|---|
| Old app: nextSectors + routeFor | 19% (14%–24%) | 21% (16%–26%) | 27% (21%–33%) | 29% (23%–36%) | 139 (130–148) |
| Planner | 19% (13%–25%) | 22% (17%–29%) | 25% (19%–32%) | 27% (21%–34%) | 140 (129–149) |
| Planner, hazard-first rule off | 18% (12%–25%) | 22% (16%–29%) | 24% (18%–31%) | 28% (21%–35%) | 141 (129–151) |

Rule on minus rule off, for these people: +1 (−1 to +5) points by 30 min; +0 (−3 to +3) points by 60 min; +1 (−1 to +3) points by 120 min; −1 (−4 to +2) points by 180 min; −1 (−5 to +3) minutes to find.

Rule on minus rule off, for everyone: −0 (−1 to +1) points by 30 min; −1 (−2 to +0) points by 60 min; −1 (−2 to +1) points by 120 min; −0 (−2 to +1) points by 180 min; +1 (−1 to +3) minutes to find.

## By where the person ends up (planner and old app)

| Group | People | Planner, found by 180 min | Old app, found by 180 min | Planner, minutes | Old app, minutes |
|---|---|---|---|---|---|
| In or at a structure | 1399 | 15% (12%–18%) | 10% (7%–13%) | 160 | 166 |
| On a road | 1478 | 31% (26%–35%) | 29% (24%–34%) | 137 | 139 |
| Path or other linear feature | 331 | 32% (24%–43%) | 30% (21%–39%) | 136 | 136 |
| Field or open ground | 224 | 28% (18%–39%) | 25% (17%–36%) | 142 | 145 |
| Water or drainage | 408 | 27% (21%–34%) | 29% (23%–36%) | 140 | 139 |
| Woods or brush | 160 | 32% (21%–43%) | 31% (21%–41%) | 134 | 135 |
| Still walking when the search starts | 1984 | 6% (3%–9%) | 5% (2%–8%) | 172 | 173 |
| Already stopped | 2011 | 44% (39%–49%) | 39% (35%–45%) | 120 | 124 |
| Ends up off the map | 809 | 5% (2%–9%) | 4% (1%–6%) | 171 | 174 |

## What the searchers did

| Strategy | Tasks per search | Share of time travelling | Task types |
|---|---|---|---|
| On their own, with memory | 27 | 49% | area 100% |
| Ring sweep, cycling | 34 | 32% | area 100% |
| Greedy on the plain statistics map | 36 | 25% | area 100% |
| Old app: nextSectors + routeFor | 37 | 22% | area 100% |
| Planner | 29 | 14% | hasty 48%, yards 31%, containment 9%, hazard_check 6%, park 5% |
| Planner on the plain statistics map | 29 | 15% | hasty 54%, yards 36%, hazard_check 5%, containment 3%, park 2% |
| Planner, 25 m map split evenly | 29 | 14% | hasty 45%, yards 32%, containment 11%, hazard_check 6%, park 5% |
| Planner, hazard-first rule off | 32 | 14% | hasty 50%, yards 31%, containment 15%, park 5% |
| Planner, containment off | 28 | 14% | hasty 53%, yards 35%, hazard_check 7%, park 5% |
| Planner, no door-knocking | 29 | 14% | hasty 48%, containment 23%, yards 17%, hazard_check 7%, park 6% |

## Setup by setup: found by the end

| Setup | Since last seen | On their own, with memory | Ring sweep, cycling | Greedy on the plain statistics map | Old app: nextSectors + routeFor | Planner | Planner on the plain statistics map | Planner, 25 m map split evenly | Planner, hazard-first rule off | Planner, containment off | Planner, no door-knocking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (37.5405, -121.9795) | 60 min | 14% | 22% | 23% | 20% | 22% | 22% | 21% | 23% | 22% | 20% |
| 2 (37.553, -121.97) | 60 min | 22% | 21% | 24% | 21% | 26% | 30% | 25% | 24% | 26% | 21% |
| 3 (37.548, -121.985) | 60 min | 24% | 32% | 30% | 28% | 29% | 30% | 28% | 30% | 29% | 30% |
| 4 (37.56, -121.975) | 60 min | 31% | 38% | 35% | 30% | 33% | 34% | 33% | 35% | 32% | 35% |
| 5 (37.545, -121.96) | 60 min | 17% | 15% | 21% | 14% | 18% | 17% | 15% | 16% | 18% | 14% |
| 6 (37.556, -121.982) | 60 min | 21% | 22% | 29% | 27% | 30% | 31% | 29% | 27% | 31% | 26% |
| 7 (37.55, -121.976) | 60 min | 34% | 33% | 28% | 27% | 28% | 34% | 32% | 32% | 29% | 28% |
| 8 (37.544, -121.972) | 60 min | 36% | 39% | 36% | 32% | 32% | 35% | 29% | 36% | 32% | 34% |
| 9 (37.5405, -121.9795) | 120 min | 12% | 17% | 17% | 14% | 16% | 19% | 19% | 18% | 18% | 16% |
| 10 (37.553, -121.97) | 120 min | 22% | 24% | 25% | 23% | 24% | 26% | 25% | 26% | 24% | 24% |
| 11 (37.548, -121.985) | 120 min | 18% | 27% | 22% | 21% | 24% | 23% | 24% | 24% | 25% | 23% |
| 12 (37.56, -121.975) | 120 min | 14% | 20% | 21% | 21% | 23% | 22% | 23% | 21% | 23% | 20% |
| 13 (37.545, -121.96) | 120 min | 16% | 16% | 18% | 16% | 16% | 17% | 16% | 17% | 16% | 14% |
| 14 (37.556, -121.982) | 120 min | 14% | 17% | 20% | 18% | 24% | 24% | 22% | 24% | 23% | 20% |
| 15 (37.55, -121.976) | 120 min | 16% | 23% | 23% | 20% | 22% | 23% | 24% | 22% | 23% | 24% |
| 16 (37.544, -121.972) | 120 min | 13% | 24% | 27% | 24% | 28% | 28% | 29% | 28% | 28% | 27% |

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
