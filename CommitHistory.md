# Commit History

A detailed log of every commit, for people and AI agents who don't have the chat history behind this project. `git log` gives one-line titles; this file explains what changed, why, what was decided, and what's left.

**Read `ShortPlan.md` first** (2 minutes) if you're picking up the project cold, then this file and `PLAN.md`. Then read `README.md` (what the app is) and `ROADMAP.md` (what's deliberately not built).

## How to add an entry

Every commit adds an entry to this file **in the same commit**. Newest entry goes at the top of the Log.

- A commit can't contain its own hash, so the entry header uses the commit title. Find the hash with `git log --oneline --grep "<title>"`.
- Write for someone with zero context: name the files, say why, record decisions and the alternatives that were rejected, and be honest about what wasn't tested or is still broken.
- If a later commit changes a decision recorded here, add a new entry saying so. Don't rewrite old entries.
- Work that isn't committed yet goes under **Uncommitted**. Move it into a proper entry when it's committed.

Template:

```markdown
### <commit title>
- **Date:** YYYY-MM-DD
- **Stage:** <build stage, e.g. Stage 2: Data>
- **What changed:** <files and what each change does>
- **Why:** <the reason or request behind it>
- **Decisions:** <choices made and alternatives rejected>
- **How it was verified:** <what was run or checked, and the result>
- **Known issues / not done:** <bugs, gaps, things not tested>
- **Next:** <what the following commit should tackle>
```

## Project context

Current decisions. Updated 2026-11-21 after merging the team's planning doc ("Components of What We're Going to Build") into `PLAN.md`. `PLAN.md` has the full plan; this section overrides the original prompt where they differ.

- **What it is:** FindThem, a phone-first PWA for the first hour after a person with dementia goes missing. Simulated walkers on the real OpenStreetMap street graph give a starting probability map on a 25 m grid. Searchers join by share link and each gets a sector and a walking route. A shared message feed and a voice/text report box keep everyone in touch. Each empty search and each confirmed sighting updates the map with Bayesian search theory, live on every phone. A hand-off sheet goes to police at the end.
- **Event:** EvoHacks II, theme social good. **Deadline Sun Nov 22, 2026, 12:00 pm**; code freeze 9:30 am; submit by 11:00 am. The rules say AI may not build the whole project, each person explains their own code on video, and AI use is disclosed.
- **Team (corrected 2026-11-21 afternoon):** two people.
  - **BenStew** (repo owner): screen + hosting, with AI help, **and the engine (`engine/`), hand-written**. AI must not write engine code.
  - **Nathan:** tests, debugging, speed (`tests/`, `bench/`) and tuning the Jev questions. AI may help write tests.
  - **"Jev" is not a person.** It's TypeSafe AI's Jev model, used only in the report box (`proxy/jev.js`).
  - `INTERFACES.md` is the contract; changes need both to agree.
- **Tech:**
  - plain HTML/CSS/vanilla JS, no frameworks, no build step
  - Leaflet 1.9.4 + Leaflet.heat 0.2.0 in `/lib`
  - OSM tiles; Overpass for streets and terrain; IndexedDB cache; service worker
  - Firebase Realtime Database through REST (no SDK) for the case, events and messages, with Supabase as the fallback
  - a Cloudflare Worker holding the Jev (TypeSafe) key for the report box; no FastAPI or other server
  - the prediction runs on the phone; tests use `node --test`
- **Must-haves by the deadline:** engine + tests, map + inputs, shared searched areas, routes for searchers, sightings, messaging, the voice/text report box, share link, police hand-off sheet, offline PWA, all 5 languages (en/es/fr/zh/ja), Demo button.
- **Report box rules:** never called a "chatbot" in the UI. Jev answers multiple-choice questions about the text (low-confidence answers left empty) to make a draft; the person confirms before it becomes an event; the LLM never sets probabilities; the manual form is the fallback and works offline.
- **Required, after the core works: the benchmark.** Simulated wanderers; uncoordinated volunteers vs. coordinated ring sweep vs. FindThem allocation; a results table in the README.
- **Demo and tuning area: Fremont, CA**, around Central Park / Lake Elizabeth (~37.553, −121.970). It replaces Austin. Checked against Overpass: 3,408 walkable ways and 85 trap features within 1 mile. `waterway=pressurised` (underground pipes) must be skipped.
- **Kept from the first planning round:**
  - **Units:** the phone's region decides (US, Liberia, Myanmar → miles/feet; elsewhere km/m), with a mi/km toggle. Rings are always 0.5/1/1.5 mi on the ground.
  - **Emergency banner:** the local number from a country table (default 911), tap-to-call, can't be dismissed.
  - **Save my home area:** from an address search (Nominatim), a map tap, or GPS.
  - **Deploy:** GitHub Pages by default, pending BenStew's research. The repo is private now and must go public before deploying there.
- **Replaced:** "mark streets searched" and "copy summary for police" (the old stretch goals) became syncing sectors/routes and the hand-off sheet. The "no Claude in the repo" rule is dropped: AI tools are disclosed openly and `CLAUDE.md` is committed.
- **Do not build** a chatbot persona, camera integration, trackers, GPS-trail coverage, drill mode, accounts or photos, or anything else on the roadmap.

## Log

### Jev is TypeSafe's AI model, not a teammate: report box switches from DeepSeek to Jev; BenStew hand-writes the engine

