# FindThem

**If someone is missing, call emergency services first (911 in the US).** FindThem helps a search get organized. It does not replace the police or search-and-rescue.

**Try it: https://donaldstewart4.github.io/FindThem/** (tap **Demo** for a sample case in Fremont, CA).

Built for EvoHacks II (theme: social good) by BenStew and Nathan, Nov 21–22, 2026.

## Run it in 3 commands

```bash
git clone https://github.com/DonaldStewart4/FindThem.git
cd FindThem
python3 -m http.server 8000
```

Then open http://localhost:8000 and tap **Demo**.

- Nothing to install and nothing to build: plain HTML, CSS and JavaScript. The Demo's Fremont streets ship with the app, so it works with no signal and no keys.
- Tests: `node --test` (tested on Node 22; no `npm install`, there are no packages).
- Open the page through the server, not as a file: the offline part only works on `localhost` or HTTPS.

## What FindThem is

A phone app (a website you can install) for **the first hour after a person with dementia goes missing**, for the family and neighbors who start looking before professionals arrive.

- It shows **where to look first**: a map of the likely areas, built from published lost-person statistics on the real streets, water and buildings around the last-seen point.
- It gives **each volunteer their own route**, so nobody searches the same ground twice and nobody is sent into water.
- It keeps **everyone on one live map**: sightings, searched ground and messages reach every phone in about a second.
- It **updates as the search goes on**: empty areas fade, a sighting moves the map, and time passing spreads it.
- It works **offline**, in **five languages** (English, Spanish, French, Chinese, Japanese), and ends with a **hand-off sheet for the police**.

**What it is not:**
- Not a replacement for calling 911, the police or search-and-rescue. The call banner never leaves the screen.
- Not a tracker: it does not know where the missing person is. The map is a guide to focus a search, not a guarantee.
- Not a chat with an AI. The one AI feature turns a spoken or typed report into a form that a person checks before anything is added. The AI never sets a probability.
- No accounts, no ads, nothing to pay for.

## What's in the app

0. **Call 911 first.** A red tap-to-call banner with your country's emergency number, always on screen, plus what to tell the dispatcher.
1. **Check the house and yard.** A 2-minute checklist. Many people are found close to home or inside it.
2. **Enter what you know.** Where they were last seen (tap the map or search an address), how long ago, which way they were heading, how they walk, and up to 3 familiar places.
3. **See the map.**
   - Likely areas: **red** is the smallest area with a 1-in-4 chance, **orange** 1 in 2, **yellow** 4 in 5.
   - **Check these first:** the top places with a reason and a chance. Water, creeks and channels are marked "look from the bank, don't go in"; woods and brush are marked "check from the path".
   - The map redraws every 5 minutes as time passes. In a shared search every phone counts from the same moment, so all maps match.
4. **Your route.** Each volunteer sees **up to 3 ranked routes** from where they stand, each with its chance, walking time and **warnings** (busy road, rail crossing, water nearby, night). Taking one tells every other phone, so **two people are not sent to the same ground**.
5. **Share the search.** One link. Everyone who opens it sees the same live map and each other as green dots.
6. **Report a sighting.** Tap the map, or use the **report box**: type or speak ("saw a man in a blue coat by the lake 10 minutes ago, heading east") and the form is filled in for you.
   - **Nothing is added until you check it and tap the button.**
   - Fields the reader was not sure about are left empty and marked "Not sure: please check".
   - A report that mentions water, a vehicle or an emergency shows a warning first (for example "Call 911 now").
   - With no signal, a backup reader on the phone fills in the same form with simple word rules.
7. **Corrections reach everyone.** "Actually it was 40 minutes ago" is sent to every phone in the search, not changed on one.
8. **Found.** One button ends the search for everyone and drops a pin where the person was found.
9. **Messages** between everyone on the search.
10. **Hand-off sheet for police:** last seen, a timeline of everything searched and seen, the likeliest places still to check, and the live link. Copy or print.
11. **Before an emergency:** "Save my home area" stores the streets around home, so the app works there with no signal.
12. **A version warning** if a search was started on a different version of FindThem, since the maps could differ.

The short sentences the app says back to you ("About how long ago?", "They've been found. Thank you, everyone.") are fixed, pre-written lines in all five languages.

