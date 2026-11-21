# FindThem

> **New here? Read [ShortPlan.md](ShortPlan.md) first** (2 minutes). It's the current summary; the rest of this README is being updated to match.

**If someone is missing, call emergency services first (911 in the US).** FindThem helps a search get organized. It does not replace the police or search-and-rescue.

FindThem is a phone-first website for families looking for a person with dementia who has wandered away. You drop a pin where the person was last seen and answer a few questions. The app then simulates 5,000 "virtual walkers" on the real street map, based on search-and-rescue research about how people with dementia move when they're lost. It shows:

- a **heatmap** of where the person is most likely to be,
- **streets colored** by how many walkers used them,
- **distance rings** at 0.5, 1 and 1.5 miles,
- a **"Check these first"** list of the 8 most likely spots, with a reason for each (for example, "Creek 130 ft off Main St – 12% of walkers").

This is a guide to help focus the search, not a guarantee.

> Status: hackathon project, being built in stages. Sections below describe the finished app.

## How the prediction works

The simulation follows a few patterns that show up again and again in search-and-rescue case studies of lost people with dementia:

- **They walk in a straight line until they get stuck.** At each intersection, walkers strongly prefer to keep going straight, and they stop at dead ends.
- **Most are found close by.** The median distance from the last-seen point is about 0.88 km (0.55 mi), and about 89% are found within 1 mile. Each walker gets a random "give up" distance that matches this.
- **They're usually found just off the road.** If a walker stops within 30 m (100 ft) of a creek, drainage ditch, brush, woods or water, there's a 60% chance it ends up in that feature.
- **Familiar places pull.** An old home, old job or church nudges walkers toward it.
- **Speed matters.** Normal walking, slow walking, or using a walker/cane changes how far they can get in the time since they were last seen.

The same inputs always give the same map (the random numbers are "seeded"), so a shared link shows everyone the exact same prediction.

All the tuning numbers sit at the top of `sim.js` with comments, so they're easy to adjust.

## Using it

1. Tap **Set last seen**, then tap the map where the person was last seen.
2. Enter how many minutes ago that was.
3. Optional: pick the direction they were heading, their mobility, and up to 3 familiar places (tap the map for each).
4. Tap **Run search prediction**.
5. Tap any spot in **Check these first** to zoom to it.

Other buttons:

- **Demo** fills in sample inputs and runs the prediction in one tap.
- **Share** creates a link with all the inputs. On phones it opens the share sheet; otherwise it copies the link.
- **Save my home area** downloads the street data around an address, a tapped point, or your current location, so the app works there later with no signal. Caregivers can set this up ahead of time.
- **Copy summary for police** copies a plain-text summary: last-seen point and time, inputs, and the top spots with coordinates.
- Tap a colored street to mark it **searched**. This is saved on your phone only.
- Your own location shows as a blue dot. GPS works without cell service.

## Languages and units

- English, Spanish, French, Simplified Chinese and Japanese. The app starts in your phone's language, and you can change it with the language picker.
- Distances use your phone's region: miles and feet in the US, kilometers and meters elsewhere. The **mi/km** button switches between them.
- The emergency banner shows your country's emergency number (911, 112, 999, 000, and so on) as a tap-to-call link.

The translations haven't been checked by native speakers yet.

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout: emergency banner, map, input panel, results panel and buttons |
| `style.css` | How it looks. Mobile-first, with big buttons and high contrast for reading outdoors |
| `app.js` | Runs the page: handles taps and inputs, draws everything on the map, sharing, GPS dot, offline message. The demo location is a constant at the top |
| `sim.js` | The simulation. No page code, just math, so it can be tested and tuned on its own |
| `data.js` | Downloads streets and terrain from OpenStreetMap (Overpass API), builds the street graph, and saves data in the browser (IndexedDB) for offline use |
| `i18n.js` | All the text in every language, the emergency-number table, and distance formatting |
| `sw.js` | The service worker. Saves the app and map tiles you've viewed so it loads instantly and works offline |
| `manifest.json` | Lets you install the site to your home screen like an app |
| `icons/` | App icons |
| `lib/` | Leaflet (the map) and Leaflet.heat (the heatmap), stored in the project instead of loaded from the internet |
| `ROADMAP.md` | Future plans that aren't built yet |

No frameworks, no build step, no backend. It's plain HTML, CSS and JavaScript.

## Run it locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Service workers (the offline part) only work on `localhost` or over HTTPS. Opening `index.html` directly as a file won't work.

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

**Testing without Firebase:** run the mock database and open two tabs with `?db=`:

```bash
python3 tools/mock-firebase.py
```

Then open http://localhost:8000/?db=http://localhost:9000 in two tabs. Run the Demo in one, tap **Share this search**, and open the link in the other.

## Deploy for free with GitHub Pages

GitHub Pages gives you a free HTTPS address, which the offline features need.

1. Create a new public repository on GitHub, for example `findthem`.
2. Push this folder to it:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/findthem.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub, open the repository's **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, and click **Save**.
5. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/findthem/`.

After changing the app, bump the cache version at the top of `sw.js` so phones pick up the new files.

## Data and credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.
- Map tiles from OpenStreetMap. The app follows the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): it only saves tiles you have actually looked at and never downloads tiles in bulk.
- Street and terrain data from the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API).
- Address search from [Nominatim](https://nominatim.org/), one request at a time.
- Map library: [Leaflet](https://leafletjs.com/). Heatmap: [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat).
- The behavior patterns come from published search-and-rescue research on lost persons with dementia, including Robert Koester's lost-person behavior studies.
