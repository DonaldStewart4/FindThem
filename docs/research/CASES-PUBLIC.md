# `cases-public.csv`: the public copy of the real-case data

161 resolved cases of people with dementia who left a home or care facility on foot and were later found, collected from public news, police and coroner reports. How they were collected, checked and geocoded, and their biases, are in `REPORT.md`; the fields are in `DATA_DICTIONARY.md`.

**This is the only case file in the repo, on purpose.** The research file cites each case by its source URL, and news URLs often spell out the missing person's name. This repo is public, so:

- The research file with URLs (`cases2.csv`, `cases.csv`, `cases.geojson`) is **git-ignored and must never be committed**.
- `cases-public.csv` is made from it by `node tools/make-public-cases.js`. It has the same rows and columns, except that `source_urls` is replaced by **`sources`**: `<publisher> <case month> [<source id>]`, for example `wfmj.com 2023-07 [S0042]`, several separated by ` | `.
- The source id → URL list is written to `sources-private.csv`, also git-ignored. Whoever holds the research file can look a citation up from its id.
- The tool refuses to write the public file if it finds anything in it that looks like a URL, a piece of a source URL, or a house number with a street.

What the public file still holds, all taken from published reports: the town, the month, the person's age in whole years if the source gave it, descriptions of the last-seen and found places with house numbers removed, and points rounded to 3 decimals (about 110 m). No names, no photos.

**How it is used.** Only as a held-out real-world check of the engine's prior: `bench/real-cases.js` (and, for the few cases located to street level, `bench/real-cases-maps.js`). It is never read by `tools/calibrate.js`. The results are in `bench/prior-report.md`, section "Real-world check".
