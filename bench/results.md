# FindThem benchmark results

Made by `node bench/benchmark.js` on 2026-11-22: 1000 simulated cases on the Fremont map (5 start points × direction known / unknown × 100 people each), 6 volunteers searching 200 m areas in 20-minute turns. ± is a 95% margin.

| Strategy | Found after 500 searcher-min | Found after 1,500 searcher-min | Found after 3,000 searcher-min |
|---|---|---|---|
| Volunteers searching on their own | 8% ±2 | 19% ±2 | 34% ±3 |
| Coordinated ring sweep | 18% ±2 | 28% ±3 | 35% ±3 |
| FindThem allocation | 20% ±2 | 40% ±3 | 54% ±3 |
| FindThem + one sighting | 69% ±3 | 86% ±2 | 92% ±2 |

**How to read it:** "searcher-minutes" is people × minutes. 1,500 searcher-minutes is about 6 volunteers for 4 hours.

**Why the ring sweep levels off:** it searches each area once, nearest first. One 20-minute search spots a person who is there only about 38% of the time, so a single pass misses most people. FindThem goes back to the likeliest areas because its map says they're still worth it.

**Limits:** the "true" missing people are simulated walkers, not real cases. Since the engine rewrite (Nov 22) they come from a different model than the app uses: the first engine's street-only walkers (bench/old-engine/), with two sets of settings. The "+ one sighting" row is optimistic, because the sighting is placed on the straight line toward the person's true end point. The ± margins treat the cases as independent, but they come from 10 setups. Real searches are messier: volunteers don't search perfectly, people move, and the detection numbers are estimates. This shows how much coordination and the probability map could help, not a promise.
