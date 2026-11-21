# FindThem: notes for AI agents

EvoHacks II project (theme: social good). **Deadline: Sun Nov 22, 2026, 12:00 pm.** Code freeze 9:30 am; submit by 11:00 am.

## Read first
1. `ShortPlan.md`: a 2-minute read of what the software is, who it's for, what it is NOT, and what must work by the deadline.
2. `PLAN.md`: the merged build plan (original build prompt + EvoHacks II game plan + the team's planning doc). Scope, team, file layout, schedule.
3. `INTERFACES.md`: the contract between screen and engine.
4. `CommitHistory.md`: every decision so far and a detailed log of each commit.
5. `README.md`: what the app is, who built what, how AI was used, setup and deploy. `ROADMAP.md`: future plans. **Don't build roadmap items**, and don't add placeholder code or fake buttons for them.

## Team: who writes what
- **BenStew** (repo owner, the person in Claude Code sessions here): **screen + hosting**, with AI help. Files: `index.html`, `style.css`, `app.js`, `data.js`, `sync.js`, `report.js`, `proxy/`, `i18n.js`, `sw.js`, `manifest.json`, `icons/`, `lib/`. Also researches the free hosting and LLM provider, and security.
- **Jev**: **engine**, **written by hand**. Everything in `engine/` (`graph.js`, `sim.js`, `grid.js`, `routes.js`). EvoHacks rules say AI may not build the whole project and each person explains their own code on video. **AI must not write engine code.** It may explain the math, review code, and suggest tests.
- **Nathan**: **tests, debugging, speed and reliability**. `tests/` and `bench/`. AI may help write tests; Nathan reviews them and must be able to explain them.
- `INTERFACES.md` is the contract between the parts. Change it only when BenStew, Jev and Nathan agree.
- `engine/fake.js` is a dev-only stand-in so the screen works before the real engine lands. Delete it at integration.

## Must not be forgotten
- **The benchmark is required**: simulated wanderers, uncoordinated volunteers vs. ring sweep vs. FindThem allocation, with a results table in the README. It gets built **after the core works**, not skipped.
- Must-haves by the deadline: routes for searchers, messaging between searchers, the voice/text report box, share link, police hand-off sheet, offline PWA, all 5 languages (en/es/fr/zh/ja), Demo button.
- **Never call the report box a "chatbot"** anywhere in the UI. The LLM only turns a report into a draft the person confirms; it never sets probabilities, and nothing unconfirmed reaches the engine.
- Demo and tuning area: **Fremont, CA** (Central Park / Lake Elizabeth). Skip `waterway=pressurised` (underground pipes) when finding creeks.

## Every commit
- Add an entry to the top of the Log in `CommitHistory.md` **in the same commit**, using the template in that file.
- If a decision changes, add a new entry that says so and update the "Project context" section. Don't rewrite old entries.
- **Keep `ShortPlan.md` in sync with the product.** When a change affects who the app is for, what it does, what it is NOT, or the must-have / after-the-core lists, update `ShortPlan.md` in the same commit. Tick its checkboxes as features start working. Not needed for code-only commits. Keep it a 2-minute read (~600 words by `wc -w`, mostly bullets, light on the how).
- Work that isn't committed yet goes under "Uncommitted" in the Log.
- Commit locally. Push only when the user asks.
- AI use is disclosed openly. Naming Claude or other tools in the repo is fine. Don't add co-author or attribution lines to commits.

## Code rules
- Plain HTML, CSS and vanilla JavaScript. No frameworks, no build step, no npm packages at runtime.
- Online parts are only these two, and the prediction always runs on the phone:
  - **Firebase Realtime Database** for the shared search (case, events, messages), used through its REST API (`fetch` + `EventSource`) in `sync.js`, with no SDK. Supabase is the fallback.
  - **A tiny serverless LLM proxy** (`proxy/`) that holds the DeepSeek key and returns JSON only.
- **Never put an API key in the website's code** or commit one to the repo.
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
Runs the tests (Nathan's `tests/`).

Note: the repo owner's global git ignore lists `CLAUDE.md`. The file was force-added once (`git add -f`) and is tracked normally now.
