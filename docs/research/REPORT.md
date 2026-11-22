# Dementia on-foot missing-person cases: report

**Cases in dataset: 161** (resolved; dementia stated; left on foot from a home or care facility; both the last-seen place and the found place described in the source).

## Read this first

**Method.**
- Seven research agents (US by region, Canada, UK, Australia/NZ), plus two top-up agents, searched public news, police releases and coroner reports.
- Every source was fetched and read, and extraction came only from that text.
- Separate checker agents then re-read every source and checked each record field by field: dementia, on foot, resolved, both places, distance phrase, minutes, outcome, found_type and found_by.
- That re-check rejected 1 record (identity not confirmed), flagged others, and corrected 19. I rejected 1 more by hand because its found place came from an earlier episode.
- Geocoding uses OSM Nominatim (1 req/s). Matches are checked against the street name and town. Long roads, rivers and parks are downgraded to `neighborhood`, chain stores and same-named roads elsewhere are refused, and house numbers are never queried.

**Biases to keep in mind.**
- *Selection.* News covers long, dramatic or fatal searches. 42% of cases here are deceased, which is far higher than in SAR incident data.
- *Short finds are missing.* The biggest rejection reason, "no found location", is mostly quick "found safe nearby" finds with no place given. Short distances are under-represented, so these distances are biased **upward**.
- *Rounding.* Reported distances are rounded by journalists ("about a mile", "a quarter mile").
- *Not an urban sample.* Most cases are suburban or rural (`setting` is a judgment call), so ISRID's *urban* row is not a like-for-like benchmark. Compare against the per-setting rows.

**Which numbers to trust.**
- `strict = yes` plus `distance_basis` = `geocoded (exact|street)` is the most defensible subset, but it is small.
- `reported in source` distances are the article's own numbers. They are reliable to within the article's rounding.
- `geocoded (neighborhood; approx)` can be off by 1–2 km. Use it for coarse bins only.
- Rows with `location_confidence` = `not_geocoded` or `relative` still have accurate text descriptions. They need hand-placement before they can be used as points.
- `source_urls` often contain the person's name in the URL slug. They are kept because they are the citations. Strip them before sharing the file widely.

## Counts by country

| Country | n | % |
|---|---:|---:|
| US | 108 | 67% |
| UK | 25 | 16% |
| AU | 13 | 8% |
| CA | 10 | 6% |
| NZ | 5 | 3% |

## Counts by found_type

| found_type | n | % |
|---|---:|---:|
| woods | 39 | 24% |
| water | 30 | 19% |
| road | 22 | 14% |
| (blank) | 15 | 9% |
| structure | 14 | 9% |
| drainage | 11 | 7% |
| brush | 11 | 7% |
| linear | 10 | 6% |
| field | 9 | 6% |

## Outcome

| Outcome | n | % |
|---|---:|---:|
| deceased | 70 | 43% |
| alive uninjured | 49 | 30% |
| injured | 23 | 14% |
| alive (condition not reported) | 19 | 12% |

## Setting (researcher judgment)

| Setting | n | % |
|---|---:|---:|
| suburban | 73 | 45% |
| rural | 64 | 40% |
| urban | 24 | 15% |

## Departure type

| Departure | n | % |
|---|---:|---:|
| home | 101 | 63% |
| care_facility | 57 | 35% |
| hospital | 3 | 2% |

## Location confidence (worse of the two points)

| location_confidence | n | % |
|---|---:|---:|
| not_geocoded | 61 | 38% |
| relative | 43 | 27% |
| neighborhood | 36 | 22% |
| street | 16 | 10% |
| city | 3 | 2% |
| exact | 2 | 1% |

## QA

Strict subset (dementia stated, on foot stated or strongly implied, source re-read by an independent checker, no distance conflict, no water/animal displacement): **147** of 161.

| qa_flag (a case can have several) | n | % |
|---|---:|---:|
| found_place_relative_only | 63 | 39% |
| on_foot_implied | 60 | 37% |
| corrected_on_verification | 19 | 12% |
| on_foot_not_found | 7 | 4% |
| found_point_may_not_be_walk_endpoint | 5 | 3% |
| dementia_inferred_from_memory_care | 1 | 1% |
| on_foot_not_found_for_full_route | 1 | 1% |
| route_via_hospital_sighting_~12km | 1 | 1% |
| distance_conflict | 1 | 1% |

## Found by

| found_by | n | % |
|---|---:|---:|
| (blank) | 40 | 25% |
| police | 33 | 20% |
| public | 32 | 20% |
| SAR | 17 | 11% |
| dog | 15 | 9% |
| helicopter | 9 | 6% |
| family | 5 | 3% |
| staff | 5 | 3% |
| drone | 3 | 2% |
| self | 1 | 1% |
| fire | 1 | 1% |

## Straight-line distance (km) vs ISRID dementia, urban