- **Date:** 2026-11-21
- **Stage:** Decision change + report box
- **What changed:**
  - `proxy/jev.js` (new): `buildJevRequest()` sends one request with five questions:
    - `kind` choice: sighting / searched / message
    - `direction` choice: N…NW / unknown
    - `minutes` choice: 0/5/10/15/30/60/unknown
    - `sure` score: 3 levels → reliability 0.3/0.6/0.9
    - `place` choice: nearby place names + none
    The state holds the report, its language and the place names; coordinates are not sent to Jev.
  - `proxy/jev.js` also has `jevToDraft()`, which maps the answers to a `ReportDraft`:
    - **any answer below `MIN_CONFIDENCE` (0.5) is left empty for the person to fill in**
    - an unsure `kind` becomes a sighting with only the note filled
    - `note` is the report text itself, since Jev can't write text
    - the chosen place's coordinates become `lat`/`lng`
    `cleanPlaces()` dedupes and caps at 60.
  - `proxy/worker.js`: the DeepSeek call is replaced by `askJev()` (`POST https://api.typesafe.ai/v1/systemone`, `Bearer env.TYPESAFE_API_KEY`, model `jev-latest`, one retry on 429/529). The request/response contract, origin check, rate limit and `validateDraft` are unchanged.
  - `proxy/wrangler.toml`, `proxy/README.md`: the TypeSafe key secret, deploy steps, privacy (TypeSafe, a US company; coordinates not sent), and a multilingual curl test.
  - `report.js`: context is now `places: [{name, lat, lng}]` (≤ 60) instead of `streetNames`.
  - `app.js`: `nearbyStreetNames()` → `nearbyPlaces()`, which returns named streets **and** named creeks, parks and lakes, nearest to the last-seen point first.
  - `tools/mock-proxy.py`: matches place names from `context.places` → lat/lng; the wording no longer mentions DeepSeek.
  - `sw.js`: `CACHE_VERSION` → v5. `.gitignore`: ignores `__pycache__/`.
  - `tests/jev.test.js` (new, 8 tests): place cleaning, request shape (no coordinates sent), confident → full draft, low confidence → empty fields, unsure kind, unknown/none, the worker calling Jev with the key and retrying once on 529, and no key → 500 / wrong origin → 403. `fetch` is faked.
  - `CLAUDE.md`, `PLAN.md`, `ShortPlan.md`, `INTERFACES.md`, `README.md`, `config.js`: the team is now BenStew + Nathan; BenStew owns the hand-written engine; the report box uses Jev; DeepSeek is removed; no FastAPI.
  - This file: "Project context" team and tech bullets updated; this entry.
- **Why:** BenStew clarified that "Jev" in the team doc is an AI model (TypeSafe AI, Wikipedia "Jev (AI model)"), not a person. Every doc had assigned the engine to "Jev".
- **Decisions:**
  - **Jev goes in the report box**, its natural fit (typed multiple-choice answers with calibrated confidence), not in the engine. The map math stays hand-written and the LLM never sets probabilities, which keeps the "non-LLM core" and the benchmark story.
  - **BenStew hand-writes the engine**, with Claude only explaining, suggesting tests and reviewing. This follows the EvoHacks rule that AI may not build the whole project.
  - **No FastAPI.** The engine stays JavaScript on the phone so offline works; Jev is called from the existing Cloudflare Worker.
  - The confidence gate is the "knows when not to act" behavior the game plan recommends.
- **How it was verified:**
  - `node --test`: 22/22 pass (8 new Jev tests).
  - In the browser with the mock proxy, the Demo report "I think I saw her on Ralston Common 10 min ago heading east" sent 60 nearby places, nearest first (Plumas Way, Placer Way, Tehama Avenue…), including creeks and parks; the draft pinned to Ralston Common with 10 minutes.
- **Known issues / not done:**
  - **Not tested against the real Jev API:** it needs a TypeSafe key (paid, no free tier listed).
  - Jev's language support isn't documented, so check non-English reports with the curl test after deploying.
  - Question wording and `MIN_CONFIDENCE` are first guesses for Nathan to tune.
  - The engine isn't started.
- **Next:** BenStew starts `engine/graph.js` by hand, with Claude explaining; get a TypeSafe key and deploy the Worker; create Firebase.

### Rewrite README for the app as built; add ROADMAP.md

- **Date:** 2026-11-21
- **Stage:** Docs (BenStew)
- **What changed:**
  - `README.md` rewritten. It had described the app from before the game-plan merge (a `sim.js`, street marking, "copy summary", median 0.88 km, no sharing or report box). Now it has:
    - a status line: the numbers come from the stand-in engine until Jev's lands; Firebase and the proxy aren't set up yet
    - **What it does** (steps 0–8 plus home area, blue dot and Demo)
    - **How the prediction works** (walkers → 25 m grid → Bayes updates with Koopman detection → allocation; median ~0.8 km per the game plan)
    - a **Benchmark** section saying "not run yet", with what it will compare
    - languages and units
    - **Who built what, and how AI was used**: a table for BenStew (with Claude Code), Jev (engine by hand) and Nathan (tests, AI may help), plus the app's own narrow AI use
    - an updated file table
    - run locally plus `node --test`
    - Firebase setup, a new AI-proxy setup section, and GitHub Pages steps for the existing repo (make it public, turn on Pages)
    - a **Limits** list
    - credits, now including Koopman and Bayesian search theory
  - `ROADMAP.md` (new): "Future Plans (not yet built)" from the original prompt. Each item has, where it applies, an "Already in the app" line and a "Not built" line so the boundary is clear: live group search, caregiver profile, working with authorities, accessibility, privacy. Languages were moved out because they're built. Added the game-plan ideas that weren't built (time-aware map, "no one here" clues, GPS-trail coverage, doorbell-camera list, drill mode) and the open found-location dataset.
  - `CLAUDE.md` and the intro of this file now refer to `ROADMAP.md` as existing.
- **Why:** BenStew asked for the docs to be updated while Jev finishes the engine. The rules require disclosing AI use and separating built from planned work.
- **Decisions:**
  - **AI use is disclosed in the README**, naming Claude Code for the screen and noting that several screen files and the test servers were written by Claude Code sessions. That matches the commit log.
  - **The benchmark section is honest:** "not run yet" rather than placeholder numbers.
  - **The deploy steps match this repo:** it already exists and is private, so the steps are "make public → Pages" and the URL uses a placeholder username.
- **How it was verified:** docs only. Checked against the code: file names, buttons, behavior and settings (`FIREBASE_DB_URL`, `PROXY_URL`, `?db=`, `?proxy=`, `CACHE_VERSION`) all exist as described. README is 2,255 words; ROADMAP is 704.
- **Known issues / not done:** once the real engine and benchmark land, the README status line and Benchmark section need updating.
- **Next:** integration with Jev's engine; Firebase; proxy deploy; the benchmark.

### Screen E: offline worker on, app manifest, offline banner, Save my home area, GPS blue dot

