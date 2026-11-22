# blind-2: scored once (Nov 22, 2026)

Nathan's 150 blind reports (`bench/blind-2.json`), written without seeing the readers. Scored ONCE, after all tuning, on commit `3bc7fdb`, with `node bench/eval.js --set blind-2 --reader local|proxy --final --by`. Nothing was tuned on it afterwards. This is the honest number for the pitch.

- **Street corners:** the set lists 2 corners with null coordinates. They were **filled with `findIntersections` on `tests/fixtures/demo-area.json`** (the way the phone computes them), not scored by name only.
- **"code-switch":** the set has no tag by that name. It is the union of its `spanglish`, `mixed-script` and `mixed` tags (15 cases).
- **Jev:** run through the local proxy (`wrangler dev`) with the pinned model `jev-1.14.0`; its saved answers reproduce every proxy draft (replay check).

## Backup reader (quickread.js)

```
blind-2 (150 cases), reader: local
| Field | Right | Empty | Wrong |
|---|---|---|---|
| kind | 121/150 (81%) | 0 | 29 |
| place | 74/111 (67%) | 36 | 1 |
| direction | 74/96 (77%) | 19 | 3 |
| minutes | 69/111 (62%) | 40 | 2 |
| reliability | 91/96 (95%) | 0 | 5 |
| **all** | **429/564 (76%)** | 95 | 40 |

Cases: 150. **Dangerous: 7** (high 7, medium 0, low 0)

Street corners with no coordinates, filled with findIntersections on tests/fixtures/demo-area.json:
  Paseo Padre Parkway & Stevenson Boulevard: 37.548967, -121.972170
  Paseo Padre Parkway & Walnut Avenue: 37.551897, -121.977855

| Language | Cases | Fields right | Empty | Wrong | Dangerous (high / medium / low) |
|---|---|---|---|---|---|
| en | 40 | 106/152 (70%) | 29 | 17 | **4** (4 / 0 / 0) |
| es | 30 | 94/116 (81%) | 17 | 5 | **0** (0 / 0 / 0) |
| zh | 28 | 85/106 (80%) | 16 | 5 | **0** (0 / 0 / 0) |
| ja | 27 | 75/97 (77%) | 18 | 4 | **0** (0 / 0 / 0) |
| fr | 25 | 69/93 (74%) | 15 | 9 | **3** (3 / 0 / 0) |

| Tag | Cases | Fields right | Empty | Wrong | Dangerous (high / medium / low) |
|---|---|---|---|---|---|
| voice | 73 | 218/285 (76%) | 49 | 18 | **4** (4 / 0 / 0) |
| secondhand | 18 | 73/90 (81%) | 13 | 4 | **2** (2 / 0 / 0) |
| searched | 16 | 28/50 (56%) | 14 | 8 | **1** (1 / 0 / 0) |
| code-switch | 15 | 50/71 (70%) | 17 | 4 | **0** (0 / 0 / 0) |
| certain | 14 | 50/70 (71%) | 14 | 6 | **0** (0 / 0 / 0) |
| water | 13 | 34/41 (83%) | 5 | 2 | **1** (1 / 0 / 0) |
| urgent | 12 | 33/56 (59%) | 16 | 7 | **0** (0 / 0 / 0) |
| maybe | 11 | 44/55 (80%) | 9 | 2 | **0** (0 / 0 / 0) |
| correction | 9 | 18/37 (49%) | 14 | 5 | **1** (1 / 0 / 0) |
| mixed-script | 9 | 30/41 (73%) | 9 | 2 | **0** (0 / 0 / 0) |
| intersection | 6 | 22/30 (73%) | 6 | 2 | **0** (0 / 0 / 0) |
| panic | 6 | 9/10 (90%) | 0 | 1 | **1** (1 / 0 / 0) |
| partial | 6 | 25/28 (89%) | 2 | 1 | **0** (0 / 0 / 0) |
| relative-direction | 6 | 19/30 (63%) | 6 | 5 | **0** (0 / 0 / 0) |
| two-in-one | 6 | 21/30 (70%) | 5 | 4 | **2** (2 / 0 / 0) |
| wrong-person | 6 | 6/6 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| car | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| clock | 5 | 25/25 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| clue | 5 | 22/25 (88%) | 3 | 0 | **0** (0 / 0 / 0) |
| far | 5 | 22/25 (88%) | 2 | 1 | **0** (0 / 0 / 0) |
| found | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| guess | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| joke | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| question | 5 | 4/5 (80%) | 0 | 1 | **1** (1 / 0 / 0) |
| spanglish | 5 | 18/25 (72%) | 6 | 1 | **0** (0 / 0 / 0) |
| phone | 3 | 9/15 (60%) | 3 | 3 | **0** (0 / 0 / 0) |
| noise | 2 | 2/2 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| vague | 2 | 10/10 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| mixed | 1 | 2/5 (40%) | 2 | 1 | **0** (0 / 0 / 0) |
| plan | 1 | 1/1 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| typo | 1 | 2/5 (40%) | 3 | 0 | **0** (0 / 0 / 0) |
```

