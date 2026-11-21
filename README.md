# FindThem

> **New here? Read [ShortPlan.md](ShortPlan.md) first** (2 minutes). Then `PLAN.md` (full plan), `INTERFACES.md` (screen ↔ engine contract) and `CommitHistory.md` (every decision and commit).

**If someone is missing, call emergency services first (911 in the US).** FindThem helps a search get organized. It does not replace the police or search-and-rescue.

FindThem is a phone app (a website you can install) for the first hour after a person with dementia goes missing, for the family and neighbors who start looking before professionals arrive. It tells them where to look first, gives each searcher an area and a walking route, keeps everyone on one live map, and updates the map as places come up empty or someone reports a sighting.

This is a guide to help focus the search, not a guarantee.

Built for EvoHacks II (theme: social good).

> **Status (Nov 21, 2026, evening):** everything runs on the real engine (`engine/`): 5,000 simulated walkers on Fremont's real streets, the Bayesian probability map, next areas with walking routes, and top spots. Live sharing and the report box work against local test servers; the real Firebase database and Jev proxy still need their accounts set up (steps below). The benchmark is done (below).

## What it does

0. **Call 911 first.** The red banner is always on screen and is a tap-to-call link with your country's emergency number. "First steps" also has a script of what to tell the dispatcher.
1. **Check the house and yard.** A 2-minute checklist: closets, under beds, bathrooms, garage, parked cars, shed, neighbors' yards. In search-and-rescue data, many are found close to home or even inside it.
2. **Enter what you know.** Tap the map where they were last seen, then add minutes since, the direction they were heading, how they walk (normal / slowly / walker or cane), and up to 3 familiar places (old home, old job, church).
3. **See the map.**
   - a heatmap of where they most likely are
   - streets colored by how many simulated walkers used them
   - dashed rings at 0.5, 1 and 1.5 miles
   - **Check these first:** the top 3 places (8 when expanded), each with a reason such as "Creek 130 ft off Main St – 12% of walkers". Water and wetland spots are marked "leave this to professionals".
4. **Next areas to search.** Areas A, B and C are the best places for the next searcher, each with its chance and a walking route. Open one, search it, and tap **Searched, nobody found** with the minutes spent.
5. **Share the search.** Enter your name and tap **Share this search**. Everyone who opens the link sees the same live map: searched areas, sightings and messages appear for everyone within about a second.
6. **Report a sighting**, either:
   - on the map: tap where they were seen, then say how long ago, which way, how sure, and any details, or
   - in the **report box**: type or speak ("saw a man in a blue coat by the lake 10 minutes ago, heading east") and an AI fills in the form. **Nothing is added until you check it and tap the button.**
7. **Messages** between everyone on the search.
8. **Hand-off sheet for police:** last seen, how they walk, a timeline of everything searched and seen, the most likely places still to check (with coordinates), and the live link. You can copy or print it. A non-English sheet includes an English copy.

**Before an emergency:** "Save my home area" stores the streets around home on the phone (find it by address, map tap or GPS), so the app works there even with no signal.

**Anytime:** the ◎ button shows your own position as a blue dot (GPS works without cell signal). **Demo** runs a sample case in Fremont, CA in one tap.

## How the prediction works

1. **Simulated walkers.** 5,000 virtual walkers start where the person was last seen and move along the real OpenStreetMap streets, following patterns from search-and-rescue studies of lost people with dementia:
   - **They walk in a straight line until they get stuck.** They strongly prefer going straight at intersections and stop at dead ends.
   - **Most are found close by:** a median of about 0.8 km from the last-seen point, about 89% within 1 mile. Each walker gets a random "give up" distance that matches this.
   - **They're usually found just off the road.** A walker that stops within 30 m of a creek, drainage, brush, woods or water usually ends up in it.
   - **Familiar places pull, and speed matters** (normal, slow, or with a walker or cane).
