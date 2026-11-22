# FindThem

> **New here? Read [ShortPlan.md](ShortPlan.md) first** (2 minutes). Then `PLAN.md` (full plan), `INTERFACES.md` (screen ↔ engine contract) and `CommitHistory.md` (every decision and commit).

**Try it: https://donaldstewart4.github.io/FindThem/** (tap **Demo** for a sample case in Fremont, CA).

**If someone is missing, call emergency services first (911 in the US).** FindThem helps a search get organized. It does not replace the police or search-and-rescue.

FindThem is a phone app (a website you can install) for the first hour after a person with dementia goes missing, for the family and neighbors who start looking before professionals arrive. It tells them where to look first, gives each searcher an area and a walking route, keeps everyone on one live map, and updates the map as places come up empty or someone reports a sighting.

This is a guide to help focus the search, not a guarantee.

Built for EvoHacks II (theme: social good).

> **Status (Nov 21, 2026, night):** live at **https://donaldstewart4.github.io/FindThem/**. Everything runs on the real engine (`engine/`): 5,000 simulated walkers on Fremont's real streets, the Bayesian probability map, next areas with walking routes, and top spots. **Live sharing runs on our real Firebase database**, including each searcher's position on the map. **The proxy is deployed** on Cloudflare with the Deepgram and ElevenLabs keys; the TypeSafe key for Jev is still to come, so until then the report box fills in forms with the backup word rules on the phone. The benchmark is done (below). Not yet tried on real phones: voice with a real microphone, and two phones sharing.
>
> **Branch `prior-v2` (Nov 22):** the prediction engine was rewritten ("prior v2", by Nathan with Claude Code) and this README describes that branch: the sections "How the prediction works", "How good is the map?" and "Benchmark" below. It is not merged or deployed yet; the live site still runs the first engine.

## What it does

0. **Call 911 first.** The red banner is always on screen and is a tap-to-call link with your country's emergency number. "First steps" also has a script of what to tell the dispatcher.
1. **Check the house and yard.** A 2-minute checklist: closets, under beds, bathrooms, garage, parked cars, shed, neighbors' yards. In search-and-rescue data, many are found close to home or even inside it.
2. **Enter what you know.** Tap the map where they were last seen, or search for the address or place with the magnifying glass (a blue bar on the map says when it is waiting for your tap), then add minutes since, the direction they were heading (turn the red arrow on the map), how they walk (normal / slowly / walker or cane), and up to 3 familiar places (old home, old job, church). The five numbered steps fold into one summary line after **Find** ("Seen 45 min ago · Northeast · Slowly"); tap it to change something.
3. **See the map.** It keeps up with time: every 5 minutes the minutes since last seen go up by 5 and the map is redrawn, since they may have walked further. In a shared search every phone counts from the same moment, so all maps match.
   - the likely areas: **red** is the smallest area with a 1-in-4 chance they're inside, **orange** brings it to 1 in 2, **yellow** to 4 in 5. Search red first. (A plain heatmap made the whole area one blue blur that told nobody where to go.)
   - the streets most simulated walkers took, in purple
   - dashed rings at 0.5, 1 and 1.5 miles
   - **Check these first:** the top 3 places (8 when expanded), each with a reason and its chance right now, such as "Creek 130 ft off Main St – 12% chance they are here". Water and wetland spots are marked "leave this to professionals".
