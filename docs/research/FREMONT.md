# Fremont demo site: research notes

**Demo point:** Central Park / Lake Elizabeth, Fremont CA, at **37.553, -121.970**.
Heads-up: that point is on **Stevenson Blvd at the park's north edge**, about 400 m north-west of the lake's water, not on the lake itself. All distances below are measured from that point.

Status: final (2026-11-22): all four sections done. Supporting files: hazards.geojson, hazards.csv, cases.csv, contacts.csv, OUTREACH.md. The _cases.md and _sar.md source notes are merged below.

## Key takeaways for the demo

- **Search radius.** In Koester's ISRID data on urban dementia subjects (n=336), 25% are found within 0.3 km of where they were last seen, 50% within 1.1 km, 75% within 3.2 km and 95% within 12.6 km. A 3 km hazard ring therefore covers roughly the 75th percentile. Source: https://www.dbs-sar.com/LPB/Dementia.pdf (checked against the PDF).
- **Where they're found in cities.** On roads 36%, in structures 35%, along linear features 9%, in water 6% and in drainages 4%. Only 1% respond to shouts. Of those found within 24 hours, 95% are alive. That falls to 77% after 24 hours (same source).
- **Closest hazards to the demo point.** Stevenson Blvd borders the park (16 m), BART S-Line tracks run 182 m away, Lake Elizabeth is 399 m, Tyson Lagoon 638 m, the ACFCD Zone 5 Lines B, C and D are 0.7–1.9 km, Mission and Laguna creeks 1.1–1.3 km, the Fremont BART station 0.77 km, and the UP rail line 1.07 km. Hills start about 1.8 km to the NE/E. There are **no freeways within 3 km**.
- **Local real case.** In Nov 2017 a 72-year-old Fremont woman with dementia was found about 18–21 hours after she went missing. She was sitting on a curb at **Fremont Blvd & Stevenson Blvd**, about 1.4 km south of the demo point (intersection at 37.5407, -121.9731 in OSM) and about 5 miles from home. A member of the public spotted her after a social-media alert. Fremont PD's grid search and bloodhound had not found her (Section 2, case 1, which I re-checked against the Nixle post).
- **Who does the searching.** Inside Fremont, the Fremont PD leads the search. Under Cal OES SAR mutual-aid rules, it "may and should" call the Alameda County Sheriff's SAR once a search outgrows it (Section 3.1). A Silver Alert requires that local resources be used first, so it is not a first-hour tool (Section 3.6).

---

## 1. Hazards within 3 km

Files: `hazards.geojson` (187 features: 185 clipped to a 3 km circle plus 2 nearest-freeway points) and `hazards.csv` (one row per feature, with the nearest point to the center as lat/lng).