2. **A probability map.** Where the walkers stop becomes the starting map on a grid of 25 m squares.
3. **Updates from the search (Bayesian search theory).** When an area is searched and nobody is found, its chance drops by how likely the searchers were to spot the person there (1 − e^(−coverage), Koopman's formula), and every other area rises. A sighting reruns walkers from where they were seen and blends that in, weighted by how sure the person is.
4. **What to search next.** Each searcher's next area is the one where their minutes add the most chance of finding the person.

**Calibration check.** The research numbers are straight-line distances, but people walk along winding streets. On the Fremont map, over five different start points with no time limit, the walkers end up a median of about **0.74 km** away in a straight line, with about **89% within 1 mile**. The research says ~0.8 km and 89%. `tests/engine.test.js` re-checks this every time the tests run.

**Speed.** A full prediction takes about 0.1 s on a laptop. After a search or sighting, the update takes a fraction of a second.

The same case and seed always give the same map, so every phone computes the identical map by itself from the shared list of events. All the tuning numbers are named constants at the top of the engine files.

## Benchmark

Does FindThem help volunteers find someone sooner? We simulated **1,000 cases** on the Fremont map: 5 start points, direction known or unknown, 100 people each. A team of **6 volunteers** searches 200 m areas in 20-minute turns. A search finds the person, if they're there, with the same detection formula the app uses. The share of cases found:

| Strategy | Found after 500 searcher-min | Found after 1,500 searcher-min | Found after 3,000 searcher-min |
|---|---|---|---|
| Volunteers searching on their own | 8% ±2 | 21% ±3 | 34% ±3 |
| Coordinated ring sweep | 18% ±2 | 29% ±3 | 35% ±3 |
| **FindThem allocation** | **31% ±3** | **54% ±3** | **70% ±3** |
| **FindThem + one sighting** | **52% ±3** | **77% ±3** | **87% ±2** |

- **On their own:** each volunteer picks nearby areas at random, with no shared record.
- **Ring sweep:** coordinated, nearest areas first, each searched once.
- **FindThem:** the app's plan, the most chance gained per minute, updated after every empty search.
- **+ sighting:** one neighbor's sighting reported after the first turn, seen on the way about 100 m off, with direction and time, marked "probably".

1,500 searcher-minutes is about 6 volunteers for 4 hours. ± is a 95% margin.

**Limits:** the simulated "real" people come from our own walker model, run with different settings than the app assumes (twistier or straighter walking, giving up sooner or later). Real people and real searches are messier. This shows how much a shared record and the probability map *could* help; it is not field-tested. The ring sweep searches each area only once, which is why it levels off.

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
| **BenStew** | The engine (`engine/`): walkers, probability grid, Bayes updates, allocation, routes | Built with Claude Code, with BenStew directing. The official EvoHacks 2 rules encourage AI use. |
| **Nathan** | Tests, debugging, speed (`tests/`, `bench/`); tuning the Jev questions | AI may help write tests; Nathan reviews and explains them. |

**AI inside the app:** only the report box uses an AI: **Jev**, a model from TypeSafe AI, reached through our own small proxy. Jev doesn't write text; it answers five multiple-choice questions about a report (what kind, which way, how long ago, how sure, which nearby place), each with a confidence. Anything it isn't confident about is left empty for the person to fill in, and nothing is added until the person checks the form and taps the button. It never sets the probabilities, and the word "chatbot" never appears in the app.

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
| `i18n.js` | Every on-screen word in 5 languages, emergency numbers, units |
| `config.js` | The Firebase and proxy addresses (not secrets) |
| `engine/` | The prediction engine: `graph.js` (street network, nearby creeks/parks), `sim.js` (walkers), `grid.js` (probability map, Bayes updates, next areas, top spots), `routes.js` (walking routes), `index.js` (what the app imports) |
| `sw.js`, `manifest.json`, `icons/` | Offline mode and installing to the home screen |
| `lib/` | Leaflet (map) and Leaflet.heat (heatmap), stored here rather than loaded from the internet |
| `proxy/` | Tiny Cloudflare Worker that holds the Jev (TypeSafe) key, asks Jev about a report (`jev.js`), and returns form data only |
| `firebase-rules.json` | Database rules: no listing searches, events can only be added |
| `tests/` | `node --test` tests; `tests/fixtures/demo-area.json` is real Fremont street data, used by the Demo and the engine tests |
| `bench/` | `benchmark.js` (the search simulation above) and `results.md` (its latest output) |
| `tools/` | `make-fixture.js` (rebuild the Fremont data), `mock-firebase.py` and `mock-proxy.py` (local stand-ins for testing), `make-icons.py` |
| `ShortPlan.md`, `PLAN.md`, `INTERFACES.md`, `CommitHistory.md`, `ROADMAP.md` | Plans, the engine contract, the decision log, and future plans |

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

To test offline mode: load the app twice (the second load is the first one the offline worker controls), run the Demo, then stop the server (Ctrl+C) and reload. The app still opens and the Demo still runs. The yellow "You're offline – using saved data" line appears when the phone itself has no signal.

**While developing:** the offline worker serves saved copies first, so after you edit a file, reload twice to see the change. Bump `CACHE_VERSION` at the top of `sw.js` whenever app files change, so phones pick up the new version.

## Set up live sharing (Firebase)

Live sharing (one map for every searcher, messages, searched areas) needs a free Firebase Realtime Database. Without it the app still works: searches stay on one phone, and share links carry the starting map in the link itself.

1. Go to https://console.firebase.google.com, sign in, and click **Create a project**. Analytics isn't needed.
2. In the project, open **Build → Realtime Database → Create database**. Pick a US location and start in **locked mode**.
3. Open the **Rules** tab, replace everything with the contents of `firebase-rules.json`, and click **Publish**. The rules make sure that:
   - nobody can list searches; you need the 32-character id from a link
   - a search's case can be written once
   - events can only be added, never changed or deleted
4. Copy the database URL shown at the top of the **Data** tab (like `https://findthem-12345-default-rtdb.firebaseio.com`) into `FIREBASE_DB_URL` in `config.js`, then commit.

The URL isn't a secret, so it's fine in the repo. No API key is needed.

**Testing without Firebase:** run the mock database, then open two tabs with `?db=`:

```bash
python3 tools/mock-firebase.py
```

Open http://localhost:8000/?db=http://localhost:9000 in two tabs. Run the Demo in one, tap **Share this search**, and open the link in the other.

## Set up the report box (AI proxy)

Follow `proxy/README.md`: a free Cloudflare account, a TypeSafe API key for Jev stored as a Worker secret, then `wrangler deploy`. Put the Worker's address in `PROXY_URL` in `config.js`, and set `ALLOWED_ORIGIN` in `proxy/wrangler.toml` to your site's address before the demo. **Never put the TypeSafe key in the website or the repo.**

**Testing without a Jev key:** `python3 tools/mock-proxy.py`, then open http://localhost:8000/?proxy=http://localhost:9100. It fills in forms with simple keyword rules instead of Jev.

## Deploy for free with GitHub Pages

GitHub Pages gives you a free HTTPS address, which offline mode needs. On a free account the repository must be public.

1. On GitHub, open the repository's **Settings → General → Danger Zone → Change visibility** and make it public.
2. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, and click **Save**.
3. After a minute or two the site is live at `https://<your-username>.github.io/FindThem/`.

After changing the app, bump `CACHE_VERSION` at the top of `sw.js` so phones pick up the new files.

## Limits

- The search-and-rescue data behind the patterns is small, old and mostly rural (87 Virginia cases in Koester's study).
- Nothing has been validated on real searches; the benchmark is a simulation.
- Untrained volunteers should not go into water or dense brush; the app flags those for professionals.
- Browser GPS only works while the page is open.
- Anyone with a search link can see and add to that search. There are no accounts yet.
- Report-box text leaves the phone and goes to an AI service; the app asks people to leave out names and medical details.
- The map doesn't grow with time after the search starts (the minutes are fixed when the search is created).

## Data and credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.
- Map tiles from OpenStreetMap. The app follows the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): it only saves tiles you have actually looked at and never downloads tiles in bulk.
- Street and terrain data from the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API).
- Address search from [Nominatim](https://nominatim.org/), one request at a time.
- Map library: [Leaflet](https://leafletjs.com/). Heatmap: [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat).
- Behavior patterns from published search-and-rescue research on lost persons with dementia, including Robert Koester's lost-person behavior studies. Search theory: B. O. Koopman's detection model and Bayesian search theory.