4. **Next areas to search.** Areas A, B and C are the best places for the next searcher, each with its chance and a walking route. Open one, search it, and tap **Searched, nobody found** with the minutes spent.
5. **Share the search.** Enter your name and tap **Share this search**. Everyone who opens the link sees the same live map: searched areas, sightings and messages appear for everyone within about a second. The app asks for the phone's location when it opens, so each searcher also shows up as a green dot with their name (updated every 30 s or after 25 m; hidden after 15 minutes without an update). Saying no is fine: the app works without it.
6. **Report a sighting**, either:
   - on the map: tap where they were seen, then say how long ago, which way, how sure, and any details, or
   - in the **report box**: type or speak ("saw a man in a blue coat by the lake 10 minutes ago, heading east") and an AI fills in the form. **Nothing is added until you check it and tap the button.** How it works:
     1. **Speech → text:** if the proxy has a Deepgram key, the app records you and **Deepgram** turns the recording into text, then goes straight on to step 2 (hands-free). Otherwise it uses the phone's own speech recognition (Google on Android Chrome, Apple on iPhone Safari), in the app's language.
     2. **Text → form:** our small proxy asks Jev five multiple-choice questions (kind, direction, minutes ago, how sure, which nearby place). Answers Jev isn't confident about are left blank.
     3. **You check the form and add it**, and it updates the shared map like any sighting. If the proxy has an ElevenLabs key and you spoke the report, the app also **says what it filled in** ("I filled in a sighting. Seen 10 minutes ago. Heading east. I wasn't sure about: where.") with an **ElevenLabs** voice. **The read-back is English only:** in Spanish, French, Chinese or Japanese the app doesn't speak (ElevenLabs is never called) and you just see the filled-in form. Voice input still works in all five languages.
     **If Jev can't answer** (no signal, no key, an error), a **backup reader on the phone** (`quickread.js`) fills in the same form with simple word rules in all five languages ("10 minutes", "hacia el norte", "往东", "maybe" …) and says so, so reporting never depends on the AI. On our 40-report test set (`bench/jev-cases.json`) it gets 95% of fields right, but we wrote those reports and the rules together, so expect less on real reports.
7. **Messages** between everyone on the search.
8. **Hand-off sheet for police:** last seen, how they walk, a timeline of everything searched and seen, the most likely places still to check (with coordinates), and the live link. You can copy or print it. A non-English sheet includes an English copy.

**Before an emergency:** "Save my home area" stores the streets around home on the phone (find it by address, map tap or GPS), so the app works there even with no signal.

**With no signal** (tested with the server stopped and every web request failing): the app opens, the Demo runs, saved areas work, searches and sightings stay on the phone and are sent when signal returns. What needs internet says so plainly instead of failing quietly: new streets ("No internet, and no streets saved near here…"), address search, sharing live (the link still works and shows the same map), and the report box (the backup reader on the phone fills in the form instead of Jev). Wi-Fi that has no internet is noticed after two failed tries (about 3 s) instead of minutes of "server busy" retries.

**Anytime:** the ◎ button shows your own position as a blue dot (GPS works without cell signal). **Demo** runs a sample case in Fremont, CA in one tap.

## How the prediction works

