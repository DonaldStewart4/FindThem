# FindThem: notes for AI agents

EvoHacks II project (theme: social good). **Deadline: Sun Nov 22, 2026, 12:00 pm.** Code freeze 9:30 am; submit by 11:00 am.

## Read first
1. `PLAN.md`: the merged build plan (original build prompt + EvoHacks II game plan). Scope, team split, file layout, schedule.
2. `CommitHistory.md`: every decision so far and a detailed log of each commit.
3. `README.md`: what the app is. `ROADMAP.md` (once written): future plans. **Don't build roadmap items**, and don't add placeholder code or fake buttons for them.

## Team split: who writes what
- **Screen** (repo owner, with AI help): `index.html`, `style.css`, `app.js`, `data.js`, `sync.js`, `i18n.js`, `sw.js`, `manifest.json`, `icons/`, `lib/`.
- **Engine** (teammate, **written by hand**): everything in `engine/` (`graph.js`, `sim.js`, `grid.js`) and `tests/`. EvoHacks rules say AI may not build the whole project and each person explains their own code on video. **AI must not write engine code.** It may explain the math, review code, and suggest tests.
- `INTERFACES.md` is the contract between the two halves. Change it only when both people agree.
- `engine/fake.js` is a dev-only stand-in so the screen works before the real engine lands. Delete it at integration.

## Must not be forgotten
- **The benchmark is required**: simulated wanderers, uncoordinated volunteers vs. ring sweep vs. FindThem allocation, with a results table in the README. It gets built **after the core works**, not skipped.
- Must-haves beyond the core: all 5 languages (en/es/fr/zh/ja), offline PWA, police hand-off sheet.

## Every commit
- Add an entry to the top of the Log in `CommitHistory.md` **in the same commit**, using the template in that file.
- If a decision changes, add a new entry that says so and update the "Project context" section. Don't rewrite old entries.
- Work that isn't committed yet goes under "Uncommitted" in the Log.
- Commit locally. Push only when the user asks.
- AI use is disclosed openly. Naming Claude or other tools in the repo is fine. Don't add co-author or attribution lines to commits.

## Code rules
- Plain HTML, CSS and vanilla JavaScript. No frameworks, no build step, no npm packages at runtime.
- The only backend is Firebase Realtime Database for live sync, used through its REST API (`fetch` + `EventSource`) in `sync.js`. No SDK. The prediction always runs on the phone.
- Engine code is pure and deterministic (seeded random numbers, no DOM), so every phone computes the same map from the same inputs and events. Tests run with `node --test`.
- The repo owner is new to HTML/CSS/JS. Keep code simple, comment it well, and briefly explain changes in plain language.
- Overpass, Nominatim and IndexedDB code lives in `data.js`. All UI text lives in `i18n.js` in all five languages; never hard-code UI text elsewhere.
- Tunable numbers are named constants at the top of engine files.
- Libraries live in `/lib`. Don't load scripts from a CDN.
- OSM tile usage policy: only cache tiles the user has viewed. Never bulk-download or prefetch tiles.
- Mobile-first: big tap targets, high contrast, small page weight. Always show "call emergency services first".
- When app files change, bump the cache version at the top of `sw.js`.

## Running it
```bash
python3 -m http.server 8000
```
Open http://localhost:8000. Service workers only work on localhost or HTTPS.

```bash
node --test
```
Runs the engine tests.

Note: the repo owner's global git ignore lists `CLAUDE.md`. The file was force-added once (`git add -f`) and is tracked normally now.
