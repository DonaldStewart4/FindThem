# Data dictionary: `cases.csv` / `cases.geojson`

One row per resolved case of a person with dementia (stated in the source) who left a home or care facility **on foot** and was later found. All values come from the cited public sources. Where a source doesn't state something, the field is blank. Nothing is guessed.

## Inclusion rules
- The source states dementia, Alzheimer's, a named dementia type, or residence in memory care.
- The person left on foot. Cases involving vehicles, bikes, scooters or transit were rejected, as were cases where the mode was unclear.
- The person left from a home or a care facility (a hospital is allowed only if flagged in `departure_type`).
- The case is resolved: the person was found alive or dead.
- The source describes **both** a last-seen place and a found place. "Found safe nearby" with no place was rejected.
- Every source was fetched and read. Search snippets alone were never used.

## Privacy
- No names, photos or house numbers. Street numbers are removed from all text fields.
- Age is given in whole years, only when the source states it.
- Coordinates are rounded to 3 decimals (about 110 m north–south).

## Fields

| Field | Meaning |
|---|---|
| `case_id` | `<country>-<nnn>`, assigned after sorting by country/state/city/date. Not stable across rebuilds. |
| `source_urls` | One or more source URLs, separated by ` \| `. |
| `country` | US, CA, UK, AU (NZ if any). |
| `state` | State, province, or for the UK the county/region. |
| `city` | City/town/municipality named in the source. |
| `setting` | urban / suburban / rural. **The researcher's judgment** from the place's type and size, not a computed density class. Blank if unsure. |
| `year_month` | YYYY-MM when the person went missing. |
| `season` | Taken from the month, with hemisphere taken into account (AU/NZ seasons are flipped). Dec–Feb = winter in the north. |
| `age` | Age in years, if stated. |
| `departure_type` | home / care_facility / hospital / other. |
| `last_seen_desc` | Text description of where the person was last seen or left from. |
| `last_seen_lat`, `last_seen_lng` | Geocoded point, rounded to 3 dp. Blank if no usable geocode. |
| `last_seen_confidence` | Confidence in that point (scale below). |
| `found_desc` | Text description of where the person was found. |
| `found_lat`, `found_lng` | Geocoded found point, rounded to 3 dp. Blank if not geocodable (e.g. "woods behind the home"). |
| `found_confidence` | Confidence in that point. |
| `location_confidence` | The **worse** of the two point confidences. This rates the case as a whole. |
| `distance_km` | Straight-line distance from last-seen point to found point. |
| `distance_basis` | How `distance_km` was obtained. `geocoded (exact\|street)` means both points are good. `geocoded (neighborhood; approx)` means it may be off by about 1–2 km. `reported in source` means it was taken from the article's own distance phrase because the geocodes were missing or city-level. |
| `reported_distance_text` | Distance phrase quoted from the source, e.g. "about two miles from home". |
| `reported_distance_km` | That phrase converted to km. Ranges use the midpoint; 1 block ≈ 0.1 km. |
| `found_type` | structure / road / linear / drainage / water / brush / woods / field (definitions below). |
| `minutes_missing` | Minutes from last seen (or reported missing, if that's all the source gives) to found. |
| `minutes_basis` | How the minutes were derived (times quoted, or "source: about N hours"). |
| `outcome` | alive uninjured / injured / deceased / alive (condition not reported). |
| `heading` | Direction of travel, if reported. |
| `destination` | Intended destination, if reported (former home, work, store, etc.). |
| `time_of_day` | When last seen: morning (05–12), afternoon (12–17), evening (17–21), night (21–05). |
| `found_by` | public / police / family / SAR / dog / drone / helicopter / staff / fire (fire department) / self (walked out to searchers on their own). |
| `qa_flags` | `;`-separated QA flags. `on_foot_implied` / `on_foot_not_found`: on foot is not stated in the source (e.g. walked out of a facility door, found yards from home). `dementia_inferred_from_memory_care`: no diagnosis stated, only a memory-care residence. `found_point_may_not_be_walk_endpoint`: the body may have been moved by water or an animal. `distance_conflict`: the geocoded distance and the source's stated distance disagree by more than 50% and more than 0.5 km. `found_place_relative_only`: the found place is described only relative to home (e.g. "800 ft from the care home, in a wash"), with no point. `corrected_on_verification:<fields>`: the independent re-check changed these fields. `<field>_unconfirmed_blanked`: the re-check could not confirm the value, so it was blanked. `source_unreachable_on_recheck` / `not_independently_verified`: there was no second read. |
| `strict` | `yes` only if all of these hold: the source explicitly states dementia, on foot is stated or strongly implied ("wandered away", "walked out the door") rather than unsupported, the source was re-read by an independent checker, and there is no distance conflict and no water/animal displacement. Use `strict = yes` for the most defensible test set. |
| `notes` | Weather, terrain, search effort, hospital transport, and similar details. |

### Confidence scale (per point)
| Value | Meaning |
|---|---|
| `exact` | A named building, facility, business or a small named feature (≤ 300 m across). |
| `street` | A named street whose matching segments near the town span ≤ 1.5 km, or a street intersection resolved to within 80 m. |
| `neighborhood` | A long road (> 1.5 km), a large park, river or lake (the point is only representative), a suburb, or an intersection that could only be approximated. Treat as ±1–2 km. |
| `city` | Only the town could be located. Distances are not computed from city-level points. |

Each point's confidence is the **worse** of two ratings: the precision the source implies and what the geocoder actually matched.

### `found_type` definitions
- **structure**: inside or at a building, shed, garage, porch or store.
- **road**: on or beside a road, highway shoulder or parking lot.
- **linear**: trail, railway, power line or fence line.
- **drainage**: ditch, culvert, ravine or dry creek bed.
- **water**: in or at a pond, lake, river, canal or the sea.
- **brush**: scrub, thicket or overgrown lot.
- **woods**: forest or wooded area.
- **field**: farm field, open lot, golf course, yard or grassland.

## Geocoding
- Geocoder: OpenStreetMap Nominatim (`nominatim.openstreetmap.org`), at most 1 request/second, with a descriptive User-Agent. Queries never contain house numbers.
- Each query is restricted to the case's country.
- A result more than 40 km from the named town is discarded, because it is a town of the same name elsewhere.
- For intersections, both streets are fetched and the point is placed at their closest approach.

## `cases.geojson`
- Each case has up to three features: a `last_seen` point, a `found` point, and a `track_straight_line` LineString joining them.
- The LineString is only a straight line between the two points. It is not the route the person took.
- Every row field is copied into the feature properties.