| Subset | n | 25% | 50% | 75% | 95% |
|---|---:|---:|---:|---:|---:|
| **ISRID dementia (urban)** | – | 0.30 | 1.10 | 3.20 | 12.60 |
| High quality: both points exact/street | 14 | 0.66 | 1.60 | 5.03 | 13.28 |
| Good + neighborhood-level (approx ±1–2 km) | 44 | 0.61 | 2.31 | 5.20 | 11.40 |
| Reported-in-source only | 41 | 0.40 | 0.80 | 1.74 | 5.00 |
| All cases with any distance | 85 | 0.40 | 1.16 | 3.63 | 10.84 |
| Strict subset (strict = yes), any distance | 77 | 0.40 | 1.07 | 3.43 | 9.52 |
| Strict subset, both points exact/street | 12 | 0.60 | 1.33 | 3.99 | 11.63 |
| All with distance, setting = urban | 14 | 1.66 | 4.31 | 5.79 | 18.64 |
| All with distance, setting = suburban | 43 | 0.59 | 1.50 | 3.33 | 9.90 |
| All with distance, setting = rural | 28 | 0.39 | 0.55 | 2.00 | 7.07 |
| All with distance, country = US | 54 | 0.40 | 0.80 | 2.48 | 6.22 |
| All with distance, country = CA | 7 | 3.46 | 5.06 | 10.53 | 15.50 |
| All with distance, country = UK | 11 | 0.55 | 1.56 | 8.23 | 16.19 |
| All with distance, country = AU | 11 | 0.80 | 1.50 | 3.06 | 6.87 |
| All with distance, country = NZ | 2 | 0.69 | 1.12 | 1.56 | 1.91 |

Cases with no usable distance: 76.

Share of high-quality cases at or below each ISRID quantile (ISRID expects 25/50/75/95%): ≤0.3 km: 7%, ≤1.1 km: 43%, ≤3.2 km: 57%, ≤12.6 km: 93%

## Time missing (minutes)

n = 73; 25/50/75/95% = 480 / 1250 / 3345 / 13410

## Time of day last seen / season

| time_of_day | n | % |
|---|---:|---:|
| afternoon | 44 | 27% |
| morning | 34 | 21% |
| night | 33 | 20% |
| (blank) | 27 | 17% |
| evening | 23 | 14% |

| Season | n | % |
|---|---:|---:|
| autumn | 48 | 30% |
| summer | 44 | 27% |
| winter | 37 | 23% |
| spring | 28 | 17% |
| (blank) | 4 | 2% |

## Rejections

Candidates reviewed by researchers (self-reported): 1126.

| Reason | n |
|---|---:|
| no_found_location | 318 |
| not_on_foot | 160 |
| source_unreachable | 139 |
| no_dementia_stated | 126 |
| no_last_seen_location | 112 |
| other | 70 |
| not_resolved | 23 |
| duplicate | 14 |
| duplicate_across_slices | 1 |
| qa_not_resolved | 1 |
| qa_found_place_from_different_episode | 1 |

Unreachable sites: 10tv.com, 12news.com, 13newsnow.com, 917thewave.com.au, 9news.com, abc10.com, abc6.com, accesswdun.com, adultfostercare.apps.lara.state.mi.us, aol.com, banbridgeleader.co.uk, barnsleychronicle.com, baxtercountysheriff.com, beckershospitalreview.com, belpernews.co.uk, bocapost.com, ca.news.yahoo.com, castanetkamloops.net, cdapress.com, centralmaine.com, cheknews.ca, coastlive.com.au, colerainetimes.co.uk, coloradosun.com, concordmonitor.com, cottagelife.com (429), covnews.com (404), cp24.com, cpso.com, ctvnews.ca (pre-2024 article URLs: body not served), cumbriacrack.com, dailyherald.com, dailyvoice.com, daytondailynews.com, derbymrt.org.uk, doverpolice.org, drps.ca, durham.police.uk, eastidahonews.com, eastidahonews.com (partial, via WebFetch only), edhat.com, erienewsnow.com, expressandstar.com, firstcoastnews.com, fox21online.com, fox43.com, gephardtdaily.com, gvwire.com (via WebFetch only), halifaxcourier.co.uk, heart.co.uk, hebdenbridgetimes.co.uk, hmpgloballearningnetwork.com, hometownstations.com, huffpost.com, inkl.com, insurancenewsnet.com, irwinmitchell.com (404), itv.com, jgpr.net, journal-news.com, katc.com (404), kgw.com, kingstonpolice.ca, kixcountrysouthwest.com.au, ksdk.com, ktar.com, ktoo.org, ktvb.com, lismoreapp.com.au, local10.com (404), mahoningmatters.com, maine.gov/dps, mapleridgenews.com, michigan.gov, morriscountynj.gov, my.spokanecity.org, mycoastnow.com (429), mynewsla.com, mysouthborough.com, necn.com, newscentermaine.com, nhfishgame.com (intermittent 429), nhsp.dos.nh.gov, north.wales, northumberlandgazette.co.uk, nowtoronto.com, ottawapolice.ca, patch.com, pocklingtonpost.co.uk, portsmouth.co.uk, prd.ctvnews.ca, pressandjournal.co.uk, rcmp-grc.gc.ca (old news URLs redirect to rcmp.ca home), redlakenationnews.com, reviewjournal.com, rochvalleyradio.com, rpmrt.org.uk, sasktoday.ca, scotsman.com, sheriff-okaloosa.org, shropshirestar.com, spokesman.com, squamishchief.com, staradvertiser.com, startribune.com, sunjournal.com, thecourier.co.uk, theday.com, thelincolnite.co.uk, thenewdaily.com.au, theprogress.com, thestar.co.uk, timescolonist.com, timesofsandiego.com, tps.ca, vasheriff.org, washingtontimes.com, wbbjtv.com, wdrb.com, wearesouthdevon.com, web.archive.org, westernjournal.com, wfmj.com, wfmynews2.com, willinghamparishcouncil.gov.uk, wispolitics.com, wqad.com, wrtv.com, wtol.com, wtsp.com, yorkshirepost.co.uk