## Jev (jev-1.14.0) through the safety layer

```
blind-2 (150 cases), reader: proxy, model jev-1.14.0
| Field | Right | Empty | Wrong |
|---|---|---|---|
| kind | 145/150 (97%) | 4 | 1 |
| place | 74/111 (67%) | 36 | 1 |
| direction | 84/96 (88%) | 11 | 1 |
| minutes | 86/111 (77%) | 25 | 0 |
| reliability | 90/96 (94%) | 1 | 5 |
| **all** | **479/564 (85%)** | 77 | 8 |

Cases: 150. **Dangerous: 3** (high 3, medium 0, low 0)

Street corners with no coordinates, filled with findIntersections on tests/fixtures/demo-area.json:
  Paseo Padre Parkway & Stevenson Boulevard: 37.548967, -121.972170
  Paseo Padre Parkway & Walnut Avenue: 37.551897, -121.977855

| Language | Cases | Fields right | Empty | Wrong | Dangerous (high / medium / low) |
|---|---|---|---|---|---|
| en | 40 | 132/152 (87%) | 16 | 4 | **2** (2 / 0 / 0) |
| es | 30 | 101/116 (87%) | 14 | 1 | **0** (0 / 0 / 0) |
| zh | 28 | 90/106 (85%) | 14 | 2 | **1** (1 / 0 / 0) |
| ja | 27 | 79/97 (81%) | 18 | 0 | **0** (0 / 0 / 0) |
| fr | 25 | 77/93 (83%) | 15 | 1 | **0** (0 / 0 / 0) |

| Tag | Cases | Fields right | Empty | Wrong | Dangerous (high / medium / low) |
|---|---|---|---|---|---|
| voice | 73 | 245/285 (86%) | 39 | 1 | **0** (0 / 0 / 0) |
| secondhand | 18 | 77/90 (86%) | 10 | 3 | **3** (3 / 0 / 0) |
| searched | 16 | 37/50 (74%) | 12 | 1 | **1** (1 / 0 / 0) |
| code-switch | 15 | 62/71 (87%) | 9 | 0 | **0** (0 / 0 / 0) |
| certain | 14 | 50/70 (71%) | 19 | 1 | **0** (0 / 0 / 0) |
| water | 13 | 35/41 (85%) | 6 | 0 | **0** (0 / 0 / 0) |
| urgent | 12 | 33/56 (59%) | 23 | 0 | **0** (0 / 0 / 0) |
| maybe | 11 | 47/55 (85%) | 7 | 1 | **0** (0 / 0 / 0) |
| correction | 9 | 28/37 (76%) | 9 | 0 | **0** (0 / 0 / 0) |
| mixed-script | 9 | 36/41 (88%) | 5 | 0 | **0** (0 / 0 / 0) |
| intersection | 6 | 28/30 (93%) | 1 | 1 | **0** (0 / 0 / 0) |
| panic | 6 | 10/10 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| partial | 6 | 25/28 (89%) | 3 | 0 | **0** (0 / 0 / 0) |
| relative-direction | 6 | 27/30 (90%) | 3 | 0 | **0** (0 / 0 / 0) |
| two-in-one | 6 | 22/30 (73%) | 5 | 3 | **3** (3 / 0 / 0) |
| wrong-person | 6 | 6/6 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| car | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| clock | 5 | 24/25 (96%) | 1 | 0 | **0** (0 / 0 / 0) |
| clue | 5 | 21/25 (84%) | 4 | 0 | **0** (0 / 0 / 0) |
| far | 5 | 24/25 (96%) | 1 | 0 | **0** (0 / 0 / 0) |
| found | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| guess | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| joke | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| question | 5 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| spanglish | 5 | 21/25 (84%) | 4 | 0 | **0** (0 / 0 / 0) |
| phone | 3 | 12/15 (80%) | 0 | 3 | **0** (0 / 0 / 0) |
| noise | 2 | 2/2 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| vague | 2 | 9/10 (90%) | 0 | 1 | **0** (0 / 0 / 0) |
| mixed | 1 | 5/5 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| plan | 1 | 1/1 (100%) | 0 | 0 | **0** (0 / 0 / 0) |
| typo | 1 | 4/5 (80%) | 1 | 0 | **0** (0 / 0 / 0) |
Replay check: saved answers reproduce every proxy draft.
```