## Results

Everything below was measured during the event. All of it is **simulation or held-out test data, not real searches**; each part says what it can and can't show.

### 1. The map: less ground to search

`bench/prior-eval.js` asks: searching the likeliest ground first, how much ground is covered before reaching the person? 6,000 simulated cases on 60 Fremont start points that the tuning never saw.

| Map | Median ground searched | Found within 0.5 km² |
|---|---|---|
| The first engine we built (Saturday) | 2.54 km² | 21% |
| Distance rings around the last-seen point | 1.30 km² | 39% |
| **FindThem's map now** | **0.99 km²** | **41%** |
| ISRID statistics map alone (upper bound) | 1.03 km² | 42% |

**Read this honestly: the map is a 95% / 5% blend.**
- FindThem's map mixes two things: a **statistics map** (published ISRID figures for how far people with dementia are found and at what kind of place, laid over the real ground) and **5,000 simulated walkers**.
- How much each counts was chosen by evaluation, not by hand, and it came out at **95% statistics map, 5% walkers**.
- The simulated "true" locations in this test are placed with those same published statistics. So the statistics map alone is the best any map can score here, and ours being level with it is **partly by construction**. It is not independent proof that the map is right.
- What the test does show: our first engine (walkers on streets only) was **worse than plain distance rings**, we measured that, and the rewrite is better than both.
- What the walkers are for: clues. A sighting, a searched area, a direction or a familiar place re-weighs whole walker paths, which a statistics table cannot do. That benefit is designed, not yet measured.

Full report with charts, calibration and sensitivity: [`bench/prior-report.md`](bench/prior-report.md).

### 2. Sending searchers: more people found

`npm run bench` (`bench/results.md`): 1,000 simulated cases, 6 volunteers searching 200 m areas in 20-minute turns, the share of people found.

| Strategy | Found after 1,500 searcher-minutes (about 6 people for 4 hours) |
|---|---|
| Volunteers searching on their own | 19% |
| Coordinated ring sweep (nearest areas first) | 28% |
| **FindThem's map deciding which area each searcher takes next** | **40%** |

**Read this honestly too: there are two benchmarks, and they don't say the same thing.**
- The table above measures the **area-by-area rule** (send each searcher to the area with the best chance per minute, and go back to likely areas). The simulated people come from a **different model** than the app's map (our first engine's walkers), so the app is not grading its own homework.
- The app's screen now uses the **route planner** (`engine/planner/`), which was benchmarked separately and more strictly (`bench/planner-report.md`: 4,000 cases, people placed from ISRID statistics, a ring sweep that keeps cycling instead of stopping after one pass). There the planner finds **25%** in 3 hours, against **24%** for the ring sweep and **20%** for volunteers on their own: about 5 points better than no coordination, and **level with a ring sweep**.
- So the honest summary is: coordination clearly beats everyone searching on their own in both tests; how much a smart plan beats a simple ring sweep depends on the test. What the planner adds beyond the numbers is a route per person from where they stand, safety rules (nobody sent into water, two people for creek edges, warnings for busy roads, rail and night) and no pile-ups.

### 3. The report box: tested on 150 reports it had never seen

Nathan wrote 150 reports in five languages (voice-style, mixed languages, second-hand, jokes, wrong person) without seeing the readers. Each reader was scored **once**, after all tuning (`bench/blind-2-results.md`).

| Reader | Fields right | Left empty for the person | Wrong | Dangerous mistakes |
|---|---|---|---|---|
| **Jev** (TypeSafe AI) + our safety layer | **85%** (479 of 564) | 77 | 8 | **3** |
| Backup reader on the phone (word rules, no AI) | 76% (429 of 564) | 95 | 40 | 7 |

- "Dangerous" means a wrong draft that could mislead a search if the person confirmed it without reading it.
- **Jev's 3 dangerous mistakes were all "two-in-one" reports** (one message holding two different sightings). That is a known gap.
- Every draft still goes through the confirm step, so a mistake reaches the map only if a person approves it.

### 4. Real cases: 161, held out

`docs/research/cases-public.csv` holds **161 verified real cases** of people with dementia who walked away and were found, collected from public news, police and coroner reports.