The map answers one question: **where is this person probably, this many minutes after they were last seen?** It is built the way a search planner works, from published statistics on lost people with dementia (Koester's *Lost Person Behavior*, the ISRID database), on the real ground around the last-seen point.

1. **A ground map.** OpenStreetMap is turned into 10 m squares: roads, paths, buildings, fences, rail lines, water, creeks and drainage channels, yards, parking lots, parks. Buildings, fences and rail can't be walked through; a road over a creek is a bridge.
2. **An ISRID statistics map.** In towns, a quarter of people with dementia are found within 0.3 km, half within 1.1 km, three quarters within 3.2 km. 35% are found at a structure, 36% on a road, 9% on a path, 6% in water, 4% in a drainage. Those two tables, limited by how far a person could have walked in the time so far, give every square a chance.
3. **5,000 simulated walkers.** Each has its own walking speed (0.62 ± 0.23 m/s, a published figure), its own share of time spent moving, and a kind: keeps one course, wanders, stays near buildings, or heads for a familiar place. A third keep to roads; the rest are willing to leave them. Where each walker is, minute by minute, is kept.
4. **Still missing.** A person walking a busy road for half an hour would probably have been noticed. Nobody has reported them, so walkers who spent long on busy roads count for less.
5. **The blend.** The map is the statistics map and the walkers together. How much each counts was set by evaluation, not by hand: 95% statistics map, 5% walkers. When the case lists familiar places, a quarter of the map goes to walkers heading there.
6. **Not on this map.** The map reaches 3.2 km. The chance that the person is beyond it is worked out and kept apart (near 0 in the first hour, about 23% after many hours), instead of being hidden.
7. **Updates from the search (Bayesian search theory).** When an area is searched and nobody is found, its chance drops by how likely the searchers were to spot the person there (1 − e^(−coverage), Koopman's formula), and everything else rises. The engine knows when each search happened: a search doesn't count against someone who walked in afterwards. A sighting starts new walkers from that point, spreads as the minutes pass, and is blended in by how sure the reporter is.
8. **Where it's dangerous.** A second layer scores water, creeks and drainage channels by how likely the person is to be within 150 m. Spots and areas beside them say so: look from the bank, don't go in.
9. **What to search next.** Each searcher's next area is the one where their minutes add the most chance of finding the person.

**Calibration.** The walkers' free numbers were fitted by `tools/calibrate.js` to the urban ISRID statistics on 24 Fremont start points, then checked on 24 others it never saw. On those: 26% / 50% / 81% found within 0.3 / 1.1 / 3.2 km (ISRID: 25 / 50 / 75), 38% at a structure (35), 38% on a road (36), 9% on a path (9), 5% in water (6), 8% in a drainage (4). It does **not** fit ISRID's mobility hours (the model's median is 2.7 h of mobility, ISRID's is 0.25 h): the two published samples disagree with each other at the published walking speed, and we fitted the larger one, distance. Every tunable number is labeled DATA, EXPERT or ASSUMPTION with its source in `engine/params.js` and `engine/prior.js`.

**Speed.** The engine runs in a background worker, so the page never freezes. A first map takes about 0.3 s on a laptop, and 0.9 to 1.5 s in Chrome with the processor slowed four times to stand in for a phone. The 5-minute clock tick takes a few milliseconds, or about a tenth of a second when it starts a new 15-minute block of walking.

**Two-phase download.** For a new area the first map appears from the streets alone; buildings and land use arrive in a second download and the map sharpens when they do.

The same case and seed always give the same map, so every phone computes the identical map by itself from the shared list of events. The grid is anchored to the case's last-seen point, so two phones always mean the same ground by the same area.

## How good is the map?

`bench/prior-eval.js` tests the map with no clues on 60 Fremont start points that calibration never saw. The "true" locations are placed from ISRID statistics only, never by our walkers: 6,000 cases. The score is how much ground is searched before reaching the person, most likely squares first.

| Map | Median ground searched (where people end up) | Found within 0.5 km² | Median, 60 min after last seen |
|---|---|---|---|
| Distance rings around the last-seen point | 1.30 km² | 39% | 1.21 km² |
| The first engine, as its app drew it | 2.54 km² | 21% | 2.06 km² |
| **The new prior** | **0.99 km²** | **41%** | **0.92 km²** |
| ISRID statistics map alone (upper bound) | 1.03 km² | 42% | 0.90 km² |

The statistics map is the recipe that placed the true locations, so it is an upper bound, and the new prior is 95% that map: being close to it is partly by construction. What the test does show is that the first engine was worse than plain rings and the new one is better than both. Told the wrong time (gone 100 minutes, app told 60) the new prior's median goes from 1.63 to 1.69 km². The full report, with charts, the calibration table, sensitivity and limits: [`bench/prior-report.md`](bench/prior-report.md) and `bench/prior-report.html`.

## Benchmark

Does FindThem help volunteers find someone sooner? We simulated **1,000 cases** on the Fremont map: 5 start points, direction known or unknown, 100 people each. A team of **6 volunteers** searches 200 m areas in 20-minute turns. A search finds the person, if they're there, with the same detection formula the app uses. The share of cases found:

| Strategy | Found after 500 searcher-min | Found after 1,500 searcher-min | Found after 3,000 searcher-min |
|---|---|---|---|
| Volunteers searching on their own | 8% ±2 | 19% ±2 | 34% ±3 |
| Coordinated ring sweep | 18% ±2 | 28% ±3 | 35% ±3 |
| **FindThem allocation** | **20% ±2** | **40% ±3** | **54% ±3** |
| FindThem + one sighting | 69% ±3 | 86% ±2 | 92% ±2 |

- **On their own:** each volunteer picks nearby areas at random, with no shared record.
- **Ring sweep:** coordinated, nearest areas first, each searched once.
- **FindThem:** the app's plan, the most chance gained per minute, updated after every empty search.
- **+ sighting:** one neighbor's sighting reported after the first turn, seen on the way about 100 m off, with direction and time, marked "probably".

1,500 searcher-minutes is about 6 volunteers for 4 hours. ± is a 95% margin.

**Limits:**
- The simulated "real" people are walkers, not real cases. Since the engine rewrite they come from a **different model** than the app uses: the first engine's street-only walkers (kept in `bench/old-engine/`), with two sets of settings. Before the rewrite both sides shared one walker model, which flattered the app: the same table then read 31% / 54% / 70% for FindThem. The fair comparison at 1,500 searcher-minutes is **40% against 28%** for a coordinated ring sweep.
- The "+ one sighting" row is optimistic: the sighting is placed on the straight line toward the person's true end point. Read it as "a good sighting helps a lot", not as a number.
- The ring sweep searches each area only once, which is why it levels off. The ± margins treat the 1,000 cases as independent, but they come from 10 setups, so the true margins are wider.
- Real people and real searches are messier. This shows how much a shared record and the probability map *could* help; it is not field-tested.

Run it yourself: `npm run bench` (about a minute; writes `bench/results.md`).

## Languages and units

- **Five languages:** English, Spanish, French, Simplified Chinese and Japanese. The app starts in your phone's language; switch with the language picker.
- **Units:** miles and feet in the US (and Liberia, Myanmar), kilometers and meters elsewhere. The **mi/km** button switches.
- **Emergency number:** the banner shows your country's number (911, 112, 999, 000, 110…).

The translations were written by AI and haven't been checked by native speakers yet.

## Who built what, and how AI was used

| Who | Part | AI use |
|---|---|---|
| **BenStew** | Screen and hosting: the page, map, inputs, data loading, live sharing, messages, report box, offline mode, translations | Built with Claude Code (Anthropic's AI coding assistant), with BenStew directing and reviewing. Several screen files and the test servers were written by Claude Code sessions. |
| **BenStew** | The first engine (`engine/`): walkers on the street network, probability grid, Bayes updates, allocation, routes | Built with Claude Code, with BenStew directing. The official EvoHacks 2 rules encourage AI use. |
| **Nathan** | Tests, debugging, speed (`tests/`, `bench/`); tuning the Jev questions | AI may help write tests; Nathan reviews and explains them. |
| **Nathan** | The engine rewrite on branch `prior-v2` ("prior v2"): ground map, walkers as particles, ISRID statistics map, calibration, evaluation, hazard layer, the engine in a worker | Built with Claude Code from Nathan's audit and brief, in four reviewed stages. Claude Code also made the changes this needed in the screen files (`BEN.md` lists them). |

**AI inside the app:** only the report box uses an AI: **Jev**, a model from TypeSafe AI, reached through our own small proxy. Jev doesn't write text; it answers five multiple-choice questions about a report (what kind, which way, how long ago, how sure, which nearby place), each with a confidence. Anything it isn't confident about is left empty for the person to fill in, and nothing is added until the person checks the form and taps the button. It never sets the probabilities, and the word "chatbot" never appears in the app. The optional **voice bot** adds two speech services through the same proxy: **Deepgram** (speech → text) and **ElevenLabs** (reading the filled-in form back aloud). They only turn speech into text and text into speech; Jev still fills the form, and the person still confirms it.

`CommitHistory.md` records every commit, including which work came from which session.

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout: emergency banner, map, panel with inputs and results |
| `style.css` | How it looks: mobile-first, big buttons, high contrast for outdoors |
| `app.js` | Runs the page: taps and inputs, drawing the map, areas and routes, sightings, sharing, messages, hand-off sheet, report box, offline and home area. The demo case is at the top |
| `data.js` | Streets and creeks from OpenStreetMap (Overpass), address search (Nominatim), saving areas in the browser (IndexedDB) |
| `sync.js` | Live sharing through Firebase's web API: the case, events and messages; an offline queue |
| `report.js` | Report box logic: voice input, sending to the proxy, checking the answer |
| `quickread.js` | The report box's backup reader: simple word rules in 5 languages, used on the phone when Jev can't answer |
| `i18n.js` | Every on-screen word in 5 languages, emergency numbers, units |
| `config.js` | The Firebase and proxy addresses (not secrets) |
| `engine/` | The prediction engine: `graph.js` (street network, nearby creeks/parks), `surface.js` (10 m ground map), `sim.js` (walkers), `prior.js` (ISRID statistics map), `grid.js` (probability map, Bayes updates, hazard layer, next areas, top spots), `routes.js` (walking routes), `params.js` (every tunable number, labeled), `calibrated.js` / `.json` (fitted values, written by `tools/calibrate.js`), `host.js` + `worker.js` (the engine in a background worker), `index.js` (what the app imports) |
| `sw.js`, `manifest.json`, `icons/` | Offline mode and installing to the home screen |
| `lib/` | Leaflet (map), stored here rather than loaded from the internet |
| `proxy/` | Tiny Cloudflare Worker that holds the API keys as secrets: asks Jev about a report (`jev.js`) and returns form data only; optional voice bot with Deepgram and ElevenLabs (`voice.js`) |
| `firebase-rules.json` | Database rules: no listing searches, events can only be added, searcher positions checked |
| `tests/` | `node --test` tests; `tests/fixtures/demo-area.json` is real Fremont street data, used by the Demo and the engine tests |
| `bench/` | `prior-eval.js` + `prior-report.js` (the evaluation of the map: `prior-report.md`, `prior-report.html`), `benchmark.js` (the search simulation below) and `results.md` (its latest output), `phone-budget.js` (time and memory), `old-engine/` (a frozen copy of the first engine, for comparison only) |
| `tools/` | `calibrate.js` (fits the walkers to ISRID), `make-fixture.js` (rebuild the Fremont data), `data/fremont-wide.json.gz` (a wider Fremont map for calibration and evaluation; never loaded by the app), `browser/` (checks that drive a headless Chrome), `mock-firebase.py` and `mock-proxy.py` (local stand-ins for testing), `make-icons.py` |
| `ShortPlan.md`, `PLAN.md`, `INTERFACES.md`, `CommitHistory.md`, `ROADMAP.md` | Plans, the engine contract, the decision log, and future plans |
| `docs/PRIOR-V2.md`, `BEN.md` | The design of the engine rewrite, and what it changed in the screen files |

No frameworks and no build step: plain HTML, CSS and JavaScript. The only online parts are the Firebase database (sharing) and the AI proxy (report box). The prediction always runs on the phone.

## Run it locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 and tap **Demo**.

Service workers (the offline part) only work on `localhost` or over HTTPS. Opening `index.html` directly as a file won't work.

Run the tests:

```bash
node --test
```

To test offline mode: load the app once, then stop the server (Ctrl+C) and reload. The app still opens and the Demo still runs (its Fremont streets are saved with the app). The yellow "You're offline – using saved data" line appears when the phone itself has no signal.

**While developing:** the offline worker serves saved copies first, so after you edit a file, reload twice to see the change. Bump `CACHE_VERSION` at the top of `sw.js` whenever app files change, so phones pick up the new version.

## Set up live sharing (Firebase)

Live sharing (one map for every searcher, messages, searched areas) needs a free Firebase Realtime Database. Without it the app still works: searches stay on one phone, and share links carry the starting map in the link itself.

1. Go to https://console.firebase.google.com, sign in, and click **Create a project**. Analytics isn't needed.
2. In the project, open **Build → Realtime Database → Create database**. Pick a US location and start in **locked mode**.
3. Open the **Rules** tab, replace everything with the contents of `firebase-rules.json`, and click **Publish**. The rules make sure that:
   - nobody can list searches; you need the 32-character id from a link
   - a search's case can be written once
   - events can only be added, never changed or deleted
   - each searcher's position (`searchers/`) must be a plain lat/lng/time/name, and each phone overwrites only its own
4. Copy the database URL shown at the top of the **Data** tab (like `https://findthem-12345-default-rtdb.firebaseio.com`) into `FIREBASE_DB_URL` in `config.js`, then commit.

The URL isn't a secret, so it's fine in the repo. No API key is needed.

**Testing without Firebase:** run the mock database, then open two tabs with `?db=`:

```bash
python3 tools/mock-firebase.py
```

Open http://localhost:8000/?db=http://localhost:9000 in two tabs. Run the Demo in one, tap **Share this search**, and open the link in the other.

## Set up the report box (AI proxy)

Follow `proxy/README.md`: a free Cloudflare account, a TypeSafe API key for Jev stored as a Worker secret, then `wrangler deploy`. Put the Worker's address in `PROXY_URL` in `config.js`, and set `ALLOWED_ORIGIN` in `proxy/wrangler.toml` to your site's address before the demo. For the voice bot, also set `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` the same way (optional; without them, voice works as before). **Never put any API key in the website or the repo**; for local testing they go in `proxy/.dev.vars`, which git ignores.

**Testing without a Jev key:** the backup reader works with no proxy at all. To test the proxy path, run `python3 tools/mock-proxy.py`, then open http://localhost:8000/?proxy=http://localhost:9100. It fills in forms with simple English keyword rules instead of Jev.

**Scoring the report box:** `npm run jev-eval -- --local` scores the backup reader on 40 realistic reports in all five languages; `npm run jev-eval` scores Jev through the live proxy (needs the TypeSafe key). Add `--show` to list the misses.

## Deploy for free with GitHub Pages

GitHub Pages gives you a free HTTPS address, which offline mode needs. On a free account the repository must be public.

This repo is already deployed at **https://donaldstewart4.github.io/FindThem/**. Pushing to `main` updates it within a minute or two. To deploy your own copy:

1. On GitHub, open the repository's **Settings → General → Danger Zone → Change visibility** and make it public.
2. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, and click **Save**.
3. After a minute or two the site is live at `https://<your-username>.github.io/FindThem/`.

After changing the app, bump `CACHE_VERSION` at the top of `sw.js` so phones pick up the new files.

## Limits

- The statistics behind the map are published summaries (ISRID: 336 urban dementia cases for distance, 223 for where people were found; 11 for the dispersion angle), not case records, and the walking-speed study is of people with cognitive impairment, not all with a dementia diagnosis.
- Nothing has been validated on real searches. The evaluation's "true" locations are drawn from the same published statistics the map is built from; the benchmark is a simulation.
- The model fits ISRID's distances but not its mobility hours (see Calibration above).
- The map reaches 3.2 km from the last-seen point. Beyond that the app only says how likely it is that the person is off the map.
- Elevation is not used, and the sea is not handled (on a coast it would be treated as plain ground).
- For a few minutes after starting a search in a new area, a phone still waiting for the buildings download shows a rougher map than one that has them.
- Untrained volunteers should not go into water or dense brush; the app flags those for professionals.
- Browser GPS only works while the page is open.
- Anyone with a search link can see and add to that search. There are no accounts yet.
- In a shared search, each phone's position (rounded to about 1 m) and the name you typed go to our Firebase database, where anyone with the search link can see them. Positions are only shown as dots; they're overwritten as you move, not kept as a trail.
- Report-box text leaves the phone and goes to TypeSafe (Jev), with nearby place names but no coordinates. (The backup word rules run on the phone and send nothing.) Spoken reports also go to Google or Apple to be turned into text, or, with the voice bot set up, the recording goes to Deepgram and the read-back sentence (which can include a place name) to ElevenLabs. The app asks people to leave out names and medical details.
- Voice input needs signal. In Firefox it only works through the voice bot (Deepgram), since Firefox has no built-in speech recognition. Deepgram was tested with a recorded sentence, not yet with a real phone's microphone.
- The map grows with time in 5-minute steps, so it can be up to 5 minutes behind. Phones whose clocks disagree by more than a few seconds may redraw a few seconds apart.

## Data and credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.
- Map tiles from OpenStreetMap. The app follows the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): it only saves tiles you have actually looked at and never downloads tiles in bulk.
- Street and terrain data from the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API).
- Address search from [Nominatim](https://nominatim.org/), one request at a time.
- Map library: [Leaflet](https://leafletjs.com/).
- Lost-person statistics: Robert Koester, *Lost Person Behavior*, dementia chapter (ISRID): distances, find locations, track offset, dispersion angle, mobility, "66% cross or depart from a road" (https://www.dbs-sar.com/LPB/Dementia.pdf).
- Walking speed: Toots, Taylor, Lord, Close (2019), *J Alzheimers Dis* 71(s1): usual gait speed 0.62 ± 0.23 m/s in 309 older adults with cognitive impairment.
- Rowe et al. (2011), *BMC Geriatrics* 11:28, on people with dementia missing in the community (53% of those on foot found within 1 mile; deaths mostly in unpopulated areas).
- Scoring: Sava, Twardy, Koester, Sonwalkar (2016), "Evaluating Lost Person Behavior Models", *Transactions in GIS* 20(1).
- Search theory: B. O. Koopman's detection model and Bayesian search theory; sweep widths from Koester, Cooper, Frost, Robe (2004), "Sweep Width Estimation for Ground Search and Rescue".
- Terrain speed factors from Soule and Goldman (1972), *J Appl Physiol* 32(5).