- **Date:** 2026-11-21
- **Stage:** Screen E (BenStew)
- **What changed:**
  - `app.js`:
    - **Offline worker:** `registerServiceWorker()` turns on `sw.js`. `showOnlineState()` shows a yellow "You're offline – using saved data" line under the emergency banner on the `offline` event and hides it on `online`.
    - **My location:** a `LocateControl` button (◎) under the zoom buttons uses `watchPosition` to draw a blue dot with an accuracy circle and flies there on the first fix. Tap again to stop; denial shows a message.
    - **Save my home area** (`<details>` at the bottom of the panel): pick the point by address (`data.geocode`), by tapping the map (new `'home'` tap mode) or by GPS. A green ⌂ pin shows it. "Save this area for offline use" calls `data.loadArea` (downloads + stores, or finds it saved), remembers `{lat, lng, savedAt}` in `localStorage`, and shows "Saved on … works within about 2 miles, even with no signal".
  - `data.js`:
    - **Address search:** `geocode(query)` via Nominatim (one request per button tap, per their 1/second rule).
    - **Saved areas near a point:** `distanceM()` (haversine) and `findSavedAreaNear()`.
    - **`loadArea` order is now:** exact saved spot → saved area within 1,000 m → download → if the download fails, a saved area within 2,500 m → error. **A home area saved ahead of time now covers a last-seen point a few streets away**, which an exact-key cache couldn't. With `navigator.onLine === false` it tries Overpass once instead of five times.
  - `index.html`: `<link rel="manifest">`, the SVG favicon, the Apple touch icon, the offline banner, and the home-area section.
  - `style.css`: offline banner, home-area row, locate button, home pin.
  - `i18n.js`: 21 new strings in 5 languages.
  - `sw.js`: `CACHE_VERSION` → v4.
  - `README.md`: an updated offline test, and a note that while developing you reload twice / bump `CACHE_VERSION`.
  - `ShortPlan.md`: ticked "Works offline after the first visit".
- **Why:** Screen E in `PLAN.md`; the original prompt's offline PWA, GPS dot and "Save my home area".
- **Decisions:**
  - **Distance thresholds:** an area covers 3.2 km around its center and walkers need ~2 km around the last-seen point. So a saved area is reused online only within 1 km, and offline within 2.5 km, since a looser fit beats nothing.
  - **Offline banner follows the browser's events.** With no signal the app still opens from cache; "offline" means the phone, not our server.
  - **The locate button is a map control**, so it's always one tap away and doesn't take panel space.
  - **Home saving reuses `loadArea`**, so a home area is just a saved area; nothing new to keep in sync.
- **How it was verified** (built-in browser at 375×812):
  - The service worker is active and controls the page; `findthem-shell-v4` holds 18 files including `config.js`; a `findthem-tiles` cache exists; `manifest.json` loads; the locate button is labeled "Show my location".
  - The offline banner shows on an `offline` event with the right text and hides on `online`.
  - Blue dot: with a stand-in `watchPosition` (no GPS in the test browser), the dot and accuracy circle drew and the button showed pressed.
  - Home area: Fremont data seeded into IndexedDB, then a home point ~1 km from its center was tapped. Save took 0.05 s with no download, the remembered entry was saved, and the green pin appeared. Address search found "Fremont Central Park, …, Fremont" through Nominatim.
  - **Real offline test:** web server stopped, page reloaded. The app opened from the cache, remembered the home area, and the Demo ran with results.
  - `node --test`: 14/14 pass. `missingKeys()` is `{}`.
- **Known issues / not done:**
  - **Real GPS wasn't tested** (stand-in only).
  - **The offline fallback path wasn't exercised** (download fails → saved area within 2.5 km), because the test machine had internet.
  - Saving a home area that isn't saved yet needs Overpass, which can be busy.
  - The page shows the saved home's date but doesn't list or delete saved areas.
  - The manifest's start_url `./` works on GitHub Pages under `/FindThem/`, but that isn't tested yet.
- **Next:** integration with Jev's engine (swap `engine/fake.js`, Nathan's tests); create Firebase; deploy the proxy; then the required benchmark.

### Screen D: voice/text report box that fills in the sighting form or a message, confirm before anything is added

- **Date:** 2026-11-21
- **Stage:** Screen D (BenStew)
- **What changed:**
  - `index.html`, `style.css`:
    - a "Type or say what you saw" button opening the report box: example, textarea, **Speak** (turns red while listening), **Fill in the form**, a status line, and a privacy note ("sent to an AI service only to fill in the form; leave out names and medical details; you check everything")
    - a yellow "Check this: it was filled in from your report" note at the top of the sighting form
  - `app.js`:
    - `toggleReportBox`; `toggleVoice` / `stopListening` with `report.startVoice` (words appear as heard; the Speak button is hidden where the browser has no voice input)
    - `nearbyStreetNames()`: up to 50 named streets, nearest the last-seen point first, sent as context
    - `readReport()`:
      - **sighting** → the report box closes and the sighting form opens **pre-filled** (minutes, direction, how sure, note). If the draft has a location it's shown as a draft pin and the map flies there; otherwise "Now tap the map where they were seen".
      - **message** → the text goes into the message box, waiting for Send.
      - **searched** → explains how to mark an area under "Next areas".
      - Errors (offline / not set up / unreadable) → a message, and the **manual sighting form opens**.
    - `openSightingForm({ draft })` can now pre-fill.
  - `report.js`:
    - `PROXY_URL` constant replaced by `setProxyUrl()` / `isProxyConfigured()`, so app.js sets it from `config.js`
    - `startVoice()` gained an `onEnd` callback (it never said when listening stopped)
  - `config.js`: `PROXY_URL` (empty until the proxy is deployed); `?proxy=` override on localhost, sharing one `localOverride()` helper with `?db=`.
  - `tools/mock-proxy.py`: a keyword-rule stand-in for the proxy on port 9100 (no AI, no key) for testing. "here" pins the draft to the last-seen point.
  - `i18n.js`: 18 new strings in 5 languages. The word "chatbot" appears only in code comments.
  - `proxy/README.md`: points to `PROXY_URL` in `config.js`.
  - `sw.js`: `CACHE_VERSION` → v3.
  - `ShortPlan.md`: ticked "Messaging between searchers" (tested in Screen C) and "Voice/text report box".