- They are used **only as a held-out check** (`bench/real-cases.js`), never to tune anything.
- What they showed us: real news-reported cases run longer and farther than the published urban statistics, and **29% of the deaths were in woods or brush**, which is why woods and brush are now a hazard class.
- The public file names no one: each source is given as publisher + month + an id. The copy with links is never committed.
- **Street-level scoring (18 cases where both points are known to the street): scored** (`node bench/real-cases-maps.js`, finished Nov 22, 2:29 AM; results in `bench/real-cases-maps.json`). 6 of the 18 found places were beyond the 3.2 km map. On the 12 that were on it, our map needed a median 1.10 km² of searching against 0.69 km² for plain rings, and beat rings in 4 of the 12. Twelve cases cannot rank methods, but it is a fair warning that long real cases are harder than simulated ones. Not yet written into `bench/prior-report.md`.

## How the prediction works

The map answers one question: **where is this person probably, this many minutes after they were last seen?** It is built the way a search planner works, from published statistics on lost people with dementia (Koester's *Lost Person Behavior*, the ISRID database), on the real ground around the last-seen point.

1. **A ground map.** OpenStreetMap is turned into 10 m squares: roads, paths, buildings, fences, rail lines, water, creeks and drainage channels, yards, parking lots, parks. Buildings, fences and rail can't be walked through; a road over a creek is a bridge.
2. **An ISRID statistics map.** In towns, a quarter of people with dementia are found within 0.3 km, half within 1.1 km, three quarters within 3.2 km. 35% are found at a structure, 36% on a road, 9% on a path, 6% in water, 4% in a drainage. Those two tables, limited by how far a person could have walked in the time so far, give every square a chance.
3. **5,000 simulated walkers.** Each has its own walking speed (0.62 ± 0.23 m/s, a published figure), its own share of time spent moving, and a kind: keeps one course, wanders, stays near buildings, or heads for a familiar place. A third keep to roads; the rest are willing to leave them. Where each walker is, minute by minute, is kept.
4. **Still missing.** A person walking a busy road for half an hour would probably have been noticed. Nobody has reported them, so walkers who spent long on busy roads count for less.
5. **The blend.** The map is the statistics map and the walkers together. How much each counts was set by evaluation, not by hand: 95% statistics map, 5% walkers. When the case lists familiar places, a quarter of the map goes to walkers heading there.
6. **Not on this map.** The map reaches 3.2 km. The chance that the person is beyond it is worked out and kept apart (near 0 in the first hour, about 23% after many hours), instead of being hidden.
7. **Updates from the search (Bayesian search theory).** When an area is searched and nobody is found, its chance drops by how likely the searchers were to spot the person there (1 − e^(−coverage), Koopman's formula), and everything else rises. On the screen that happens when a volunteer finishes a task ("Done, nobody found"): the task's planned search time is shared over the 200 m squares its route passes through, those squares fade and turn grey, and every phone on the search shows the same change. The engine knows when each search happened: a search doesn't count against someone who walked in afterwards. A sighting starts new walkers from that point, spreads as the minutes pass, and is blended in by how sure the reporter is.
8. **Where it's dangerous.** A second layer scores water, creeks and drainage channels, and woods and brush, by how likely the person is to be there. Spots and areas beside them say so: look from the bank, don't go in; check woods from the path.
9. **Who searches where (the planner, `engine/planner/`).** For each volunteer, from where they stand, it ranks up to three tasks (walk these streets, check this park, look at this creek from the bridge, knock on these doors) by the chance gained per minute including the walk there. A task someone has taken is not offered to anyone else. Safety rules come first: nobody is sent into water, creek stretches need two people, and busy roads, rail crossings and night are shown as warnings. Design: `docs/PLANNER.md`.

**Calibration.** The walkers' free numbers were fitted by `tools/calibrate.js` to the urban ISRID statistics on 24 Fremont start points, then checked on 24 others it never saw. On those: 26% / 50% / 81% found within 0.3 / 1.1 / 3.2 km (ISRID: 25 / 50 / 75), 38% at a structure (35), 38% on a road (36), 9% on a path (9), 5% in water (6), 8% in a drainage (4). It does **not** fit ISRID's mobility hours (the model's median is 2.7 h of mobility, ISRID's is 0.25 h): the two published samples disagree with each other at the published walking speed, and we fitted the larger one, distance. Every tunable number is labeled DATA, EXPERT or ASSUMPTION with its source in `engine/params.js` and `engine/prior.js`.

**Speed.** The engine runs in a background worker, so the page never freezes. A first map takes about 0.3 s on a laptop, and 0.9 to 1.5 s in Chrome with the processor slowed four times to stand in for a phone. The 5-minute clock tick takes a few milliseconds, or about a tenth of a second when it starts a new 15-minute block of walking.

**Two-phase download.** For a new area the first map appears from the streets alone; buildings and land use arrive in a second download and the map sharpens when they do.

The same case and seed always give the same map, so every phone computes the identical map by itself from the shared list of events. The grid is anchored to the case's last-seen point, so two phones always mean the same ground by the same area.

## Languages and units

- **Five languages:** English, Spanish, French, Simplified Chinese and Japanese. The app starts in your phone's language; switch with the language picker.
- **Units:** miles and feet in the US (and Liberia, Myanmar), kilometers and meters elsewhere. The **mi/km** button switches.
- **Emergency number:** the banner shows your country's number (911, 112, 999, 000, 110…).

The translations were written by AI and haven't been checked by native speakers yet.

## Who built what, and how AI was used

**Everything in this repo was made during the event**, between Nov 21, 9:00 AM and Nov 22, 12:00 PM PST. The open-source parts we used are listed under "Data and credits". The rules encourage AI use, and we used it heavily and say so.

| Who | Part | AI use |
|---|---|---|
| **BenStew** | Screen and hosting: the page, map, inputs, data loading, live sharing, messages, report box, offline mode, translations, the Cloudflare proxy, GitHub Pages | Built with Claude Code (Anthropic's AI coding assistant), with BenStew directing and reviewing. |
| **BenStew** | The first engine (Saturday): walkers on the street network, probability grid, Bayes updates, routes | Built with Claude Code, with BenStew directing. |
| **Nathan** | Tests, debugging, speed (`tests/`, `bench/`), and the benchmarks | Written with Claude Code; Nathan reviews them. |
| **Nathan** | Sunday's engine rewrite ("prior v2"): 10 m ground map, walkers as particles, ISRID statistics map, calibration, evaluation, hazard layer, the engine in a background worker | Built with Claude Code from Nathan's audit of the first engine, in four reviewed stages. |
| **Nathan** | The search planner (`engine/planner/`), event integrity (strict database rules, checked events on every phone), the report box's safety layer and its blind tests, the 161 real cases | Built with Claude Code in parallel sessions, one per part, merged at release. Claude Code also made the screen changes these needed (`UPDATESBYNATE.md` lists them for BenStew). |

**AI inside the app:** only the report box uses an AI: **Jev**, a model from TypeSafe AI, reached through our own small proxy.
- Jev doesn't write text. It answers five multiple-choice questions about a report (what kind, which way, how long ago, how sure, which nearby place), each with a confidence.
- Anything it isn't confident about is left empty for the person to fill in.
- A safety layer treats Jev as unreliable: it cross-checks every answer against the report's own words, leaves contradictions empty, and never lets a joke, a guess or a sighting of someone else become a sighting (`docs/AGENT-CONTRACT.md`).
- Nothing is added until the person checks the form and taps the button. Jev never sets a probability.
- If Jev can't answer, word rules on the phone fill in the same form.
- The proxy also has a route (`/say`) that can let a text AI re-word the app's short spoken lines, with a checker that holds every number, place and direction to the app's own data (`docs/REPLIES.md`; 720 bad replies tried, 0 got through). **The app does not call it: it uses the fixed, pre-written lines, and no key is set.**

`CommitHistory.md` records every commit and decision, including which work came from which session.

## Limits

**Not tested enough**
- **Publish the database rules before relying on the live link for a shared search.** Until BenStew publishes `firebase-rules.json`, the live database refuses "Done", "Stop", "Found" and corrections in a *shared* search (the phone says so: "Not shared..."). The Demo and any search that isn't shared work fully without it.
- **The merged app has not been run on a real phone.** Sunday's engine, the planner and the new buttons were checked in a laptop browser and by the automated tests. Saturday's version was tried on phones.
- Nothing has been validated on real searches. The map's test cases are drawn from the same published statistics the map is built from; both benchmarks are simulations.
- The translations (Spanish, French, Chinese, Japanese) were written by AI and have not been checked by native speakers.
- The stricter database rules (`firebase-rules.json`) passed Google's own rules emulator but are not published yet (see the first point).
- The deployed proxy needs redeploying to get the report box's safety layer.

**Not built yet**
- **A finished route fades the map by 200 m squares, not along the exact street.** The time planned for the route is shared over the squares it passes through; a square the route only clips (under a minute) is left alone. Until GPS trails are recorded, a route counts as walked as planned once "Done" is tapped.
- A finished route is credited from its planned line, not from where the searcher actually walked (recording a GPS trail is designed, not built).
- Everyone is planned as on foot (no car option), and the two-person creek checks only show "go with <name>": the pairing has not been tried by real people.
- The spoken step-by-step intake in `docs/INTAKE-SPEC.md` is a design. The app has the form, the report box, and the fixed "search leader" lines.

**The model**
- The statistics behind the map are published summaries (ISRID: 336 urban dementia cases for distance, 223 for where people were found), not case records.
- The model fits ISRID's distances but not its mobility hours (its median is 2.7 hours of walking, ISRID's is 0.25): the two published samples disagree with each other at the published walking speed, and we fitted distance.
- It uses ISRID's *urban* statistics everywhere. Real suburban and rural cases look different (more woods and water, fewer structures).
- The map reaches 3.2 km from the last-seen point. Beyond that the app only says how likely it is that the person is off the map. In our street-level real cases, 6 of 18 people were found beyond it.
- Elevation is not used, and the sea is not handled (on a coast it would be treated as plain ground).
- The report box's known gap is a message holding two different sightings.
- For a few minutes after starting a search in a new area, a phone still waiting for the buildings download shows a rougher map than one that has them.

**Safety and privacy**
- Untrained volunteers should not go into water, woods or dense brush; the app flags those and leaves them to professionals.
- Anyone with a search link can see and add to that search. There are no accounts. The rules stop malformed, edited, deleted and duplicated events, not lies: a made-up sighting is accepted like a true one.
- In a shared search, each phone's position and the name you typed go to our Firebase database, where anyone with the search link can see them.
- Report-box text leaves the phone and goes to TypeSafe (Jev), with nearby place names but no coordinates. Spoken reports also go to Google or Apple to be turned into text, or to Deepgram when the voice keys are set. The app asks people to leave out names and medical details. The backup reader runs on the phone and sends nothing.
- Browser GPS only works while the page is open. Voice input needs signal.
- The map grows with time in 5-minute steps, so it can be up to 5 minutes behind.

Future plans are in `ROADMAP.md`. None of them are in the app, and there are no placeholder buttons for them.

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout: emergency banner, map, panel with inputs and results |
| `style.css` | How it looks: mobile-first, big buttons, high contrast for outdoors |
| `app.js` | Runs the page: taps and inputs, drawing the map, areas and routes, sightings, sharing, messages, hand-off sheet, report box, offline and home area. The demo case is at the top |
| `data.js` | Streets and creeks from OpenStreetMap (Overpass), address search (Nominatim), saving areas in the browser (IndexedDB) |
| `sync.js` | Live sharing through Firebase's web API: the case, events and messages; an offline queue |
| `report.js` | Report box logic: voice input, sending to the proxy, checking the answer |
| `replies.js` | The short lines the app says back (fixed templates in 5 languages) and the checker for any AI-worded version |
| `quickread.js` | The report box's backup reader: simple word rules in 5 languages, used on the phone when Jev can't answer |
| `i18n.js` | Every on-screen word in 5 languages, emergency numbers, units |
| `config.js` | The Firebase and proxy addresses (not secrets) |
| `engine/` | The prediction engine: `graph.js` (street network, nearby creeks/parks), `surface.js` (10 m ground map), `sim.js` (walkers), `prior.js` (ISRID statistics map), `grid.js` (probability map, Bayes updates, hazard layer, next areas, top spots), `routes.js` (walking routes), `params.js` (every tunable number, labeled), `calibrated.js` / `.json` (fitted values, written by `tools/calibrate.js`), `host.js` + `worker.js` (the engine in a background worker), `planner/` (who searches where: tasks, routes, safety rules), `index.js` (what the app imports) |
| `sw.js`, `manifest.json`, `icons/` | Offline mode and installing to the home screen |
| `lib/` | Leaflet (map), stored here rather than loaded from the internet |
| `proxy/` | Tiny Cloudflare Worker that holds the API keys as secrets: asks Jev about a report and cross-checks the answers (`jev.js`), returns form data only; the `/say` route (`say.js`); optional voice bot with Deepgram and ElevenLabs (`voice.js`) |
| `firebase-rules.json` | Database rules: no listing searches, only known event shapes, events can only be added, the case written once, searcher positions checked |
| `tests/` | `node --test` tests; `tests/fixtures/demo-area.json` is real Fremont street data, used by the Demo and the engine tests |
| `bench/` | `prior-eval.js` + `prior-report.js` (the evaluation of the map: `prior-report.md`, `prior-report.html`), `real-cases.js` + `real-cases-maps.js` (the check against real cases), `benchmark.js` (the search simulation) and `results.md` (its latest output), `planner-eval.js` + `planner-report.md` (the planner's own benchmark), `eval.js` + `blind-2.json` + `blind-2-results.md` (the report box on 150 unseen reports), `safety-eval.js` (adversarial reports), `phone-budget.js` (time and memory), `old-engine/` (a frozen copy of the first engine, for comparison only) |
| `tools/` | `calibrate.js` (fits the walkers to ISRID), `make-public-cases.js` (makes the public copy of the real-case data), `make-fixture.js` (rebuild the Fremont data), `data/fremont-wide.json.gz` (a wider Fremont map for calibration and evaluation; never loaded by the app), `browser/` (checks that drive a headless Chrome), `mock-firebase.py` and `mock-proxy.py` (local stand-ins for testing), `make-icons.py` |
| `ShortPlan.md`, `PLAN.md`, `INTERFACES.md`, `CommitHistory.md`, `ROADMAP.md` | Plans, the engine contract, the decision log, and future plans |
| `docs/` | Design notes: `PRIOR-V2.md` (the map), `PLANNER.md` (who searches where), `AGENT-CONTRACT.md` (what the AI may read or propose), `REPLIES.md`, `INTEGRITY-REPORT.md` (database rules), `INTAKE-SPEC.md` |
| `BEN.md`, `UPDATESBYNATE.md` | What Nathan's work changed in BenStew's screen files, and what is left for him |
| `docs/research/` | 161 real news-reported cases: `cases-public.csv` (sources given as publisher + month + an id; the copy with URLs is never committed), `REPORT.md`, `DATA_DICTIONARY.md`, `CASES-PUBLIC.md` |

No frameworks and no build step: plain HTML, CSS and JavaScript. The only online parts are the Firebase database (sharing) and the small proxy (report box, optional voice). The prediction always runs on the phone.

## Testing notes

- **Offline:** load the app once, stop the server (Ctrl+C) and reload. The app still opens and the Demo still runs.
- **While developing:** the offline worker serves saved copies first, so after editing a file, reload twice. Bump `CACHE_VERSION` at the top of `sw.js` whenever app files change.
- **Two tabs on one search without Firebase:** `python3 tools/mock-firebase.py`, then open http://localhost:8000/?db=http://localhost:9000 in two tabs, run the Demo in one, tap **Share this search** and open the link in the other.
- **Re-run the numbers:** `npm run bench` (searchers), `npm run planner-eval` (planner), `node bench/prior-eval.js` then `node bench/prior-report.js` (the map), `node bench/eval.js --set blind-2 --reader local --final --by` (backup reader), `node bench/real-cases.js` (real cases).

## More setup (only if you want your own copy online)

The 3 commands at the top are all a judge needs. The sections below are for running your own database, proxy and site.

## Set up live sharing (Firebase)

Live sharing (one map for every searcher, messages, searched areas) needs a free Firebase Realtime Database. Without it the app still works: searches stay on one phone, and share links carry the starting map in the link itself.

1. Go to https://console.firebase.google.com, sign in, and click **Create a project**. Analytics isn't needed.
2. In the project, open **Build → Realtime Database → Create database**. Pick a US location and start in **locked mode**.
3. Open the **Rules** tab, replace everything with the contents of `firebase-rules.json`, and click **Publish**. The rules make sure that:
   - nobody can list searches; you need the 32-character id from a link
   - a search's case can be written once
   - events must be one of the known shapes, and can only be added, never changed or deleted
   - each searcher's position (`searchers/`) must be a plain lat/lng/time/name, and each phone overwrites only its own
4. Copy the database URL shown at the top of the **Data** tab (like `https://findthem-12345-default-rtdb.firebaseio.com`) into `FIREBASE_DB_URL` in `config.js`, then commit.

The URL isn't a secret, so it's fine in the repo. No API key is needed.

## Set up the report box (AI proxy)

Follow `proxy/README.md`: a free Cloudflare account, a TypeSafe API key for Jev stored as a Worker secret, then `wrangler deploy`. Put the Worker's address in `PROXY_URL` in `config.js`, and set `ALLOWED_ORIGIN` in `proxy/wrangler.toml` to your site's address before the demo. For the voice bot, also set `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` the same way (optional; without them, voice works as before). **Never put any API key in the website or the repo**; for local testing they go in `proxy/.dev.vars`, which git ignores.

**The `/say` route (optional):** with no `LLM_API_KEY` secret the app uses its fixed, pre-written lines, which is how it runs today. `docs/REPLIES.md` explains what a key would turn on.

**Testing without a Jev key:** the backup reader works with no proxy at all. To test the proxy path, run `python3 tools/mock-proxy.py`, then open http://localhost:8000/?proxy=http://localhost:9100. It fills in forms with simple English keyword rules instead of Jev.

**Scoring the report box:** `npm run jev-eval -- --local` scores the backup reader on 40 realistic reports in all five languages; `npm run jev-eval` scores Jev through the live proxy (needs the TypeSafe key). Add `--show` to list the misses.

## Deploy for free with GitHub Pages

GitHub Pages gives you a free HTTPS address, which offline mode needs. On a free account the repository must be public.

This repo is already deployed at **https://donaldstewart4.github.io/FindThem/**. Pushing to `main` updates it within a minute or two. To deploy your own copy:

1. On GitHub, open the repository's **Settings → General → Danger Zone → Change visibility** and make it public.
2. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, and click **Save**.
3. After a minute or two the site is live at `https://<your-username>.github.io/FindThem/`.

After changing the app, bump `CACHE_VERSION` at the top of `sw.js` so phones pick up the new files.

## Data and credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.
- Map tiles from OpenStreetMap. The app follows the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): it only saves tiles you have actually looked at and never downloads tiles in bulk.
- Street and terrain data from the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API).
- Address search from [Nominatim](https://nominatim.org/), one request at a time.
- Map library: [Leaflet](https://leafletjs.com/).
- Real cases for the held-out check: public news, police and coroner reports from the US, UK, Canada, Australia and New Zealand, cited in `docs/research/cases-public.csv` by publisher and month.
- Lost-person statistics: Robert Koester, *Lost Person Behavior*, dementia chapter (ISRID): distances, find locations, track offset, dispersion angle, mobility, "66% cross or depart from a road" (https://www.dbs-sar.com/LPB/Dementia.pdf).
- Walking speed: Toots, Taylor, Lord, Close (2019), *J Alzheimers Dis* 71(s1): usual gait speed 0.62 ± 0.23 m/s in 309 older adults with cognitive impairment.
- Rowe et al. (2011), *BMC Geriatrics* 11:28, on people with dementia missing in the community (53% of those on foot found within 1 mile; deaths mostly in unpopulated areas).
- Scoring: Sava, Twardy, Koester, Sonwalkar (2016), "Evaluating Lost Person Behavior Models", *Transactions in GIS* 20(1).
- Search theory: B. O. Koopman's detection model and Bayesian search theory; sweep widths from Koester, Cooper, Frost, Robe (2004), "Sweep Width Estimation for Ground Search and Rescue".
- Terrain speed factors from Soule and Goldman (1972), *J Appl Physiol* 32(5).
