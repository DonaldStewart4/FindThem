# FindThem benchmark results

Made by `node bench/benchmark.js` on 2026-11-21: 1000 simulated cases on the Fremont map (5 start points × direction known / unknown × 100 people each), 6 volunteers searching 200 m areas in 20-minute turns. ± is a 95% margin.

| Strategy | Found after 500 searcher-min | Found after 1,500 searcher-min | Found after 3,000 searcher-min |
|---|---|---|---|
| Volunteers searching on their own | 8% ±2 | 21% ±3 | 34% ±3 |
| Coordinated ring sweep | 18% ±2 | 29% ±3 | 35% ±3 |
| FindThem allocation | 31% ±3 | 54% ±3 | 70% ±3 |
| FindThem + one sighting | 52% ±3 | 77% ±3 | 87% ±2 |

**How to read it:** "searcher-minutes" is people × minutes. 1,500 searcher-minutes is about 6 volunteers for 4 hours.

**Why the ring sweep levels off:** it searches each area once, nearest first. One 20-minute search spots a person who is there only about 38% of the time, so a single pass misses most people. FindThem goes back to the likeliest areas because its map says they're still worth it.

**Limits:** the "true" missing people come from our own walker model, run with different settings than the app assumes. Real searches are messier: volunteers don't search perfectly, people move, and the detection numbers are estimates. This shows how much coordination and the probability map could help, not a promise.