- **Why:** Screen D in `PLAN.md`; the team doc's voice/text "report box"; the rule that nothing unconfirmed reaches the engine.
- **Decisions:**
  - **The confirm step is the existing forms.** A draft only ever fills in the sighting form or the message box; the person taps "Add sighting to the map" or "Send" as usual. No separate confirm dialog, and the engine only sees normal events.
  - **Close the report box after a draft** so the filled-in form is right below. Testing showed the open box pushed the form out of view.
  - **Every failure falls back to the manual form**, so the report box can never block reporting.
  - **`searched` drafts don't become events:** a searched event needs a sector, which only the map can give.
  - The privacy note sits right under the button, before anything is sent.
- **How it was verified:**
  - Built-in browser at 375×812 with `tools/mock-proxy.py`, Demo case:
    - "I think I saw a man in a blue coat by the lake 10 min ago heading east" → form with 10 / East / Probably / "blue coat", the check note, "Now tap the map…", and no sighting on the map.
    - "Definitely saw her right here 5 minutes ago, red sweater, going north" → pinned draft with 5 / North / Sure / "red sweater". **The top spots were unchanged until "Add sighting" was tapped**, then changed, with "Sighting added…".
    - A message-type report filled the message box, and nothing was sent until Send.
    - No proxy → "The report box isn't set up on this site yet…" and the manual form opened. Empty text → "Type or say your report first."
  - `node --test`: 14/14 pass.
  - Console errors seen were only the earlier test tab's live stream retrying the stopped mock database. The current page makes none.
- **Known issues / not done:**
  - **Voice input was not tested** (no microphone in the test browser).
  - **The real proxy isn't deployed:** DeepSeek and the Cloudflare account are still to do (`proxy/README.md`), and `ALLOWED_ORIGIN` is `*`.
  - With a proxy set but unreachable, the message says "No signal" (`report.js` treats network failures as offline).
  - The draft pin uses the same orange "!" look as confirmed sightings.
- **Next:** Screen E (register `sw.js`, link the manifest, Save my home area, GPS dot); create Firebase; deploy the proxy.

### Add offline worker, app manifest and icons, report box module and LLM proxy (from a parallel session)

