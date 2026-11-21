# Commit History

A detailed log of every commit, for people and AI agents who don't have the chat history behind this project. `git log` gives one-line titles; this file explains what changed, why, what was decided, and what's left.

**Read this file first** if you're picking up the project cold. Then read `README.md` (what the app is) and `ROADMAP.md` (what's deliberately not built).

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

Decisions made before any code was written (planning session, 2026-11-21). These override the original build prompt where they differ.

- **What it is:** FindThem, a phone-first PWA that predicts where a person with dementia who wandered off is likely to be. The user drops a last-seen pin; 5,000 simulated walkers move on the real OpenStreetMap street graph using search-and-rescue behavior patterns; results show as a heatmap, colored streets, distance rings and a top-8 "Check these first" list.
- **Original spec:** a build prompt kept outside the repo. Its contents are summarized across `README.md` (features), `ROADMAP.md` (future plans) and this section (changes to it).
- **Tech:** plain HTML/CSS/vanilla JS, no frameworks, no build step, no backend. Leaflet 1.9.4 + Leaflet.heat 0.2.0 stored in `/lib` (not loaded from a CDN). OSM tiles, Overpass API for street and terrain data, IndexedDB cache, service worker for offline use.
- **The user is new to HTML/CSS/JS.** Keep the code simple and well commented.
- **Build order:** Stage 1 map + inputs → Stage 2 data → Stage 3 simulation → Stage 4 results → Stage 5 offline + sharing → stretch goals → testing and docs. Pause for the user's OK after Stage 1 and Stage 4; the other stages run straight through. One local commit per stage, never pushed unless the user asks.
- **Changes from the original spec:**
  - **Languages are built now**, not left for the roadmap: English, Spanish, French, Simplified Chinese, Japanese. Starts in the phone's language, with a picker. All text lives in `i18n.js` (a file not in the original file list).
  - **Units:** the phone's region decides (US, Liberia, Myanmar → miles/feet; everywhere else → km/m), with a mi/km toggle. Distance rings are always 0.5/1/1.5 miles on the ground and are labeled 0.8/1.6/2.4 km in metric.
  - **Emergency banner:** shows the local emergency number from a country table (911, 112, 999, 000, …), defaulting to 911, as a tap-to-call link. It can't be dismissed.
  - **Save my home area:** the point can come from an address search (Nominatim), a map tap, or the current GPS location.
- **Stretch goals to build:** mark streets as searched (`localStorage`), and copy a plain-text summary for police.
- **Demo location:** a US suburb with streets, woods and a creek. The first candidate is near Shoal Creek, Austin TX; it gets checked against real Overpass data in Stage 2. It's the `DEMO_LOCATION` constant at the top of `app.js`.
- **Deploy target:** GitHub Pages.
- **Do not build** anything listed in `ROADMAP.md`, and don't add placeholder code or fake buttons for it.

## Log

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