**How it was made (so you know what to trust)**
- **Geometry:** OpenStreetMap, downloaded 2026-11-22 straight from api.openstreetmap.org (16 bbox tiles, 303k nodes and 36.5k ways parsed). © OpenStreetMap contributors, ODbL. OSM is crowd-sourced, so the shapes are good but not authoritative.
- **Flood-control channel IDs:** OSM ways carry `ref="Zone 5, Line B/C/D"` tags, which cite the Alameda County Flood Control *Mowry Slough watershed* map (https://acfloodcontrol.org/files/watersheds/maps/pdfs/mowry_slough.pdf). I did not cross-check that PDF line by line.
- **Steep terrain:** USGS 3DEP/NED 10 m elevation, sampled on a **200 m grid** (861 points) via api.opentopodata.org (`ned10m`). Slope uses a central difference over 400 m. It's coarse, so use it for screening only.
- **Distances** are straight-line from the center to the nearest point of each feature (local planar projection, accurate to a few metres at this scale).
- The **overpass-api.de** and **Nominatim** geocoders were blocked or refused from this environment, so no coordinates were geocoded from text. Every coordinate comes from OSM geometry or the USGS grid.

### Summary by category (distance = nearest approach to center)

| Category | Features | Nearest | Key items |
|---|---|---|---|
| Arterials | 16 | 16 m | **Stevenson Blvd** (borders the park, 16 m), Civic Center Dr (165 m), **Paseo Padre Pkwy** (472 m), Walnut Ave (519 m), Mowry Ave (1.09 km), Fremont Blvd (1.29 km), Mission Blvd / CA-238 (1.42 km), Peralta Blvd / CA-84 (1.43 km), Grimmer, Washington, Niles Blvd, Osgood, Blacow |
| BART tracks | 6 | **182 m** | S-Line (Fremont → Warm Springs/Berryessa) at grade 182 m, in a covered/trench section from 239 m, elevated 511 m; A-Line (north toward Union City) at grade 650 m |
| Transit stations | 2 | 712 m | **Fremont BART station** (769 m) and its bus hub (712 m). A subject who boards a train can end up far away. Fremont–Centerville Amtrak/ACE is about 3.4 km west, just outside the radius |
| Water bodies | 21 | **399 m** | **Lake Elizabeth** (≈0.32 km², 399 m), **Tyson Lagoon** (638 m), several unnamed ponds and basins 0.6–2.6 km away, Kaiser Pond (2.06 km), the Alameda Creek channel and ponds (2.1–2.4 km), Shinn Pond (2.47 km), Lago Los Osos / Quarry Lakes (2.52 km) |
| Flood-control channels | 10 | 703 m | **ACFCD Zone 5 Line D** (culverted 703 m, open 1.87 km), **Line C** (culverted 788 m, open 1.38 km), **Line B** (culverted 803 m, open 1.32 km, 3.4 km of open channel inside the radius), Irvington Creek (open 1.48 km), Babbling Brook ditch (1.0 km) |
| Creeks | 12 | 1.05 km | Unnamed stream (1.05 km), **Mission Creek** (open 1.14 km), **Laguna Creek** (open 1.27 km), **Alameda Creek** (2.13 km, large flood-control river channel), Morrison Creek (2.33 km), Leal Creek, Washington Creek |
| Culvert openings | 89 | — | Derived points where an open channel meets a culverted reach. Includes small road culverts, so filter by distance |
| Rail lines (UP / Amtrak / ACE / Niles Canyon Rwy) | 12 | 1.07 km | **UP Warm Springs Subdivision** (1.07 km), UP Niles Subdivision (1.81 km), UP Oakland Subdivision (2.02 km), connectors and spurs, Niles Canyon Railway (heritage, 2.56 km) |
| At-grade rail crossings | 15 | — | OSM `railway=level_crossing` / `crossing` nodes |
| Freeways | 0 in radius | 3.47 km | **None within 3 km**: I-680 3.47 km SSE, I-880 3.70 km SSW (see note) |
| Steep terrain | 2 | 1.84 km | ≥15% slope: 2.2 km² starting 1.84 km out; ≥30% slope: 0.87 km² from 1.99 km. These are the Niles / Mission hills east and north-east of Mission Blvd |

### Notes on specific brief items
- **I-880 and I-680 are outside 3 km.** No part of either falls inside the circle. The downloaded box reaches about 3.05 km out, so every freeway is at least 3.0 km away. The nearest points found are **I-680 at 3.47 km SSE** (37.5295, -121.9441) and **I-880 at 3.70 km SSW** (37.5243, -121.9911). Both are in the GeoJSON as `freeway_outside_radius` points.
- **Mission Peak is about 8 km east**, well outside 3 km. Within 3 km, the "steep terrain toward Mission Peak" is the foothill band east of Mission Blvd (Niles / Mission San Jose hills). The steepest sampled cells (≥45–58% slope) sit around 37.57–37.58, -121.95 to -121.97, north-east of the center.
- **Laguna Creek and Mission Creek** both appear in OSM as named streams with open and culverted reaches. In this data the nearest open reaches are 1.1–1.3 km from the center.
- **Lake Elizabeth's shoreline** is the closest water (399 m). BART runs along the park's west side about 180 m from the center, so these are the two most immediate non-road hazards.

---

## 2. Past Bay Area missing-dementia cases (no names)

> **Public copy.** The links to the news articles and police alerts behind each case have been removed from this file, because those pages name the people. Only the publisher is kept. The team keeps the full source list privately (it is never committed: see `CLAUDE.md`, "Real-case data and privacy").

Compiled 2026-11-22 from public web sources only. These include police Nixle posts, CBS SF / KPIX, KTVU, NBC Bay Area, ABC7, KRON (via Yahoo), Patch (mostly Bay City News copy), the SF Chronicle, El Estoque and the Morgan Hill Times. I opened every source URL listed here myself (HTTP 200) and took the details from the page text.

**Ground rules followed**
- **No names.** Each person is described only by age, sex and condition.
- **Nothing is inferred.** Anything a source doesn't say is marked "not stated".
- **Distances** are given only where the source states them. None are computed from map points.
- **Durations** are simple arithmetic on the times the source reports, marked "~". "Unresolved in the sources found" means I couldn't find a follow-up. It does **not** mean the person was never found.

**Main table:** 25 cases where the source explicitly states dementia, Alzheimer's or equivalent cognitive impairment. Outcomes: 20 found alive, 3 found deceased, 2 unresolved in the sources found.

**Fremont / Tri-City share:** 9 of the 25 main cases involve Fremont, Newark or Union City.
- Cases 1-6 and 8 were last seen in Fremont, Newark or Union City.
- Case 7 was found at the Newark/Fremont border.
- Case 9 was found in Fremont.
- The additional table adds 15 more cases (A1-A15), including 7 Tri-City at-risk-senior cases where dementia is *not* stated.

**Observations from this case set (descriptive only, small sample):**
- **Who found them alive.** In cases where the source names the finder, it is most often an ordinary member of the public who recognized the person from an alert or noticed something was wrong: cases 1, 9, 12, 17, 23 and 24, plus A6 and A13. Case 1 explicitly credits a social-media alert. Police patrols found them in cases 14 and A8.
- **Deaths.** All 3 deaths in the main table (cases 7, 10 and 22) happened at or near the bay-edge, marsh or highway fringe: Hayward Regional Shoreline, the Alviso Marina marsh, and the SR-84 off-ramp at Ardenwood.
- **Crossing city lines.** Many were found in a different city from where they were last seen: Hayward→Fremont, Newark→NYC, Milpitas→San Jose (3 times), Cupertino→San Jose (about 10 mi), Santa Clara→Sunnyvale and Daly City→Newark. Transit and cars both show up: SamTrans/BART, a Lyft drop-off, and several drivers.

### Cases (main table)

| # | Date | City | Last seen | Mode | Duration | Found where | Outcome | Found by | Source |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Nov 2017 | Fremont | 72-year-old woman, early-stage dementia. Left her home on Sterne Place (Northgate area) between 1-4 p.m. Saturday; known to walk around Northgate (Darwin / Fremont Blvd / Ranch 99 Market). | Not stated (she habitually walks the Northgate area) | ~18-21 h (left 1-4 p.m. Sat; found ~10 a.m. Sun) | Sitting on a curb near Fremont Blvd & Stevenson Blvd, approx. 5 mi from home (FPD Nixle) | Found safe ("very cold but otherwise okay") | Member of the public, who saw the alert on social media. Before that, FPD ran an overnight grid search of streets, parks and open businesses north of Decoto Rd, used a bloodhound, and placed a 1 a.m. Code Red call to landlines within 1 mi. | nixle.com nixle.com ktvu.com nbcbayarea.com |
| 2 | Aug 2019 | Fremont | 77-year-old man with dementia. Left a care home in the Parkside Dr area at about 11 p.m. on 8/16/2019. | Wheelchair | Not stated ("located" alert dated Aug 17, 2019) | Not stated | Found safe | Not stated | nixle.us |
| 3 | Apr 2020 | Fremont | 69-year-old man with dementia and other conditions. Walked away from a care home on Seneca Park Loop at 10 a.m. Friday. No cell phone. Familiar with public transit; police thought he might head to Alameda, where he used to live. | On foot (walked away); familiar with public transit | ~1 day (10 a.m. Fri; located by the 2:15 p.m. Sat update) | Not stated | Found (police "located" him; condition not stated) | Fremont PD (finder not specified) | ktvu.com |
| 4 | Jan 2012 | Newark | 81-year-old man with Alzheimer's. Did not return to his residential care home on Jan. 10 after missing his ride home from a doctor's appointment in East Oakland. | Not stated (ended up in New York; how he got there not stated) | ~1 week | A Manhattan (NYC) hospital, ~3,000 mi away | Found alive (condition not stated) | Hospital staff, who called Newark PD; NYPD verified his identity | cbsnews.com |
| 5 | Jul 2016 | Newark | 72-year-old man with dementia. Did not return to his care home from a 10:30 a.m. morning walk; last seen about 11:30 a.m. at a place he normally visits (place not named). | On foot (walk) | Not stated | Not stated | Unresolved in the sources found (no follow-up located) | n/a | patch.com |
| 6 | Dec 2016 | Newark | 88-year-old man. Family said he was unfamiliar with his surroundings and "may not know his own name". Disappeared near Cedar Blvd & Breton Dr. | Not stated | Same day (reported Friday, found Friday) | In Newark (exact place not stated) | Found safe, reunited with family | Not stated | patch.com |
| 7 | Nov-Dec 2018 | Daly City (last seen) / found at the Newark-Fremont border | 82-year-old man with dementia from Daly City. Last seen the previous Thursday heading north on a SamTrans bus. Known to use BART and Muni. | Transit (SamTrans bus; also used BART and Muni) | ~5 days (last seen Thursday; body found Tuesday night) | Right shoulder of the SR-84 off-ramp to Ardenwood Blvd, on the Newark/Fremont border | Found deceased (circumstances not stated) | Not stated (paramedic pronounced him dead; CHP gave the location) | patch.com patch.com |
| 8 | Aug 2024 | Union City | 95-year-old woman with Alzheimer's. Reported missing Aug. 16, 2024 from her home (300 block of Appian Way). A neighbor last saw her several weeks earlier, being taken away by ambulance. | Ambulance transport (last sighting) | Reported Aug 16; located Aug 18 (last seen several weeks earlier) | Not stated | Found ("located"; condition not stated) | Not stated (Union City PD) | nixle.us ktvu.com |
| 9 | Aug 2015 | Hayward (found in Fremont) | 62-year-old man with dementia, described as very fit and an avid walker. Last seen at 1:15 p.m. in the 30600 block of Brae Burn Ave. | Not stated (avid walker) | ~5 h (1:15 p.m. to about 6:30 p.m.) | In Fremont (exact place not stated) | Found unharmed, returned home | Member of the public ("a citizen in Fremont") | nixle.com patch.com |
| 10 | Mar 2012 | Hayward | 85-year-old man with Alzheimer's. Walked away from the Arcadian Residential Community (24647 Mohr Dr) at about 5 p.m. Monday. Had walked away once before and was found within an hour. Had family in Union City. | On foot (walked away) | ~6 days (Monday walk-away; body found the following Sunday night) | On a trail at Hayward Regional Shoreline, about 1/4 mi south of W. Winton Ave | Found deceased (foul play not suspected) | Member of the public (a hiker) | cbsnews.com nbcbayarea.com cbsnews.com |
| 11 | Nov 2015 | Hayward | 66-year-old woman with dementia and depression. Walked away from her care facility at about 4:30 p.m. CHP Silver Alert issued. | On foot (walked away) | <~1 day (left 4:30 p.m. Nov 2; found by Nov 3) | Near South Hayward BART station | Found safe | Not stated | nixle.com abc7news.com |
| 12 | Apr 2016 | Hayward | 78-year-old man with Alzheimer's. Last seen at 5 p.m. Wednesday leaving a restaurant in the 100 block of Harder Rd (near Harder & Soto Rds). | Not stated | ~3 days (Wed evening to Sat) | Blossom Way & Meekland Ave, about 3 mi from where he was last seen | Found safe (taken to hospital as a precaution) | Member of the public (a citizen spotted him and called police) | nixle.com patch.com sfchronicle.com |
| 13 | Aug 2016 | Hayward area (Alameda County Sheriff's Office case) | 82-year-old man with Alzheimer's. Last seen at his home on Langton Way at about 10:30 a.m. Sunday. | Vehicle (white 2002 Ford Windstar minivan) | Not stated | Not stated | Found ("reunited with his family") | Not stated | patch.com |
| 14 | Jul 2018 | Hayward | 84-year-old man with dementia. Last seen Thursday morning, possibly heading to Costco on Hesperian Blvd. | Not stated | ~1 day (Thu morning to Fri morning) | Not stated | Found safe | Police (Hayward patrol officers) | patch.com |
| 15 | Jul 2018 | Hayward (Mt. Eden) | 84-year-old man with dementia. Last seen in the Mt. Eden neighborhood. | Not stated | Not stated | Not stated | Unresolved in the sources found (no follow-up located) | n/a | nixle.com patch.com |
| 16 | Jan 2020 | Hayward | 88-year-old woman who "possibly has dementia" (per her daughter). Last seen Jan. 25 at about 11 a.m. near Sentinel Court; reported missing Jan. 26 at 8 p.m. Silver Alert issued. | Possibly vehicle (the alert lists her 2010 Toyota Camry) | ~1.5-2 days (located by the Jan 27 update) | Not stated | Found safe ("safe and sound") | Not stated | nixle.us |
| 17 | Aug 2020 | Hayward | 78-year-old woman with Alzheimer's, high blood pressure and diabetes; speaks only Mandarin. Last seen at 3:30 a.m. Aug. 27 in the 2600 block of Oliver Dr; reported at 2:37 p.m. Silver Alert issued. | Not stated | Same day (<1 day) | Not stated | Found ("located") | Member of the public ("one of our wonderful community members") | nixle.us |
| 18 | Aug 2023 | Hayward | 76-year-old man with dementia and Parkinson's, wearing a medical alert bracelet. Left his care home (500 block of Beechmont Ln) at about 2 p.m. | On foot (left the home) | < 1 day (located late the same night) | Not stated | Found safe, returned home | Not stated | nixle.us |
| 19 | Nov 2017 | Milpitas (found in San Jose) | 66-year-old man with Alzheimer's, wearing house slippers. Last seen at 11 a.m. Sunday at his home (1400 block of E. Calaveras Blvd). | Not stated | ~45 h ("missing for two nights": 11 a.m. Sun to ~8 a.m. Tue) | Near N. 2nd St & E. Hedding St, San Jose | Found (condition not reported) | Not stated | patch.com patch.com |
| 20 | Apr 2018 | Milpitas (found in San Jose) | 81-year-old man with dementia. Walked away from his home on Seacliff Dr at about 2:45 p.m. Tuesday. Seen at about 11 p.m. by staff at Outback Steakhouse, 1245 Great Mall Dr, but officers could not find him. | On foot (walked away) | ~30 h (2:45 p.m. Apr 24 to the evening of Apr 25) | In San Jose (exact place not stated) | Found safe ("safe and sound") | Not stated | nixle.us |
| 21 | Oct 2020 | Milpitas (found in San Jose) | 77-year-old man with early-onset dementia; speaks mainly Tagalog; no ID or phone. Left his home on Wilson Way (Pioneer Mobile Home Park) at 2:30 p.m. Wednesday for a walk; headed north on N. Milpitas Blvd near the Fremont city line. Joint Milpitas PD / CHP Silver Alert. | On foot (walk) | > 24 h (2:30 p.m. Wed to just before 5 p.m. Thu) | In San Jose (exact place not stated) | Found, reunited with family (condition not stated) | Not stated. Milpitas detectives drove him home; SJPD, Fremont PD and Santa Clara County Sheriff SAR assisted. | patch.com |
| 22 | May 2012 | San Jose (Alviso) | 69-year-old man with dementia, reported missing at 11:20 p.m. Monday. Police found his cellphone at 2:40 a.m. Tuesday in Alviso Marina County Park. | Not stated | ~17 h after the report (found ~4:30 p.m. Tue) | Marshy area near the Alviso Marina | Found deceased (no indication of foul play) | Search effort: SJPD with search-and-rescue units and a tracking dog (the actual finder is not specified) | cbsnews.com abc7news.com |
| 23 | Oct 2013 | Cupertino (found in San Jose) | 70-year-old man in the first stages of dementia; no phone or cash; carrying a long walking stick. Left his home (18000 block of Loree Ave) at 11 a.m. Sunday for a walk while his wife was in the shower. | On foot (walk) | ~1 day+ (11 a.m. Sun to Mon afternoon), out overnight in the cold | Off Monterey Rd near Tully Rd, San Jose, about 10 mi from home; shoeless and trying to get into a residence | Found in good condition (hospital as a precaution) | Members of the public (residents who called police, thinking it was a burglary) and SJPD. Earlier search: Sheriff SAR with tracking dogs (unsuccessful) and an SJPD helicopter. | patch.com nbcbayarea.com |
| 24 | May 2013 | Cupertino | 63-year-old man with dementia, mute, walks with a shuffle; wearing slippers. Last seen at 11 a.m. (El Estoque gives the area as Santa Teresa Dr & Rucker Dr). | On foot | ~20.5 h (11 a.m. May 30 to 7:30 a.m. May 31) | Behind the fence by the track at Kennedy Middle School (821 Bubb Rd), near his home | Found uninjured (exposed to the elements all night; taken to hospital) | Member of the public (a passer-by). Sheriff SAR teams and a sheriff's helicopter had been deployed. | abc7news.com elestoque.org |
| 25 | Oct 2020 | Santa Clara (found in Sunnyvale) | 88-year-old man with Alzheimer's. Last seen shortly before 5 p.m. Tuesday, driving away from his Santa Clara home. CHP Silver Alert issued. | Vehicle (drove away) | ~19 h (just before 5 p.m. Tue to 12:15 p.m. Wed) | In Sunnyvale (exact place not stated) | Found safe | Not stated | cbsnews.com |

#### Additional cases (lower confidence, or outside the top 25)

Rows A1-A7 are at-risk seniors in Fremont, Newark and Union City where **the source does not say they had dementia**. They are listed because the places are close to the demo site. A1, for example, sometimes walked at Central Park. **Do not describe A1-A7 as dementia cases in the demo.** Rows A8-A15 are further dementia or Alzheimer's cases.

| # | Date | City | Last seen | Mode | Duration | Found where | Outcome | Found by | Source |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Dec 2018 | Fremont | 69-year-old man, at-risk with "medical and mental health conditions" (DEMENTIA NOT STATED). Left a care facility on Presidio Way at Mowry Ave at 6:30 a.m. Police said he sometimes walks at Central Park and is not known to go to other parts of town. | On foot | Not stated | Not stated | Unresolved in the sources found | n/a | nixle.us ktvu.com |
| A2 | Dec 2021 | Fremont | 74-year-old woman, at-risk (DEMENTIA NOT STATED). A Lyft driver dropped her off near Mowry Ave & Civic Center Dr at 9:15 a.m.; she was last seen walking east on Mowry toward Mission Blvd. | Rideshare drop-off, then on foot | ~12 h | Not stated | Found safe, returned home | Not stated | ktvu.com |
| A3 | Dec 2020 | Fremont | 88-year-old hospital patient, at-risk; needed medical care and could only communicate with pen and paper (DEMENTIA NOT STATED). Walked out of Kaiser Permanente Fremont Medical Center (Paseo Padre Pkwy) at 4:13 a.m. | On foot (walked out) | ~7 h (4:13 a.m. to just after 11 a.m.) | In Fremont (exact place not stated) | Found safe | Not stated | cbsnews.com |
| A4 | Mar 2017 | Fremont (found in Newark) | 83-year-old man, "at risk" (DEMENTIA NOT STATED). Last seen at about 9 p.m. Sunday on Old Canyon Rd. | Not stated | Not stated (by the next day) | In Newark (exact place not stated) | Found safe | Not stated | patch.com |
| A5 | May 2019 | Fremont | 68-year-old woman, at-risk (DEMENTIA NOT STATED). Last seen at 7 a.m. Thursday in the Ardenwood area. A strong walker who often walks to Newark and Union City. | On foot (strong walker) | ~34 h (7 a.m. Thu to after 5 p.m. Fri) | Not stated ("returned home safely") | Found safe | Not stated | patch.com |
| A6 | May 2017 | Newark (found in Fremont) | 89-year-old woman who speaks only Spanish (DEMENTIA NOT STATED). Walked away from home at about 6:30, wearing pajamas and a sweater. | On foot (walked away) | ~4 h | In Fremont (exact place not stated) | Found, taken to hospital as a precaution | Member of the public (an alert citizen). Fremont PD sent a tracking-certified K-9; Newark PD RAVENS volunteers responded. | patch.com |
| A7 | Sep 2014 | Union City | 84-year-old man (DEMENTIA NOT STATED; family called him "quite self sufficient"). Left his townhome near Partridge Way & Skylark Dr between 10 and 11 a.m. Thursday; no phone or wallet. CHP Silver Alert issued. | On foot (per CHP) | Not stated | Not stated | Unresolved in the sources found | n/a | patch.com abc7news.com |
| A8 | Oct 2013 | Hayward | Elderly man (age not in the text retrieved) with dementia and behavioral disturbances. Left the Colonial Acres Care Home (18905 Standish Ave); last seen at 11:30 p.m.; missed at bed check. Not familiar with Hayward or the AC Transit system. | Not stated | ~15+ h (11:30 p.m. Mon to Tue afternoon) | Near B Street | Found; returned to the care home without needing treatment | Police (Hayward PD) | nbcbayarea.com |
| A9 | Dec 2017 | Hayward | 71-year-old Castro Valley man with dementia and Alzheimer's (traumatic brain injury); unfamiliar with the area. Last seen at about 2 p.m. near Burbank St & MLK Dr. Silver Alert issued. | Not stated | Not stated | Not stated | Found in good health | Not stated | nixle.us |
| A10 | Jan 2015 | Hayward | 82-year-old man with dementia and a history of getting disoriented and lost. Last seen at 7:45 a.m. Saturday at the Fairfield Inn & Suites, 25921 Industrial Blvd. | Possibly vehicle (white 2003 Chevrolet pickup with camper shell) | Not stated | Not stated | Unresolved in the sources found | n/a | patch.com |
| A11 | Oct 2021 | Hayward | 77-year-old man with dementia, a communication deficit and seizures; uses a walker. Last seen at 7 p.m. Oct. 19 near 553 Smalley Ave. | On foot with a walker | Not stated | Not stated | Unresolved in the sources found | n/a | nixle.us |
| A12 | Sep 2023 | Hayward | 83-year-old man with Alzheimer's, wearing navy-blue slippers. Last seen at about 6 p.m. Sept. 17, 2023 at his home near the 28000 block of Chambers St. | Not stated | Not stated | Not stated | Unresolved in the sources found | n/a | nixle.us |
| A13 | Jan 2019 | Alameda (city) | 73-year-old woman with dementia. Last seen in the early morning at Crown Bay Nursing & Rehabilitation Center, 508 Westline Dr. | Not stated | A few hours (located by 9:14 a.m.) | Not stated; returned to the facility | Found safe | Member of the public (a citizen found her and cared for her until officers arrived) | patch.com |
| A14 | Aug 2012 | Unincorporated Santa Clara County (Morgan Hill area; found in San Jose) | 79-year-old man with Alzheimer's; had not driven in years; no money, ID or phone. Left his home (19600 block of Dougherty Ave) at 8:45 a.m. Friday in his 1994 GMC truck. | Vehicle (pickup truck) | ~1-2 days (Friday to "over the weekend") | At a San Jose 7-Eleven, where he tripped and fell (NBC); near Valley Medical Center (Morgan Hill Times) | Found (NBC: "good condition"; Sheriff: "no injuries") | Not stated: EMS personnel and the ER identified him and called his family | nbcbayarea.com morganhilltimes.com |
| A15 | Jul 2014 | San Jose | 81-year-old man with Alzheimer's. Last seen leaving his home (2100 block of Stratton Pl) at about 11 a.m. Wednesday. | Not stated | ~1.3 days (Wed 11 a.m. to Thu evening) | In San Jose (exact place not stated) | Found safe, reunited with family | Not stated | cbsnews.com |

### Aggregate stats

**Prevalence of wandering**
- **Alzheimer's Association:** "Six in 10 people living with dementia will wander at least once; many do so repeatedly." It also says wandering "can happen at any stage of the disease." Source: alz.org
- **NPR (2009):** "Estimates suggest about 50 percent of dementia patients who wander will suffer serious injury or death if they are not found within 24 hours." Source: npr.org

**Koester & Stooksbury (1995)**, "Behavioral profile of possible Alzheimer's disease patients in Virginia search and rescue incidents," *Wilderness and Environmental Medicine* 6:34-43. Source: dbs-sar.com
- **Distance travelled:** Dementia (DAT) subjects averaged a 0.88 km straight-line distance from the Point Last Seen. Cognitively normal elderly averaged 2.56 km. The median was 0.8 km (0.5 mi) for both groups. For DAT subjects the mean was 0.9 km (0.6 mi) and the range 0-2.4 km (0-1.5 mi).
- **Mortality:** 19% for DAT subjects. No deaths among those located within 24 hours. 46% mortality among those who took more than 24 hours to locate.
- **Where they were found:** The majority were in drainages/creeks or heavy brush/briars. 42 of 295 Virginia state incidents (15%) involved possible DAT subjects.

**Koester, "The Lost Alzheimer's and Related Disorders Search Subject"** (dbS Productions review). Source: dbs-sar.com
- **Within one mile:** In a follow-up study, 89% of DAT subjects were found within one mile of the point last seen. (Note: the paper itself prints "one mile (1.2 km)".)
- **Find locations:** On the road itself 14%, in a creek/drainage 28%, and/or caught in briars/bushes 33%.
- **Deaths and survival:** 9 of 42 (21%) were found deceased, from hypothermia, dehydration or drowning. All subjects found within 24 h survived; only 54% of those needing more than 24 h survived.
- **Crossing roads:** Subjects crossed roads in 67% of cases until they got stuck in brush (25%) or a drainage (38%), citing another study.
- **Western US:** SAR team leaders in the western US report that critical wanderers go farther than the 0.5 mi Virginia median.

**Koester, *Lost Person Behavior* (2008), "Dementia (Alzheimer's)" chapter, ISRID data (n = 1,051 dementia subjects).** Source: dbs-sar.com

Horizontal distance from the IPP (initial planning point), in miles. Each column shows the distance within which 25/50/75/95% of subjects were found.

| Terrain | n | 25% | 50% | 75% | 95% |
|---|---|---|---|---|---|
| **Urban** | 336 | 0.2 | 0.7 | 2.0 | 7.8 |
| Temperate flat | 175 | 0.2 | 0.6 | 1.5 | 7.9 |
| Temperate mountain | 95 | 0.2 | 0.5 | 1.2 | 5.1 |

In km, the urban column is 0.3 / 1.1 / 3.2 / 12.6.

- **Urban find locations** (n = 223): road 36%, structure 35%, linear feature 9%, water 6%, field 6%, drainage 4%, woods 3%, brush 1%.
- **Urban survivability:** 80% uninjured, 14% injured, 6% fatality, 5% no trace.
- **Share found alive, by time missing:**

| Time missing | Found alive | n |
|---|---|---|
| < 24 h | 95% | 736 |
| > 24 h | 77% | 79 |
| > 48 h | 60% | 30 |
| > 72 h | 60% | 20 |
| > 96 h | 46% | 13 |

- **Fatality rate after 24 h:** The chapter text separately says "There is a 25% fatality rate if the subject is not found within the first 24 hours."
- **Behavior:**
  - "They go until they get 'stuck.'"
  - Direction of travel is a good predictor of where they end up.
  - 66% cross or leave a road.
  - Only 1% respond to shouts.
  - In temperate domains, half are mobile for less than about an hour (median mobility 0.25 h).
  - Median track offset is 15 m.
  - They are attracted to water features.
  - In urban settings they are typically found in structures or walking along roads.
  - The initial-tasking list says to check taxis, mass transit, hospitals, EMS, jails and shelters, and to issue a "Silver" alert.

**California Silver Alert (CHP)**
- **Volume:** "The Silver Alert system went online in California and there have been nearly 1,400 alerts issued for missing, at-risk adults since January 2013." This is a CHP release reprinted by SCVNews, Nov. 29, 2018. Source: scvnews.com
- **Criteria:** As reported from the CHP website in a 2025 KTLA/Yahoo article: "The missing person is 65 years of age or older, developmentally disabled or cognitively impaired." Source: yahoo.com
- **No annual statistics found.** I could not find CHP Silver Alert counts by year or recovery rates (see below).
- **Example rescue:** The CHP "Success Stories" page describes a June 28, 2022 Silver Alert (San Bernardino) where a citizen in a neighboring city recognized the person from the Wireless Emergency Alert on their phone. Source: chp.ca.gov

**Project Lifesaver (radio-tracking wristbands)**
- **Founder's claims (*Police Magazine*, 2015):**
  - Recovery times average 30 minutes, "95% less time than standard operations."
  - Over 2,965 rescues.
  - "Among at-risk people who wander and are found within 12 hours, 93% will survive. Of those... lost for more than 24 hours, only a third will survive... more than 72 hours, only 20% survive."
  - These are the program's own figures. Source: policemag.com
- **BrightFocus Foundation (2021):** Project Lifesaver located 274 people with Alzheimer's or other dementia from June 2015 to October 2018. Find times ranged from 3 minutes to over 5 hours. Source: brightfocus.org
- **Project Lifesaver:** Its searches "typically involve only one to three... electronic search specialists and less than 30 minutes." Source: projectlifesaver.org

### Searched but not found / unreachable

**Pages I could not open**
- **CHP Silver Alert page** (https://www.chp.ca.gov/News-Alerts/Silver-Alert and chp.ca.gov): HTTP 403 by both curl and the fetch tool. I could not read the CHP's own criteria page or any statistics on it.
- **California Government Code §8594.10** (the Silver Alert statute) on leginfo.legislature.ca.gov and law.justia.com: HTTP 403 / Cloudflare challenge.
- **UPI 2009 story** on a Campbell man with dementia found alive in a dry creek bed after 10 days (upi.com): HTTP 403. The details appeared only in a search snippet, so the case is **not** in the table.

**Searches that found nothing usable**
- **CHP Silver Alert annual statistics** (activations, recoveries, outcomes): nothing found. The CHP "AMBER Alert statistics" page appears in search results but has no Silver Alert figures in the snippet. The search result said CHP media relations, (916) 843-3210, handles statistics requests.
- **Tri-City Voice:** no indexed missing-dementia stories surfaced in search.
- **Fremont PD's own news page:** not found in search. Fremont cases came via Nixle and TV/Patch.
- **Mercury News / East Bay Times:** not searched directly (paywalled). Their Bay City News copy appears on Patch and CBS SF.
- **Lake Elizabeth / Central Park:** no dementia case found at Lake Elizabeth or Central Park. The nearest are A1 (a man who "sometimes takes walks at Central Park", dementia not stated, outcome not found) and A2 (last seen on Mowry Ave near Civic Center Dr).
- **No 2025-2026 Fremont dementia cases found.**
  - A Feb 2025 KRON/Yahoo item about an 87-year-old at-risk Fremont man was excluded. Dementia is not stated, and his last contact was about a month before he was reported. Source: yahoo.com
  - An Oct 2025 San Jose Silver Alert (77-year-old man, driving, found the same day) was excluded because no condition is stated. Source: ktvu.com
- **Alameda County Sheriff SAR / Santa Clara County Sheriff SAR incident logs** for dementia searches: none found online. Their involvement appears only in news copy (cases 21, 23, 24). Marin SAR mission logs mention Alameda SAR helping elsewhere, but not on dementia cases.
- **Project Lifesaver:** no data or cases found for Alameda County or Santa Clara County.

**Follow-ups not found** (outcome unresolved in sources): cases 5 and 15, and A1, A7, A10, A11 and A12.

**Excluded after reading**
- **Cunningham Lake, San Jose, Oct 2012:** a 77-year-old man found dead. Dementia not stated. Source: cbsnews.com
- **Fremont, May 2016:** a 60-year-old man, not elderly; at-risk because of medication. Source: patch.com
- **Hayward, Nov 2016:** a 61-year-old with a confusion-causing condition, not elderly.
- **Fremont, 2012:** an 85-year-old man found safe. Condition not stated. Source: nbcbayarea.com
- **Contra Costa:** a man with Alzheimer's who drove from Diablo and was found by the CHP on US-101 in Morgan Hill. No date on the page. Source: abc7news.com

**Data caveat**
- **Case 20:** the Milpitas Nixle post is dated April 25, 2018 in its header, but its body says the walk-away was "Tuesday, April 24, 2017". I used 2018, the header date, and April 24 was a Tuesday in 2018.
- **Case 10:** NBC printed the man's name in reversed order compared with CBS. CBS's March 16, 2012 report on the body found at the Shoreline names the same 85-year-old Hayward resident with Alzheimer's and says he "had been previously reported missing". That links it to CBS's March 8 walk-away report.


---

## 3. How SAR teams handle dementia searches

Research notes for the Fremont demo. Compiled 2026-11-22 from public web sources only. Every claim cites a URL that was actually opened (fetched or downloaded and read). Anything taken only from search-result snippets is either left out or marked as such.

**Legend**
- **[AGENCY]**: a published protocol, policy, statute or official page from a government agency or a sheriff's SAR unit.
- **[LIT]**: general guidance or research literature (Koester / dbS Productions, Alzheimer's Association, IACP concepts paper, universities, nonprofits).
- **[NEWS]**: a news report or police alert about a real case. Names of missing people are left out on purpose.

---

### 3.1 Alameda County SAR

#### Who they are
- **[AGENCY]** The Alameda County Sheriff's Office Search and Rescue Unit ("ALCO SAR") is a volunteer unit. Its stated task is to "provide a professional level of search management, leadership, and cooperation" to "locate, stabilize and transport lost or injured persons within the County of Alameda". It is "available to assist other Counties within California through the Law Enforcement Mutual Aid System". The site's only public instruction is "IN CASE OF EMERGENCY DIAL 9-1-1". https://sites.google.com/a/alcosarinc.org/home
- **[AGENCY]** History: the unit began as a 1950s Civil Defense rescue unit. In the 1980s it became a full-service SAR organization and "took over Alameda County lost-person searches". It now has "one of the largest single-agency canine divisions in the state". https://sites.google.com/a/alcosarinc.org/home/about-us/history
- **[AGENCY]** K9 Division: its disciplines are Area (general air scent), Trailing (scent-specific tracking), Land and Water Human Remains detection, and Disaster. It "responds to over 20 searches every year", including searches for "missing hikers, hunters, children, **cognitively impaired people** and the despondent". The listed contact is the Deputy SAR Coordinator at (925) 803-7800. https://sites.google.com/a/alcosarinc.org/home/k9-division
- **[AGENCY]** The county's public-protection page puts the Sheriff's Office of Homeland Security and Emergency Services (24-hour response capability) over the volunteer units: "Air Squadron, Communications Team, Mounted Posse, Search and Rescue, and Underwater Recovery". https://acgov.org/publicsafety/publicprotection.htm
- **[NEWS]** A 2017 UC Berkeley *California* magazine profile describes the "all-volunteer Alameda County Sheriff's Office Search and Rescue Unit", with about two years of training. On arrival, "whoever the agency is, a police department or whatever, will brief us with a description of the missing person". Volunteers also do urban searches (including encampments) and note that "in some Alzheimer's cases they're going backwards in their minds". https://alumni.berkeley.edu/california-magazine/online/stranded-meet-band-bay-area-volunteers-here-save-you/

#### How it is activated (who calls them)
- **[AGENCY] Statewide rule.** "Search and Rescue in California is the responsibility of each County's Sheriff's Office" (exception: certain National Parks). Cal OES supports sheriffs "through Mutual Aid and our State SAR Resource Teams". https://www.caloes.ca.gov/cal-oes-divisions/law-enforcement/volunteering
- **[AGENCY] Cal OES Law Enforcement Mutual Aid SAR Annex ("Green Book", 2021 ed.)**: https://www.caloes.ca.gov/wp-content/uploads/Law-Enforcement/Documents/Green-Book_LEMA-Search-and-Rescue-Annex.pdf
  - Everywhere except San Francisco, "the Sheriff, as Chief Law Enforcement Officer for the county, retains the responsibility for the search and rescue (SAR) of lost individuals". This "does not relieve municipal governments … of the responsibility to conduct initial SAR investigative actions or actual field operations" (pp. 20–21).
  - **Incorporated cities (this is the Fremont case):** "SAR operations conducted within incorporated areas of the state are usually the responsibility of the chiefs of police where such departments exist." "When the magnitude of a SAR incident exceeds the capabilities of the local police department, that department may and should request SAR assistance from the County Sheriff, the Operational Area Law Enforcement Coordinator" (p. 22).
  - When another county helps, "the overall responsibility for the management of resources and the conduct of the search is retained by the requesting jurisdiction". SAR mutual-aid requests normally go straight to the Cal OES Law Enforcement Branch, because "Search is an Emergency in life threatening circumstances" (pp. 22–23).
  - Gov. Code §26614 lets the Board of Supervisors authorize the Sheriff "to search for and rescue persons who are lost or are in danger of their lives". §26615 requires the Sheriff to keep a directory of trained SAR dogs (reproduced in the Annex).
- **[AGENCY] Example of a call-out chain (Santa Cruz County Sheriff SAR patrol briefing, 2024)**, a neighbouring county's written version of the same model. A city PD or State Parks "manage their response until mutual aid request". Patrol sergeants contact the SAR sergeant. Activation criteria are: authorization; a reasonable search area; "LKP is established. Lat/Lon"; "Lost Person Questionnaire is filled out (patrol deputy)"; no firearms or hostile subject. https://scsheriff.com/Portals/1/County/sheriff/formsdocs/SAR%20Basics%20for%20Patrol%20Outline.pdf

#### Who searches inside Fremont
- **No source found states specifically that Fremont PD calls ACSO SAR for dementia searches.** Under the Cal OES Annex above, Fremont PD (an incorporated city's police) runs the initial search and "may and should" request the Sheriff when the search outgrows it.
- **[NEWS / police alert]** In a Fremont PD case involving an at-risk 72-year-old woman, officers searched around the home. They ran a grid search of "city streets, parks, and open businesses north of Decoto Rd", used a Fremont PD bloodhound, and placed a Code Red call to landlines within a 1-mile radius at about 1 a.m. She left home between 1 and 4 p.m. and was found at about 10 a.m. the next day (roughly 18–21 hours later), "very cold but otherwise okay", sitting on a curb near Fremont Blvd and Stevenson Blvd, **about 5 miles from home**, after a community member saw the social-media alert. The alert does not mention Sheriff SAR. nixle.com (also nbcbayarea.com)
- **[NEWS]** In parkland, the agency with jurisdiction makes the request. In a May 2024 Del Valle (Sunol–Livermore) search, East Bay Regional Park Police "requested assistance from Alameda County Fire department, East Bay Regional Park Fire department, Alameda county search and rescue". About 100 searchers used drones, helicopters and 8 ATVs. ABC7 report, May 2024 (URL withheld because it contains the hiker's name; on abc7news.com search "missing East Bay hiker rescuers find")
- **[NEWS]** An at-risk 85-year-old (age plus a health condition), reported by Oakland PD, was found after about 5 days in a canyon in Lake Chabot Regional Park. Ground SAR teams found him, a CHP helicopter hoisted him out, and an Alameda County Sheriff's spokesperson said the department helped locate him. KTVU report (URL withheld because it contains the person's name; on ktvu.com search "found in Oakland park days after going missing")
- **[AGENCY] Reporting rules that apply to Fremont PD (CA POST guidelines, rev. Sept 2024)**:
  - Reports must be accepted "regardless of jurisdiction" (PC §14211(a)) and take priority over property crimes. The "24 hours" wait is called "a common myth".
  - A BOLO must go out "without delay" if the person is at risk (PC §14211(d)). "At risk" includes "mentally impaired, including cognitively impaired" (PC §14215(b)).
  - At-risk cases must be entered in the state Missing Persons System within 2 hours (PC §14211(e)).
  - People with dementia or Alzheimer's are "Dependent Adult" (MPS code "D") or "Wandering adult" cases.
  - https://post.ca.gov/portals/0/post_docs/publications/Missing_Persons_Guidelines2024_NEW3.pdf

---

### 3.2 Other Bay Area SAR

| Team | What the published source says | Dementia-specific? | Source |
|---|---|---|---|
| **Santa Clara County Sheriff SAR (SCCSSAR)** [AGENCY] | On call "24 hours a day, 365 days a year". Members are paged by text or email, and "the first call out will come shortly after sunset" after someone fails to return home. Serves "the Sheriff's Office and other local law enforcement agencies within the county", and goes out of county by mutual aid. Averages "about 25 searches a year". Specialty teams: ATV, canine, technical rescue, tracking, parabolic microphone, UAS (drone), e-bike. | Yes. The FAQ lists "Alzheimer and dementia patients" among search types, as well as urban searches. | https://sites.google.com/sccssar.org/sccssar/resources/faq ; https://sites.google.com/sccssar.org/sccssar/home |
| **San Mateo County Sheriff SAR** [AGENCY] | "100% volunteer unit" in the Sheriff's Office with 60+ members and 16,000+ volunteer hours a year. Activation process not described. | Not on the home page. | https://sites.google.com/a/sanmateosar.org/test/home |
| **San Mateo search, May 2025 (79-year-old with dementia, Windy Hill)** [NEWS] | Shows a real multi-county dementia search. Sheriff's Air Support, a tracking/trailing K-9, drones, SMC SAR and BAMRU took part, plus **mutual aid from Alameda**, Contra Costa, Marin, Napa, Santa Clara, Santa Cruz, San Joaquin and Sonoma SAR teams (150+ volunteers). State OES thermal-imaging aircraft flew, and **CHP issued a Silver Alert** about 24 hours in. The public was asked to review doorbell and camera footage from the time last seen and to **check sheds and outbuildings**. | Yes | paloaltoonline.com |
| **BAMRU (Bay Area Mountain Rescue Unit)** [AGENCY-affiliated] | "All-volunteer wilderness search and rescue (SAR) unit". "Operates under the oversight of the San Mateo County's Sheriff's Office" (Homeland Security Division). Responds statewide through mutual aid and is MRA-accredited. | No | https://bamru.org/about |
| **Marin County Sheriff SAR** [AGENCY] | "Marin County Search and Rescue is a division of the Marin County Sheriff's Office". The Sheriff page is a history (first mutual-aid search 1988; 18 missions in 1989). | No | https://marinsar.org/ ; https://marinsheriff.gov/about-us/field-service-bureau/search-rescue |
| **Contra Costa County Sheriff SAR** | Official page returned HTTP 403 (see Unreachable). | n/a | https://www.cocosheriff.org/bureaus/support-services/search-and-rescue |
| **Santa Cruz County Sheriff SAR** (not Bay Area proper, but the best published patrol-to-SAR protocol found) [AGENCY] | About 50 members, available 24/7/365. Policy 315 (Missing Persons: "No wait period. BOLO, NCIC, CLETS"), Policy 316 (Public Alerts: Silver Alert, reverse 911), Policy 426 (SAR). 12-hour operational periods. Full Lost Person Questionnaire attached. | Partly. The questionnaire is generic, plus a children's section. | https://scsheriff.com/Portals/1/County/sheriff/formsdocs/SAR%20Basics%20for%20Patrol%20Outline.pdf |
| **Cal OES (state mutual aid)** [AGENCY] | The Law Enforcement Branch coordinates SAR mutual aid statewide and is the state SAR coordinator. 24-hour line: 916-845-8911. Resources "will always be requested through a Sheriff's department or State agency". | No | https://www.caloes.ca.gov/wp-content/uploads/Law-Enforcement/Documents/Green-Book_LEMA-Search-and-Rescue-Annex.pdf |

**"What to do if a loved one is missing" pages:** none of the Bay Area SAR team sites found has one. Each says only "dial 9-1-1". The family-facing guidance comes from the Alzheimer's Association (Section 4) and from police reporting rules (CA POST, above).

---

### 3.3 Dementia lost-person behavior

#### 3.3a Koester, *Lost Person Behavior* (dbS Productions, 2008): Dementia profile, ISRID data [LIT]
Source: the book's Dementia chapter, pp. 161–169, posted by the publisher: https://www.dbs-sar.com/LPB/Dementia.pdf (n = 1,051 dementia cases).

**Distance from the IPP (Initial Planning Point = PLS/LKP), straight line.** Bay Area cities fall under the "Urban" column. Nearby hills and parks are "Temperate".

| Percentile of subjects found within | Temperate Mtn (n=95) | Temperate Flat (n=175) | Dry Mtn (n=14) | Dry Flat (n=15) | **Urban (n=336)** |
|---|---|---|---|---|---|
| 25% | 0.2 mi (0.3 km) | 0.2 mi (0.3 km) | 0.6 mi (1.0 km) | 0.3 mi (0.5 km) | **0.2 mi (0.3 km)** |
| 50% | 0.5 mi (0.8 km) | 0.6 mi (1.0 km) | 1.2 mi (1.9 km) | 1.0 mi (1.6 km) | **0.7 mi (1.1 km)** |
| 75% | 1.2 mi (1.9 km) | 1.5 mi (2.4 km) | 1.9 mi (3.1 km) | 2.2 mi (3.6 km) | **2.0 mi (3.2 km)** |
| 95% | 5.1 mi (8.3 km) | 7.9 mi (12.8 km) | 3.8 mi (6.1 km) | 7.3 mi (11.8 km) | **7.8 mi (12.6 km)** |

**Where found (Find Location %)**

| Location | Temperate (n=207) | Dry (n=7) | **Urban (n=223)** |
|---|---|---|---|
| Structure | 20% | 29% | **35%** |
| Road | 18% | 14% | **36%** |
| Linear feature | 9% | – | 9% |
| Drainage | 9% | 14% | 4% |
| Water | 7% | 14% | 6% |
| Brush | 6% | – | 1% |
| Woods | 17% | – | 3% |
| Field | 14% | 29% | 6% |

**Other published numbers (same source)**

| Metric | Value |
|---|---|
| Survival, found in under 24 h | 95% alive (n=736) |
| Survival, found after more than 24 h | 77% alive (n=79) |
| Survival, found after more than 48 h | 60% (n=30) |
| Survival, found after more than 72 h | 60% (n=20) |
| Survival, found after more than 96 h | 46% (n=13) |
| Outcome, wilderness | 73% uninjured, 17% injured, 8% fatality, 2% no trace |
| Outcome, urban | 80% uninjured, 14% injured, 6% fatality, 5% no trace |
| Fatality if not found within 24 h | "25% fatality rate" |
| Mobility (temperate, n=42) | median 0.25 h; 75th pct 3.8 h; 95th pct 18 h ("half of the subjects are mobile for less than an hour") |
| Track offset (distance from a path or road where found, n=110) | 25% 4 m; 50% 15 m; 75% 71 m; 95% 307 m ("the shortest of all subject categories") |
| Dispersion angle (temperate, n=11) | median 23°; 75% 66°; 95% 70° |
| Elevation (temperate) | 19% uphill, 42% downhill, 39% same |
| Crosses or departs from a road | 66% |
| Responds to shouts | "only 1% are responsive" |
| Scenario | 96% lost, 2% investigative, 1% overdue |

**Hallmark behaviors (quoted or paraphrased from the same source)**
- "They go until they get 'stuck'". They "appear to lack the ability to turn around and may ping-pong off some barriers".
- Tunnel vision means they essentially move straight ahead. "Direction of travel is a good predictor of where they are found. Look for sign and attempt to determine exit door."
- "Oriented to the past". They may try to reach a **former residence, a workplace or a favorite place**.
- Mild to moderate dementia: goal-directed, may go farther, more likely to use public transport. Severe: random wandering over shorter distances.
- Urban: "typically found in structures or walking along roads". If they leave the road "he does not travel far". Wilderness: "stuck in brush/briars or drainages". They are "attracted to water features and will walk into water".
- "They will not cry out for help or respond to shouts". They "will not leave many verifiable clues". Some are effectively "passive-evasive".
- On finding them: approach from the front, make eye contact, speak slowly and simply, do not argue, redirect.

#### 3.3b Earlier dbS / Koester research (Virginia data) [LIT]
- Koester & Stooksbury, 1995, *Wilderness & Environmental Medicine* (Virginia, 1986–1992): 42 of 295 incidents (15%) involved possible dementia subjects. Mean distance from the PLS was 0.9 km and median 0.8 km. **89% were found within 1 mile (1.2 km)**. 28% were found in drainages or creeks and 33% caught in briars or brush. There were no fatalities among those found within 24 hours. https://www.dbs-sar.com/SAR_Research/WEM_article.htm
- Koester, "The Lost Alzheimer's and Related Disorders Search Subject": critical wanderers "cross over roads (67% of the cases) until they get stuck in brush (25%) or in a drainage (38%)". "In none of these searches did the critical wanderer call out for help." A Massachusetts Safe Return study found 72% are repeat wanderers. https://www.dbs-sar.com/SAR_Research/ALZ.pdf

#### 3.3c Other published guidance [LIT]
- **IACP Policy Center, "Missing Persons with Alzheimer's Disease" (2011):**
  - Of those found alive, "about 60 percent were found within the first six hours … and about 30 percent within six to twelve hours".
  - About 75% leave on foot. "Most of those found deceased are found within 1.5 miles of the place last seen, and more than 50 percent are found within one-half mile", in thick brush, water, ravines or sewer drains, or abandoned lots and buildings.
  - If they left by car, "only about 40 percent are found in the county of residence".
  - "About 20 percent of those found are rescued during nighttime hours", so searching should continue at night.
  - Up to 70% of people with dementia wander at some point. They "likely will not respond to anyone calling for them".
  - https://theiacp.org/sites/default/files/all/a/AlzheimersPaper.pdf
- **Alzheimer's Association:** "Six in 10 people living with dementia will wander at least once". "Many individuals who wander are found within 1.5 miles of where they disappeared". Wandering "often follows the direction of the dominant hand". https://www.alz.org/help-support/caregiving/safety/wandering
- **University of Waterloo (Canada) SAR tip sheet:** suggested initial search area of 3.2 km (urban) or 2.4 km (rural). Check "creeks, ponds, lakes, pools, gardens, hedges, and ditches". https://uwaterloo.ca/managing-risks-of-disappearance-in-persons-living-with-dementia/sites/default/files/uploads/documents/introduction-to-search-and-rescue-tip-sheet.pdf

---

### 3.4 First-hour tasks

The ordered list below combines published tasks. Each item is cited, and the source type is marked.

1. **Family starts searching right away. Call 911 if the person isn't found within 15 minutes, and say they have dementia.** [LIT] https://www.alz.org/help-support/caregiving/safety/wandering
2. **Police accept the report at once, with no waiting period, and give it priority over property crime. If the person is at risk, broadcast a BOLO "without delay".** [AGENCY] CA POST Guideline 2.1/2.2, https://post.ca.gov/portals/0/post_docs/publications/Missing_Persons_Guidelines2024_NEW3.pdf
3. **Dispatch gathers basics from the caller and checks agency records**: past wandering and where the person was found before; fear of uniforms or crowds; access to car, money or transit; favorite places; weapons. Then a **city- or countywide radio alert to all units and neighboring agencies**, and immediate contact with any tracking or ID program. [LIT] IACP, https://theiacp.org/sites/default/files/all/a/AlzheimersPaper.pdf
4. **Thoroughly search the home and premises first, and never assume a caregiver's search was thorough.** Check under beds, locked rooms, closets, crawl spaces, attic, **cars**, false ceilings, AC vents, under sinks and **exterior shrubs**. Then search **neighbors' yards**. [LIT] IACP (same URL). The CA POST equivalent says "thoroughly search the immediate and surrounding area in a logical and systematic manner", including where the person "may be hiding, or may become trapped". [AGENCY] POST (same URL). Koester's version: "Highly systematic grounds and structure search. Repeat search of grounds and structure." [LIT] https://www.dbs-sar.com/LPB/Dementia.pdf
5. **Establish and preserve the PLS/LKP and the exit door.** Treat the PLS like a crime scene (tape, photos, footprints). Find which door the person used, because it "often provides valuable clues to the missing person's path". [LIT] IACP. Koester: "Preserve IPP", "Determine the door the subject most likely exited from and attempt to determine a direction of travel". [LIT] Dementia.pdf. Santa Cruz SAR: record the LKP as lat/lon, use a single entry and exit path, and "don't walk around the vehicle". [AGENCY] https://scsheriff.com/Portals/1/County/sheriff/formsdocs/SAR%20Basics%20for%20Patrol%20Outline.pdf
6. **Secure a scent article for dogs before it is contaminated.** Use clean tongs or a glove to pick up something only the missing person used (pillowcase, hat, sock), and put it in a bag. Not laundry-hamper items. [AGENCY] Santa Cruz SAR (URL above); CA POST Guideline 2.2(H).
7. **Start the Lost Person / Missing Person Questionnaire.** Hand it to SAR immediately, or photograph it. [AGENCY] Santa Cruz SAR; POST requires the CA DOJ Standard Missing Person Reporting Form (PC §13519.07). Koester: "Start MPQ/LPQ … Previous wandering. Potential destinations. Severity of dementia." [LIT] Dementia.pdf
8. **Hasty search of travel corridors**: roads, trails, drainages and routes leading away from the IPP. Look for decision points and cut for sign at turn-offs. Send dogs into drainages and search parallel to roads. [LIT] Koester "Initial Reflex Tasking", Dementia.pdf
9. **Containment**: use the statistical maximum zone. In urban areas use road, bike and air patrols, and contain gated-development entrances. [LIT] Dementia.pdf. Patrol containment along "roads or familiar places", "often coupled with attractants like lights and siren followed by quiet listening". Keep a deputy at the residence as a likely return point. [AGENCY] Santa Cruz SAR
10. **Search the immediate area (the 25% zone) thoroughly** with sweep or area dogs. Canvass the neighborhood and notify the community (media, flyers, door-to-door, phone system). [LIT] Dementia.pdf. Real example: Fremont PD placed a Code Red call within a 1-mile radius. [NEWS] nixle.com
11. **Check high-probability places**: previous homes, earlier lost locations, historical finds, high-hazard areas; "ensure heavy brush is searched". [LIT] Dementia.pdf. Also ponds, tree lines, fence lines, brush or brier, and places the person wandered to before. [LIT] alz.org
12. **Investigative checks**: taxis and mass transit (all shifts), hospitals, EMS, jails, shelters. Alert municipal workers, issue a Silver alert. [LIT] Dementia.pdf. IACP adds: notify government and contract workers with radios (parks, road crews, waste management). If the person left by car, find out **how much gas was in the tank** to set a driving radius, and notify adjacent jurisdictions. [LIT] IACP
13. **Gather camera footage**: record camera locations and viewsheds in the area and ask owners for clips from the right time frame. [AGENCY] Santa Cruz SAR. San Mateo 2025: the public was asked for doorbell video and to check sheds. [NEWS] paloaltoonline.com
14. **Escalate**: if a thorough search of home and immediate area fails, start a formal search under ICS and request a Silver Alert. Tell the public **not to approach** the person but to observe and call. [LIT] IACP. Contact CHP about a Silver Alert and consider mutual aid. [AGENCY] POST
15. **Expanding plan** (IACP suggested timeline): start with the first half-mile and grow by about a mile an hour. Rework 1.5 mi, then 5 mi, then 10 mi. At 5 mi, split teams between the outer ring and a re-search of the first 1.5 mi. Keep searching at night. [LIT] IACP

---

### 3.5 What searchers ask families

Each item lists the form or source that asks it.

**Sources:**
- **SC** = Santa Cruz County Sheriff SAR Lost Person Questionnaire [AGENCY]: https://scsheriff.com/Portals/1/County/sheriff/formsdocs/SAR%20Basics%20for%20Patrol%20Outline.pdf
- **VT** = Vermont DPS Lost Person Questionnaire, 11/2019 [AGENCY]: https://dps.vermont.gov/sites/psd/files/documents/lost_person.pdf
- **IACP** = IACP concepts paper [LIT]: https://theiacp.org/sites/default/files/all/a/AlzheimersPaper.pdf
- **LPB** = Koester dementia "Additional Investigative Questions" [LIT]: https://www.dbs-sar.com/LPB/Dementia.pdf
- **POST** = CA POST guidelines [AGENCY]: https://post.ca.gov/portals/0/post_docs/publications/Missing_Persons_Guidelines2024_NEW3.pdf
- **ALZ** = Alzheimer's Association [LIT]: https://www.alz.org/help-support/caregiving/safety/wandering

**Identity and description**
- [ ] Name, nicknames or "answers to", age or DOB, sex, race, height, weight, hair, eyes, build, complexion, marks, scars, tattoos (SC, VT)
- [ ] Glasses or contacts, and how well they see without them (SC, VT)
- [ ] **Recent photo**: how old is it and how does the person look now? Is there recent video? (LPB, POST, ALZ). POST also asks for a smiling, teeth-showing photo (POST).

**Clothing and gear**
- [ ] Shirt, pants, jacket, rain gear, hat, gloves: style and color (SC, VT)
- [ ] **Shoe type, color, size, sole pattern**. Is a sample available for tracking? (SC, VT)
- [ ] Is the clothing right for the weather? (IACP)
- [ ] Money, credit or debit cards (SC, VT, IACP)
- [ ] ID jewelry or labels, MedicAlert/Safe Return or another registry (LPB)

**Last seen**
- [ ] Place, time and date last seen; who saw them; direction of travel; comments on leaving (SC, VT)
- [ ] **Which door or exit** they used (IACP, LPB)
- [ ] On foot or by car? If by car: year, make, model, plate, location, **how much gas** (SC, VT, IACP)
- [ ] Emotional state when last seen compared with their usual baseline (LPB)
- [ ] What has the family already searched? (SC "actions so far", IACP)
- [ ] Weather at the time last seen (VT)

**Medical**
- [ ] Exact diagnosis; neurologist or doctor contact; last MMSE score; mild, moderate or severe (LPB)
- [ ] Other medical conditions, allergies, fitness, ability to walk, gait or shuffle (VT, LPB, IACP)
- [ ] **Medications**: what and how often, the effect of missing a dose, how much they carry, time of the last dose (SC, VT, IACP)
- [ ] Delusions, paranoia, hallucinations, depression, history of violence (LPB)

**Dementia-specific behavior**
- [ ] Do they know their own name? Will they **answer to their name being called**? Can they hold a conversation, and how long before a stranger would notice something is wrong? (LPB)
- [ ] Do they remember their home address or phone number? (IACP)
- [ ] Would they recognize or fear police or uniforms? Are they afraid of noises, crowds, dogs, traffic, water or the dark? How do they react to strangers? (IACP, LPB)
- [ ] **Previous wandering**: for each episode, where were they last seen, what were they doing, what triggered it, where were they found, how far "as the crow flies", and how were they found? (LPB, SC "ever been lost before")
- [ ] Is the wandering goal-directed or random? Do they exit-seek? Wander at night or by day? (LPB)
- [ ] Usual daily walking distance, number of walks in the past week, longest walk in the last 3 months and 10 years, the farthest you think they could walk (LPB)
- [ ] Do they still drive? Can they find keys and start the car? Do they use public transit independently? (LPB, IACP)
- [ ] Dominant hand, right or left (ALZ)

**Places and the past** (people with dementia are "oriented to the past")
- [ ] **Every address since childhood**, including places that no longer exist (LPB)
- [ ] Former workplaces, church, favorite places or restaurants (LPB, IACP, ALZ)
- [ ] Do they talk about a person or place, someone who has died, or an out-of-town visit? (LPB)
- [ ] Have they recently moved, and how did they adjust? (LPB)
- [ ] Daily routine and habits: did they happen on the day they went missing? (LPB, IACP)
- [ ] Hobbies and interests; landmarks or objects that draw them (LPB, IACP, SC)
- [ ] Military, scouting or outdoor background (LPB, SC)
- [ ] Neighbors they know well (IACP)

**Contacts and technology**
- [ ] Reporting party, next of kin, others with information, and who to call when the person is found (SC, VT)
- [ ] **Cell phone number and carrier**; tracking devices (AirTag, Strava and similar) (VT, SC patrol notes, POST)
- [ ] Social media accounts (VT, POST)
- [ ] Physician and dentist; consent to release dental or medical records (VT, POST)

**Urgency scoring (VT Search Urgency Assessment) [AGENCY]:** the form scores age, medical condition, clothing, equipment, experience, weather and terrain. Total score: 5–17 means emergency response; "ANY ZERO RECORDED RESULTS IN IMMEDIATE EMERGENCY RESPONSE". "Known serious illness or impairment" scores 0, so a dementia case is immediately an emergency. https://dps.vermont.gov/sites/psd/files/documents/lost_person.pdf

---

### 3.6 Silver Alert

#### California Silver Alert, Gov. Code §8594.10 [AGENCY]
- **Who requests it:** the investigating law-enforcement agency (for Fremont, Fremont PD) asks CHP. "If the Department of the California Highway Patrol concurs", it activates the alert in the area requested. CHP then may issue a be-on-the-lookout alert, an Emergency Digital Information Service message or an electronic flyer. https://www.leginfo.ca.gov/pub/13-14/bill/sen/sb_1101-1150/sb_1127_bill_20140918_chaptered.htm
- **Criteria (all must be met)**, quoted from the CHP flyer:
  1. "The missing person is 65 years of age or older, developmentally disabled or cognitively impaired."
  2. "The investigating law enforcement agency has utilized all available local resources."
  3. "The law enforcement agency determines that the person has gone missing under unexplained or suspicious circumstances."
  4. "The law enforcement agency believes that the person is in danger because of age, health, mental or physical disability, environment or weather conditions, the person is in the company of a potentially dangerous person, or other factors indicating that the person may be in peril."
  5. "There is information available that, if disseminated to the public, could assist in the safe recovery of the missing person."
  - Source: https://www.chp.ca.gov/siteassets/news--alerts/printable-silver-alert-flyer.pdf (PDF downloaded and text extracted).
- **History:** SB 1047 created the program in 2012. SB 1127 (effective Jan 1, 2015) allowed alerts for developmentally disabled or cognitively impaired people "regardless of his or her age" and deleted the 2016 sunset. CHP's ENTAC is the 24/7 contact at (916) 843-4199. "Cognitively impaired" is defined in W&I Code §14522.4. https://www.caloes.ca.gov/wp-content/uploads/Warning-Center/Documents/Attachment-G-AMBER-SILVER-BLUE-and-YELLOW-Alerts.pdf
- **Public's role (CHP flyer):** "call 911 immediately", giving the location, description and, if a vehicle is involved, its make, model, color and plate.
- **Real timing example:** in the San Mateo 2025 dementia search, the Silver Alert went out about 24 hours after the person was last seen. [NEWS] paloaltoonline.com
- **Design implication:** criterion 2 ("utilized all available local resources") means a Silver Alert is *not* a first-hour tool. The first hour is local search, the BOLO and community notification.

#### Related programs [LIT / nonprofit]
- **A Child Is Missing (ACIM):** a Fort Lauderdale nonprofit used by law enforcement 24/7. It places "1,000+ calls to homes and businesses nearby" the last-seen location and covers **elderly people (often with Alzheimer's or dementia)**, disabled people and children. It reports 65,000–70,000+ cases assisted and over 80 million alert calls (its own figures, which are inconsistent on the page). California participation is not stated. https://achildismissing.org/
- **Project Lifesaver:** a public-safety program for "adults and children with the propensity to wander due to a cognitive condition". It combines locating technology (transmitters and a GPS option), SAR methods and first-responder training, and its site lists "4,673" rescued. https://projectlifesaver.org/. The IACP paper describes it as a radio system: the wearer's bracelet emits signals that law enforcement uses to locate them. https://theiacp.org/sites/default/files/all/a/AlzheimersPaper.pdf
- **MedicAlert (Safe & Found):** wearable ID, a 24/7 US-based team that "connects first responders to your health info and emergency contacts", and for dementia wandering it will "work with local authorities to get them home safely". https://www.medicalert.org/
- **Alzheimer's Association** recommends enrolling in "a wandering response service". Keep "a recent, close-up photo" and a written list of places the person might go. Note nearby hazards: water, stairwells, dense foliage, tunnels, bus stops, busy roads. 24/7 Helpline 800-272-3900. https://www.alz.org/help-support/caregiving/safety/wandering

---

### 3.7 Unreachable sources

| URL | Problem | Workaround used |
|---|---|---|
| https://www.chp.ca.gov/News-Alerts/Silver-Alert | HTTP 403 to fetch and curl | CHP printable flyer PDF and Cal OES Attachment G |
| https://law.justia.com/codes/california/code-gov/title-2/division-1/chapter-7/article-6-5/section-8594-10/ | HTTP 403 | SB 1127 chaptered text on leginfo.ca.gov, plus the CHP flyer |
| https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=8594.10 | Cloudflare challenge (403) | as above. Not confirmed whether later bills changed §8594.10 after 2015. |
| https://www.cocosheriff.org/bureaus/support-services/search-and-rescue | HTTP 403 | none; nothing about Contra Costa SAR is claimed beyond the table row |
| https://alamedasheriff.gov/about-us/emergency-services-dispatch | HTTP 503 | ALCO SAR site and acgov.org page |
| https://www.fremontpolice.gov/ (news/FAQ pages) | HTTP 403 | Fremont PD Nixle alert; CA POST and state law on no waiting period |
| https://claytonmo.gov/... (IACP-based model policy) | HTTP 403 | IACP concepts paper |
| https://Alz.Org/media/Documents/alzheimers-dementia-wandering-behavior-ts.pdf | HTTP 404 | alz.org wandering page |

**Not found anywhere (gaps):**
- A published ACSO SAR dementia protocol or "loved one missing" page.
- A document saying Fremont PD specifically requests ACSO SAR. The Cal OES Annex gives the general rule that a city PD "may and should" request the Sheriff.
- NASAR-specific dementia statistics. NASAR material was not opened; the ISRID numbers above come from Koester/dbS.
- Project Lifesaver's average recovery time. A figure of about 30 minutes appeared only in search snippets and was not verified, so it is omitted.


---

## 4. Contacts and outreach
See **OUTREACH.md** for the full prioritised table and draft messages, and **contacts.csv** for the same contacts as data. Start with these three:
1. **Contra Costa County Sheriff's SAR**: searchandrescueinfo@contracostasar.org. Its contact page says this inbox handles events and public relations. https://www.contracostasar.org/contact-us
2. **Alzheimer's Association NorCal & NorNev**: Bay Bridge Office (Emeryville) 925.284.7942 or San Jose HQ 408.372.9900. Not the 24/7 Helpline. https://www.alz.org/norcal/about/contact-us
3. **Santa Clara County Sheriff's SAR**: info@sccssar.org. https://sites.google.com/sccssar.org/sccssar/contact

Local but harder to reach: Alameda County Sheriff's SAR K9 Division (Deputy SAR Coordinator, 925-803-7800, older site) and the City of Fremont Family Caregiver Support Program (Senior InfoLine 510-574-2041, via 211 Alameda County).