- **Date:** 2026-11-21
- **Stage:** Screens D/E groundwork (BenStew's files, written by another session)
- **What changed:** files a parallel session wrote into the folder while Screen C was being built, committed as-is apart from two lines in `sw.js`:
  - `sw.js`: service worker.
    - Pre-caches the app shell + `/lib` + icons on install, skipping any missing file.
    - Deletes old shell caches on activate.
    - OSM tiles: cache-first, only tiles actually viewed, capped at 2,000 (oldest trimmed), never prefetched.
    - Other sites (Overpass, Nominatim, Firebase, the proxy): network-only.
    - Same-site files: cache-first with a background refresh, so the demo file is cached on first use.
    - Two lines changed in Screen C: `config.js` added to the shell list, `CACHE_VERSION` bumped to `v2`.
    - **Not registered by the page yet** (Screen E).
  - `manifest.json`, `icons/`, `tools/make-icons.py`: the PWA manifest (name FindThem, theme `#b00020`, standalone), 192/512/maskable PNGs, an Apple touch icon and an SVG, drawn by a pure-standard-library Python script. **`index.html` doesn't link the manifest yet** (Screen E).
  - `report.js`: the report box logic (no UI text).
    - voice through the Web Speech API (`startVoice`, `isVoiceSupported`)
    - `parseReport` POSTs to the proxy with a 15 s timeout
    - `validateDraft` cleans the LLM output (kinds, lat/lng pairs, compass directions, minutes 0–1440, reliability snapped to 0.3/0.6/0.9, text lengths)
    - `draftToEvent` makes an Event only after Confirm: a sighting needs a pin, and `searched` returns null because it needs a sector from the map
    - `PROXY_URL` is empty until the proxy is deployed
  - `proxy/` (`worker.js`, `wrangler.toml`, `README.md`): a Cloudflare Worker.
    - The DeepSeek key is a Worker secret (`wrangler secret put DEEPSEEK_API_KEY`), never in the repo.
    - The system prompt says the report is data, not instructions; it uses JSON mode at temperature 0, and the output goes back through `validateDraft`.
    - Best-effort per-IP rate limit (20/min); origin check via `ALLOWED_ORIGIN` (`*` for now; set the real site before the demo).
  - `tests/report.test.js`: 8 tests for `validateDraft`, `draftToEvent`, `parseReport` without a proxy, and no voice in Node.
- **Why:** BenStew asked for these files to be committed and pushed with Screen C.
- **Decisions:**
  - Kept as written: they were reviewed in Screen C and found sound (no keys in code, untrusted text handled as data, everything validated twice).
  - Committed separately from Screen C so the history shows they came from a different session.
- **How it was verified:**
  - `node --test`: 14/14 pass (sync + report).
  - A grep for API keys and secrets in these files found nothing.
  - The icons are 20 KB in total.
- **Known issues / not done:**
  - The report-box UI isn't wired into the page.
  - The proxy isn't deployed and `PROXY_URL` is empty.
  - `ALLOWED_ORIGIN` is `*`.
  - The service worker isn't registered and the manifest isn't linked.
  - Not tested in a browser yet.
- **Next:** create Firebase; Screen D (report box UI + proxy deploy); Screen E (register `sw.js`, link the manifest, Save my home area, GPS dot).

### Screen C: live sharing via Firebase REST, share/join links, names, messages, police hand-off sheet

- **Date:** 2026-11-21
- **Stage:** Screen C (BenStew)
- **What changed:**
  - `sync.js`: Firebase Realtime Database through plain REST, with no SDK.
    - `setDbUrl`, `isConfigured`, `newSearchId` (128-bit hex)
    - `createSearch` (PUT the case, adding `createdAt`)
    - `addEvent` (POST; queues in `localStorage` with no signal or no DB, and sends the queue first, in order)
    - `flushQueue`, `pendingCount`, `queuedEvents`
    - `applyChange` (pure put/patch mirror), `sortedEvents` (by `at`, then id)
    - `loadSearch`, and `subscribe` (EventSource live stream: `put`/`patch`/`cancel`, flushes on `open` and `online`)
    - No DOM or UI text, so it runs in Node.
  - `config.js`: `FIREBASE_DB_URL` (empty for now). On localhost only, `?db=` overrides it for testing.
  - `app.js`:
    - **Share this search:** creates the search in Firebase, moves this phone's events into it, then uses the Web Share API, falling back to the clipboard, then to a read-only link field.
    - **The link:** `#s=<id>&c=<case>&a=<demo|live>`. The case is packed into the link (base64url JSON), so it shows the same starting map even without the database.
    - **Opening a link** fills in the case (the database copy wins), joins the live stream and runs the map.
    - **Events:** `recordEvent()` gives every event a `cid` (its id on this phone), `by` (the name) and `at`. When shared, events show immediately ("optimistic") until Firebase echoes them back, and queued ones show too.
    - The engine re-runs only when `searched`/`sighting` events change, not for messages.
    - **Your name** is saved in `localStorage`.
    - **Message feed:** text only via `textContent`, never HTML, since messages come from other people.
    - **Hand-off sheet:** plain text in a `<dialog>` with Copy / Print / Close. It covers last seen (coords + time), mobility, heading, familiar places, a timeline of searches/sightings/messages, the top 8 places with coords and %, the live link and the disclaimer. A non-English sheet gets an English copy below it. Printing shows only the sheet.
    - A new last-seen point or Demo leaves the shared search.
  - `index.html`, `style.css`: share box (name, Share button, live status, fallback link field), message feed and input, hand-off button and dialog, print styles.
  - `i18n.js`: 41 new strings in all 5 languages, plus `tIn(lang, key)` and `formatTime`. `missingKeys()` is `{}`.
  - `firebase-rules.json`:
    - no listing of searches
    - read only with a 32-hex id
    - the case can be written once
    - events can only be added, with type whitelisted and text/note ≤ 300 characters
  - `tools/mock-firebase.py`: an in-memory stand-in for the Firebase REST API and live stream (port 9000) for testing with no account.
  - `README.md`: a "Set up live sharing (Firebase)" section.
  - `ShortPlan.md`: ticked "Share link" and "Police hand-off sheet".
  - `tests/sync.test.js`: tests for the sync API (from a parallel session, see below).
- **Why:** Screen C in `PLAN.md`. Sharing is "a big one" in the team doc.
- **Decisions:**
  - **Parallel session:** while Screen C started, another session or agent wrote `sync.js`, `report.js`, `sw.js`, `manifest.json`, `icons/`, `proxy/`, `tests/sync.test.js`, `tests/report.test.js` and `tools/make-icons.py` into this folder without committing. This session overwrote that `sync.js` by mistake; it wasn't in git, so it couldn't be recovered. `sync.js` was rebuilt to the API those tests expect (all 14 tests pass), plus the live stream. The other files are kept as they were, except two changes to `sw.js`: `config.js` added to its offline file list and `CACHE_VERSION` bumped to v2. They are **not committed here**; their owner should commit them (they're Screens D/E work).
  - **Every phone computes the map itself:** only the case and append-only events are in Firebase.
  - **The link carries the case** as well as the search id, so a link still shows the starting map when the database is down, blocked or not set up.
  - **Area source is shared** (`area: 'demo'|'live'` in the case and `a=` in the link), so joiners use the same street data as the starter.
  - **`nextFrame` uses `setTimeout(30)`, not `requestAnimationFrame`.** Testing found rAF never fires in a background tab, so a joining tab hung on "Loading streets…". The same would happen to a phone with the app in the background.
- **How it was verified:**
  - `node --test`: 14/14 pass.
  - Two browser tabs with `tools/mock-firebase.py`. Tab A ran Demo and shared ("Shared live…"). Tab B opened the link and got the same inputs, top spots and areas. B marked Area A searched and sent a message; A re-ranked the areas the same way and showed "Ben 1:00 PM: I have the park, heading north" within ~1 s. Reloading B rejoined with the demo data even from a link that said `a=live`, because the database case says `demo`.
  - The hand-off sheet in Spanish, with its English copy, has every section.
  - With no database: "Live sharing isn't set up…", and the link has `#c=` only.
  - No console errors. In the test browser the clipboard is blocked, so the fallback link field appeared as intended.
- **Known issues / not done:**
  - **Firebase isn't created yet:** BenStew has to make the project and paste the URL into `config.js` (README steps). Until then only the mock has been tested, not real Firebase.
  - Anyone with a link can read and add to that search (no accounts).
  - The hand-off English copy still formats dates and numbers in the current language.
  - The live link contains `?db=` when testing on localhost.
  - Hand-off numbers come from the fake engine.
  - The report-box UI (Screen D) isn't wired yet, though `report.js` and `proxy/` exist. `sw.js` isn't registered yet (Screen E).
- **Next:** create the Firebase project; commit the parallel session's files; Screen D (report box UI with `report.js` + proxy deploy); Screen E (register `sw.js`, Save my home area, GPS dot).

### Screen B: first steps, rings, colored streets, next areas with routes, sightings

- **Date:** 2026-11-21
- **Stage:** Screen B (BenStew)
- **What changed:**
  - `index.html`:
    - **First steps** (`<details>`, open until the first run): a big tap-to-call button with the local number, a 6-point "tell the dispatcher" script, and a 7-item house-and-yard checklist that turns green and strikes through when checked.
    - In the results: a **Report a sighting** button and form (tap the map; minutes ago; direction; how sure: maybe/probably/sure = 0.3/0.6/0.9; note).
    - **Next areas to search** list.
  - `app.js` (rewritten around one `recompute()`):
    - Every run, "searched" and sighting calls `engine.replay(area, case, state.events)`, then `drawResults()`.
    - New layers: streets colored by `edgeCounts` (5 purple steps, log scale), dashed rings at 0.5/1/1.5 mi with unit-aware labels, gray squares over searched sectors, orange "!" markers for sightings.
    - **Next areas:** `nextSectors(…, 20 min, 3)` shown as A/B/C squares on the map and in the list, with chance, route length and minutes from `routeFor`. Opening one draws its route and offers "Searched, nobody found" with minutes (defaults to the route's minutes). That adds a `searched` event.
    - Events get local ids (`local-<time>-<n>`); Screen C will use Firebase push ids. A new last-seen point or Demo clears the events. First steps collapse after a run.
  - `engine/fake.js` (still fake):
    - builds a bare node/edge list from `osm.ways` so colored streets can be drawn and tested
    - edge counts = walkers that stopped within ~75 m
    - sightings blend in a 250 m Gaussian blob weighted by reliability
  - `i18n.js`: 46 new strings in all 5 languages. `missingKeys()` is still `{}`.
  - `style.css`: styles for the new sections, plus **`pointer-events: none` on the status message**.
- **Why:** Screen B in `PLAN.md`.
- **Decisions:**
  - **Status message lets taps through.** Testing found the bottom-of-map message ("Tap the map where they were seen") swallowed the very tap it asked for. It now has `pointer-events: none`.
  - **Area letters vs. spot numbers.** Areas use letters on blue squares so they can't be confused with the numbered red "Check these first" spots.
  - **Search effort:** areas are ranked for 20 searcher-minutes (`DEFAULT_SEARCH_MINUTES`); the minutes typed when marking searched go into the event.
  - **No names yet:** `searched` events carry `by: ''` until Screen C adds names and sharing.
  - **Layer order** (bottom → top): streets, colored streets, heatmap, rings, searched, areas, route, spots, sightings, pins.
- **How it was verified:** built-in browser at 375×812, Demo case.
  - Demo in 0.88 s: first steps collapse; A/B/C areas with "9% chance they are here · Walking route: 800 m, about 15 min"; rings labeled 800 m / 1.6 km / 2.4 km (metric was on); rings visible when zoomed out.
  - Opening Area A draws its route. Marking it searched shows "Marked as searched…" and re-ranks the areas: the searched one drops out, the others move up.
  - Sighting: the tap lands (after the pointer-events fix); saving with "sure" moves the top spots near the sighting, adds the "!" marker with the note, and closes the form.
  - Chinese strings render. No console errors. Fake `replay` with 2 events on the Fremont data: 34 ms.
- **Known issues / not done:**
  - **Everything shown comes from the fake engine:** square routes (always 800 m / 15 min), streets colored only near endpoints, "searched" halves a sector, and the sighting is a blob. Jev's engine replaces all of it.
  - Events live only in this phone's memory; Screen C syncs them.
  - The house checklist isn't saved, so a reload clears it.
  - The live Overpass path is still untested in the browser.
- **Next:** Screen C: Firebase sync (two phones, one map), share/join links with names, message feed, police hand-off sheet.

### Screen A: map, inputs, 5 languages, data loading, fake engine, Fremont demo

- **Date:** 2026-11-21
- **Stage:** Screen A (BenStew)
- **What changed:**
  - `index.html`, `style.css`: phone-first layout.
    - Emergency banner: tap-to-call, can't be closed.
    - Full-height map.
    - Bottom panel: last-seen button, minutes, direction, mobility (big radio rows), up to 3 named familiar places, Run, Demo, language picker, mi/km button.
    - "Check these first" results with the "guide, not a guarantee" note.
    - On wide screens the panel moves to the left.
  - `app.js`:
    - map with OSM tiles; tap modes for the last-seen point and familiar places
    - builds the `CaseInput` from `INTERFACES.md`; loads the area, then `prepareArea` → `replay` → draws gray street lines, a heatmap from `grid.p`, and the top 8 spots (3 shown, "Show more")
    - tapping a spot flies to it; language and units are remembered in `localStorage`
    - `DEMO_LOCATION` / `DEMO_CASE` are at the top
  - `i18n.js`:
    - every UI string in en/es/fr/zh/ja; `t()`, `applyTranslations()`
    - region detection → emergency number table (default 911) and units (US/LR/MM imperial)
    - `formatDistance`, `formatPercent`, `formatDateTime`, `missingKeys()`
  - `data.js`:
    - Overpass query (walkable ways + trap features, `out body geom`), `parseOverpass` → `OsmData`
    - skips `waterway=pressurised` and culverts
    - retries across 3 Overpass servers with backoff (3 s, 6 s, 12 s…)
    - IndexedDB cache keyed by the point rounded to 3 decimals; `loadBundledArea` for the demo
  - `engine/fake.js`: dev-only stand-in with the `INTERFACES.md` exports. Walkers scatter in straight lines and ignore streets; "searched" just halves a sector. It exports `IS_FAKE`, so the UI shows a "practice results" note. **Delete it at integration** and switch the import in `app.js` to `./engine/index.js`.
  - `tests/fixtures/demo-area.json` (3.0 MB, 0.6 MB gzipped): real Fremont `OsmData`, 3.2 km around 37.5530, −121.9700. It has 33,059 nodes, 7,695 ways and 228 features (83 creeks, 18 water, 6 wetland, 2 river, 4 woods, 2 brush, 84 grass, 29 parks). It serves as both the Demo data and the engine test fixture.
  - `tools/make-fixture.js`: rebuilds that fixture (download, or from a saved Overpass answer).
  - `lib/`: Leaflet 1.9.4 (`leaflet.js`, `leaflet.css`) and Leaflet.heat 0.2.0 (`leaflet-heat.js`), from unpkg.
  - `package.json`: `{"type": "module"}` + `npm test` → `node --test`, with no dependencies.
- **Why:** Screen A in `PLAN.md`: give the screen something real to show before Jev's engine exists.
- **Decisions:**
  - **Demo uses bundled data.** Both public Overpass servers answered "at capacity" (502/504) for about 20 minutes during this build, so the Demo button loads the bundled Fremont file instead of downloading. The demo then works for judges no matter what Overpass is doing.
  - **Demo case:** last seen on Placer Way / Tehama Avenue (37.5405, −121.9795), a residential street with a drainage creek ~100 m away. 45 min, heading NE, slow walker, familiar place Lake Elizabeth (37.5485, −121.9630), seed 20261121. The map opens at the fixture center near Central Park.
  - **Streets are drawn from `osm.ways`, not `area.graph`.** The fake engine doesn't build a graph, so it doesn't duplicate Jev's work. Colored-by-use streets (Screen B) will use the real graph's `edgeCounts`.
  - **Heatmap:** the top 4,000 cells, weight = p / max p, `max: 3`. With `max: 1` it saturated into one red blob; with `max: 6` nothing reached red.
  - **No separate page code for the fixture:** the fixture lives under `tests/` (the path in `INTERFACES.md`) and the website loads it from there too, rather than keeping two copies.
  - `.claude/launch.json` (dev server config) is not committed; the repo owner's global git ignore excludes `.claude/`.
- **How it was verified:**
  - Built-in browser at 375×812. Banner, tap modes, inputs, adding/removing familiar places, and switching en → es → ja all worked with no console errors. `missingKeys()` returns `{}`.
  - Demo: results in 0.41 s. Spot text such as "Creek 50 ft off Ralston Common – 9% of walkers" with the hazard line; tapping a spot zooms to it; mi/km switches ("10 m"); "Show 5 more" shows 8.
  - The fake engine on its own: `replay` 12 ms, `grid.p` sums to 1.
  - `node --check` on every JS file.
- **Known issues / not done:**
  - **The live download path (a last-seen point outside the demo area) wasn't tested in the browser**, because Overpass was at capacity. The same code worked from Node once a server came back (6.3 MB in 49.5 s), so a real search can take close to a minute on a busy day.
  - Fake-engine spot text can be wrong (e.g., the creek distance is really the spot-to-street distance). The real engine replaces it.
  - The Overpass query skips relations (multipolygon parks and lakes), so some large parks or lakes may be missing.
  - The translations are AI-written and unchecked by native speakers.
  - No service worker yet (Screen E), so nothing works offline.
- **Next:** pause for BenStew's check. Then Screen B: colored streets, rings, sectors + routes UI, 911 script + house checklist, sighting form.

### Merge the team's planning doc: team roles, routes, messaging, report box, Fremont

- **Date:** 2026-11-21
- **Stage:** Setup
- **What changed:**
  - `PLAN.md`: rewritten to merge the team's planning doc.
    - team table: BenStew screen + hosting, Jev engine by hand, Nathan tests/debugging/speed
    - routes for searchers, a message feed and the voice/text report box (DeepSeek through a serverless proxy, confirm before use)
    - prior from several public sources; Fremont, CA as the demo area
    - new files `report.js`, `proxy/`, `engine/routes.js`, `bench/`
    - new schedule, cut order and LLM privacy limit
  - `ShortPlan.md`: updated "what it does" (routes, messages, report box), the "not a chatbot" wording, the team line, and the must-have list.
  - `INTERFACES.md`:
    - team names, and three-way agreement for changes
    - `message` event type, and "the engine ignores event types it doesn't use"
    - new `routeFor(area, prediction, sectorId) → Route`
    - the `ReportDraft` shape for the report box
    - skip `waterway=pressurised` and culverts when finding creeks
    - a routes test
  - `CLAUDE.md`: team section with names and files; the "never call it a chatbot" rule; Fremont; the two online parts (Firebase + LLM proxy); never put an API key in website code.
  - `CommitHistory.md`: "Project context" rewritten; this entry.
- **Why:** the team wrote its own planning doc ("Components of What We're Going to Build"). BenStew asked for every document to be updated to match it.
- **Decisions:**
  - BenStew is the repo owner and builds screen + hosting. Nathan's tests may be written with AI help; Jev's engine may not.
  - **Messaging and the report box are must-haves by the deadline**, not after the core. That reverses the earlier "no messaging, no chatbot" decision.
  - The report box is narrow: LLM output is a draft, the person confirms, and the engine only sees normal events. It isn't called a chatbot, following the team doc's "people don't want to see chatbot when they are panicking".
  - The DeepSeek key lives in a serverless proxy, not the page. Cloudflare Workers is the leading option, since Firebase Cloud Functions needs a paid plan. Final choice is BenStew's hosting research.
  - **Demo area: Fremont, CA** instead of Austin. The team doc wants the engine to be "an expert in Fremont", and BenStew asked for the city I'd recommend. Fremont has dense OSM data, several creeks and drainage channels, and parks, and the team can do a field drill there.
  - Routes come from the engine (`routeFor`), inside the sector chosen by greedy allocation.
- **How it was verified:**
  - Overpass query within 1,600 m of 37.5530, −121.9700: 3,408 walkable ways and 85 trap features (Laguna, Mission and Irvington creeks, drains, parks). It also found Bay Division Pipelines tagged `waterway=pressurised`, hence the skip rule.
  - Docs only otherwise.
- **Known issues / not done:**
  - Jev and Nathan haven't reviewed `INTERFACES.md`.
  - The LLM provider's privacy terms aren't checked; reports leave the phone.
  - The README body is still pre-merge.
  - The scope is now large for the time left; `PLAN.md` has the cut order.
- **Next:** push; all three review `INTERFACES.md`; then the skeleton and Screen A.

### Add ShortPlan.md: 2-minute read of what FindThem is

- **Date:** 2026-11-21
- **Stage:** Setup
- **What changed:**
  - `ShortPlan.md` (new): a one-sentence summary, why it matters (2 stats), who it's for, the 7 steps a user goes through, how it works in plain words, what it is NOT, the must-work-by-the-deadline checklist, and the benchmark under "after the core works (still required)".
  - `CLAUDE.md`: reading order is now ShortPlan → PLAN → INTERFACES → CommitHistory → README. New rule: update `ShortPlan.md` in the same commit whenever the product changes (who, what, what it is NOT, priorities) and tick its checkboxes as features work.
  - `README.md`: a pointer to `ShortPlan.md` at the top, since the README itself still describes the pre-merge app.
  - `CommitHistory.md`: the intro points to `ShortPlan.md` first; this entry.
- **Why:** the repo owner wanted a quick read for themselves and their teammate, kept up to date automatically.
- **Decisions:**
  - Audience is the two builders, not judges. Mostly bullets, light on the how, no formulas.
  - Sections: why, who, what it does, how it works, what it is NOT, priorities. Team split and the evidence/limits sections are left to `PLAN.md`.
  - Update rule: when the product changes, not on every commit.
- **How it was verified:** word count checked: 562 by `wc -w`, including markdown symbols, about a 2-minute read.
- **Known issues / not done:** the README body is still pre-merge.
- **Next:** push so the teammate can review `INTERFACES.md` and `ShortPlan.md`; then the skeleton and Screen A.

### Add INTERFACES.md: contract between screen and engine

- **Date:** 2026-11-21
- **Stage:** Setup
- **What changed:** `INTERFACES.md` (new) defines everything that passes between the screen (`app.js`, `data.js`, `sync.js`) and the hand-written engine (`engine/`, `tests/`):
  - ground rules: ES modules with one entry point, `engine/index.js`; pure and deterministic, no `Math.random` or `Date.now`; units; local x/y meters
  - input shapes: `OsmData` (what `data.js` returns, with the OSM tag → trap-type table and `HAZARD_TYPES`), `CaseInput`, and `Event` (`searched` / `sighting` / `assigned`)
  - engine exports: `prepareArea`, `replay` (the main call), `cellToLatLng`, `nextSectors`, `topSpots`, with their output shapes
  - tunable constants, the tests the engine must ship, and the Firebase data layout
- **Why:** two people build in parallel (screen vs. engine), so the hand-off has to be fixed before either starts. `PLAN.md` calls for this file first.
- **Decisions:**
  - **One main call.** `replay(area, caseInput, events)` instead of the screen chaining `simulate` → grid → updates. Every phone rebuilds the same map from the case + event list, so Firebase stores only small, append-only events.
  - **Fixed times.** `CaseInput` is one object (not the original 8-argument `simulate`). `minutes` is fixed when the search is created and sightings store `minutesSince` at report time, so results stay deterministic. Limit: the map doesn't grow over time.
  - **Sighting seeds:** `(seed + 7919·k) >>> 0` for the k-th sighting.
  - **Grid:** 25 m cells, sectors of 8×8 cells (200 m), grid radius 3,200 m (the same as the Overpass radius).
  - **Engine vs. screen:** the engine returns numbers and names; the screen builds all translated text (no strings in the engine). `data.js` maps OSM tags to trap types; the engine never sees raw tags.
  - **Imports:** `engine/fake.js` (screen-owned, dev only) has the same exports until integration.
  - **Give-up distance:** `GIVE_UP_SIGMA` ≈ 0.52 makes a lognormal with median 850 m put ~89% within 1 mile.
- **How it was verified:** docs only. The teammate hasn't reviewed it yet.
- **Known issues / not done:** `topSpots` (clustering) adds engine work. If the engine side runs short on time, it can move to the screen side, but only by agreement. `package.json`, `engine/fake.js` and the demo fixture don't exist yet.
- **Next:** the teammate reviews and agrees `INTERFACES.md`. Then the skeleton: `package.json`, `engine/index.js` + `engine/fake.js`, `/lib`, the Firebase project. Then Screen A.

### Merge EvoHacks II game plan; commit CLAUDE.md and PLAN.md

- **Date:** 2026-11-21
- **Stage:** Planning (before Stage 1)
- **What changed:**
  - `PLAN.md` (new): the merged build plan. It combines the original build prompt with the EvoHacks II game plan ("FirstHour": Bayesian search, sectors, shared coverage, sightings, hand-off, benchmark).
  - `CLAUDE.md` (now committed): rules for AI agents. Team split, "AI must not write engine code", the required benchmark, the commit-log rules, code rules, how to run.
  - `CommitHistory.md`: "Project context" rewritten for the merged plan; this entry.
  - `.gitignore`: also ignores `.claude/settings.local.json` (personal permissions).
- **Why:** the repo owner received the game plan and asked for it to be merged with the original prompt. Their teammate needs `CLAUDE.md` and the plan through `git pull`.
- **Decisions:**
  - **Name:** FindThem, not FirstHour.
  - **Model:** walkers feed the grid, not grid-only or walkers-only. Walkers capture real streets, dead ends and creeks; the grid does detection, updates and allocation.
  - **Sync:** Firebase RTDB through REST, not Supabase (needs a ~100 KB library) or our own server (more to build).
  - **Benchmark:** required but built after the core, because the Nov 22 deadline leaves about a day and a half.
  - **AI disclosure:** AI use is disclosed in the repo, which reverses the previous entry's "AI tool files stay out of git" decision. Commits still carry no attribution lines.
  - **Ignore rule:** the repo owner's global git ignore (`~/.config/git/ignore`) lists `CLAUDE.md`, so it was force-added once. It's tracked normally from now on.
- **How it was verified:** docs only. `git status` checked before committing.
- **Known issues / not done:**
  - `README.md` still describes the pre-merge app (no sectors, sync or sightings; median 0.88 km) and doesn't yet disclose AI use. Update it with Stage 1.
  - `ROADMAP.md` and `INTERFACES.md` aren't written. The Firebase project isn't created.
- **Next:** setup. Write `INTERFACES.md` with the teammate, add skeleton files and `/lib`, create the Firebase project, update the README, then Screen A (map + inputs + i18n + `data.js` + fake engine).

### Add project docs and gitignore

- **Date:** 2026-11-21
- **Stage:** Planning (before Stage 1)
- **What changed:**
  - `README.md`: describes the *finished* app (features, how the prediction works, languages and units, file table, running locally, GitHub Pages deploy, credits). Most of what it lists doesn't exist yet; a status note near the top says so.
  - `CommitHistory.md`: this file.
  - `.gitignore`: ignores `.DS_Store`.
- **Why:** the README came first so the plan was written down before any code. This log exists so anyone, including an AI agent without the planning chat, has the full context from the repo alone.
- **Decisions:**
  - Each developer's AI tool instruction files and local tool settings are not committed. Each person ignores them on their own machine (in `.git/info/exclude`), not in `.gitignore`. The "How to add an entry" rules at the top of this file are the shared copy of the logging rules.
  - The repository is private on GitHub. GitHub Pages on a free account needs a public repo, so it has to be made public before deploying.
  - The README credits Robert Koester's lost-person behavior research for the dementia statistics (median ~0.88 km, ~89% within 1 mile). That citation hasn't been checked.
- **How it was verified:** docs only; `git status` checked before committing so only these three files were added.
- **Known issues / not done:** no app code. `ROADMAP.md` isn't written yet.
- **Next:** Stage 1 (map + inputs). If two people build in parallel, first agree the hand-off points between `data.js`/`sim.js` and the UI files in an `INTERFACES.md`.
