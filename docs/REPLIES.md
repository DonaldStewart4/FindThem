# Replies: what the search leader says (POST /say)

Branch `agent-contract`. Owner: Nathan. Built Nov 22 from `docs/INTAKE-SPEC.md`, with one change from Nathan.

## The change to the spec

Principle 2 of the spec said: *"Every sentence the agent says is a fixed template… No LLM writes free text to the user."*

Nathan's change (Nov 22): **replies are GENERATED wording, but constrained.**

- A text LLM may word a reply.
- A checker holds every word to the engine's data, so a reply can say only what a template would say.
- Anything that fails the checker becomes the fixed template.
- `emergency` and `found` are always the fixed template.

The rest of the spec still holds. Jev still only answers multiple-choice questions. Only confirmed, schema-valid data reaches the engine, and generated text never does: a reply is shown or spoken, never stored as an event.

## How a reply is made

```
screen ──getReply(intent, data, lang)──▶ POST /say { intent, data, lang } ──▶ text LLM
   ▲                                          │ checkReply()                    │
   │ checkReply() again on the phone          ▼                                 ▼
   └──────── { text, source, warnings } ◀── fixed template on ANY failure ◀── reply
```

1. **The request is only `{ intent, data, lang }`.** Any other field is a 400. `data` is cleaned per intent: only known fields, short values, nothing with advice, promise or "where they are" words, and no links (`cleanSayData`).
2. **The LLM gets two things:** the fixed template's sentence as MEANING, and the display facts as FACTS. It is asked to say MEANING in its own calm words, in one line of at most two sentences, using only FACTS (`buildPrompt`).
3. **`checkReply()` checks the reply on the proxy, and again on the phone.** A broken or tampered proxy can't put anything on screen. The reply must pass all of these:
   - **Numbers:** every number (digits, or a number word before a unit) must be a number of the facts.
   - **Places:** after the allowed place names are taken out, no place word may be left ("street", "park", "calle", "rue", "街", "公園"…). In en/es/fr, no other capitalized name may appear inside a sentence.
   - **Directions:** no compass word except the case's own direction, and no turns. Compass words are per language, because French "sur" is "on" and Spanish "este" is "this".
   - **Banned content, in 5 languages:**
     - medical advice;
     - saying where the person is ("she is probably at…");
     - water, roads or traffic, and other people's property (a reply never needs them: the warnings below are fixed lines);
     - promises ("we will find him", "don't worry");
     - calling itself a chatbot.

     Words the fixed template itself uses ("garage" in the house question) are allowed.
   - **Shape:** one line, at most two sentences, at most 220 characters (90 in Chinese or Japanese), no markup or links.
   - **Language:** the right script, and for en/es/fr no clear majority of another language's common words.
4. **Fallback:** any failure, no `LLM_API_KEY`, a provider error, a refusal, a cut-off reply, or more than 4 s on the proxy (2.5 s on the phone, or no signal) → the fixed template (`templateReply`).
5. **Warnings** (water, vehicle, "water in this area") are **fixed lines** added after the check. They are never generated.

## Intents and their data

| Intent | `data` (from the engine / screen) | Fixed template (English) |
|---|---|---|
| `ask` | `{ field }`, field ∈ `lastSeen, minutes, travel, houseChecked, direction, mobility, familiar, description, confirmPlace`; `confirmPlace` also needs `place` | The spec's questions, e.g. "About how long ago?", "Did you mean {place}?" |
| `confirm` | `{ kind: 'case', place, minutes, travel, mobility, direction, description }` | "Here is what I have: seen at {place} · {minutes} min ago · walking · … Tap anything to change it." |
| | `{ kind: 'change', minutes }` | "Changed to {minutes} minutes." |
| | `{ kind: 'clue', place, pct }` (from `proposeClue`) | "This would move about {pct}% of the chance toward {place}. Add it?" |
| `abstain` | `{ fields: [draft.unsure codes], flags: ['water' \\| 'vehicle'] }` | "I wasn't sure about: {fields}. Please check them." / "I'm not sure. Please check this yourself." + warning lines |
| `readRoute` | `{ streets: [≤4 names], lengthM, minutes, units: 'metric' \\| 'imperial', hazard, professionalsOnly }` | "Your area: {streets}. About {distance}, {minutes} minutes." / "This area is for professionals, not volunteers." |
| `comfort` | `{}` | "You're doing the right things. Keep going, one step at a time." |
| `found` | `{}` | "They've been found. Thank you, everyone. Please stop searching." (**always fixed**) |
| `emergency` | `{ number }` | "Call {number} now." (**always fixed**) |

All templates exist in en / es / fr / zh / ja (`replies.js`). They were AI-drafted and need a native speaker's check, like the rest of `i18n.js`.

## Provider

Plain `fetch`, no SDK (the project allows no runtime packages).

- **Secret:** `LLM_API_KEY`, set with `npx wrangler secret put LLM_API_KEY`.
- **`LLM_PROVIDER`** (`proxy/wrangler.toml` `[vars]`) is one of:
  - **`anthropic`** (default): the Messages API, `anthropic-version: 2026-10-21`, model `LLM_MODEL` (default `claude-opus-5-5`), `output_config.effort: "low"` (a short wording task), and no `temperature`. On current Claude models it also sets the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), so a policy decline is retried on another model. A reply whose `stop_reason` isn't `end_turn` becomes the template.
  - **`openai-compatible`**: any `/chat/completions` API at `LLM_BASE_URL`, with `LLM_MODEL` required.
- **No key:** `/say` always returns the templates, which is safe and is the state today.

## Tests (`tests/replies.test.js`, 12 tests)

- **Templates:** all 60 generated-intent templates (12 cases × 5 languages) pass their own checker, and every intent has a template in every language.
- **Fixed intents:** `emergency` and `found` never call the LLM, even when the fake LLM is ready with a bad reply.
- **Fallbacks:** no key, a 500, a timeout, a refusal, a cut-off reply and an odd shape all give the template.
- **Request shape:** an extra field, an unknown intent or language, or unusable data → 400. Data that smuggles advice is dropped.
- **Adversarial fake LLM: 720 bad replies, 0 got through.** That's 60 lines × 12 cases, covering invented places, numbers and directions, "she is probably at the lake", wading into the creek, crossing the highway, the neighbors' backyards, "we will find him", pills, an 80% chance that isn't in the data, wrong language, too long, markup and links, and "As an AI chatbot", in all 5 languages.
- **Fuzz:** 500 good replies with one invented number, direction, place or piece of advice planted at a random spot (seeded): all rejected.
- **Good paraphrases:** 12 good ones, in all 5 languages, get through.
- **Tampered proxy:** the phone shows the template.

## Screen hook-up list (for the `app.js` session; nothing here is built in the screen yet)

1. **`sw.js`:** add `'replies.js'` to the shell file list (next to `'quickread.js'`) and bump `CACHE_VERSION`, so replies work offline.
2. **`index.html`:** add one line and one warning box where the search leader speaks, in the intake card and in the report box:
   - `<p id="leader-line" class="leader-line" aria-live="polite"></p>`
   - `<div id="leader-warnings" class="leader-warnings" role="alert" hidden></div>`

   Label the area "Search leader". **Never "chatbot".**
3. **`app.js`:** `import { getReply } from './replies.js';` plus one helper:
   ```js
   async function leaderSays(intent, data) {
     const r = await getReply(intent, data, i18n.getLanguage(), { proxyUrl: PROXY_URL });
     els.leaderLine.textContent = r.text;
     els.leaderWarnings.hidden = !r.warnings.length;
     els.leaderWarnings.replaceChildren(...r.warnings.map((w) => Object.assign(document.createElement('p'), { textContent: w })));
     if (state.voiceCaps.speak && report.canSpeak(i18n.getLanguage())) report.speak([r.text, ...r.warnings].join(' '), i18n.getLanguage());
   }
   ```
   Then call it at these points:
   - **Intake turns** (spec "The conversation"): `leaderSays('ask', { field })`. The field comes from `caseGaps()` once it exists; until then use the spec's order: lastSeen → minutes → travel → houseChecked → direction → mobility → familiar → description.
   - **Jev unsure about the last-seen place:** `leaderSays('ask', { field: 'confirmPlace', place })`.
   - **The confirm card:** `leaderSays('confirm', { kind: 'case', place, minutes, travel, mobility, direction, description })`.
   - **A correction** ("No, 40 minutes"): `leaderSays('confirm', { kind: 'change', minutes: 40 })`.
   - **A report preview** (once `proposeClue` exists): `leaderSays('confirm', { kind: 'clue', place, pct })`.
   - **After `readReport`**, if the draft has `unsure` or the `water` / `vehicle` flags: `leaderSays('abstain', { fields: draft.unsure || [], flags: (draft.flags || []).filter((f) => f === 'water' || f === 'vehicle') })`.
   - **`draft.flags` includes `emergency`:** `leaderSays('emergency', { number: state.emergencyNumber })`, as a red line with the tap-to-call link and nothing else (spec).
   - **When a searcher opens an area** (`routeFor`): `leaderSays('readRoute', {...})` with:
     - `streets`: the route's unique edge names in order, at most 4;
     - `lengthM: route.lengthM`, `minutes: route.minutes`;
     - `units`: `'imperial'` when the app shows miles;
     - `hazard`: the sector has a `HAZARD_TYPES` spot;
     - `professionalsOnly: route.points.length === 0`.
   - **"Found" reported:** `leaderSays('found', {})`.
   - **Comfort:** `leaderSays('comfort', {})`, only on a clear trigger (after an area is marked searched with nothing found). Never on a timer.
4. **`i18n.js`:** move the templates in `replies.js` (the `T` table, plus the direction, travel, mobility and field names) into `i18n.js` keys, or have `i18n.js` import them, so all UI text lives in one place (CLAUDE.md). `checkReply` must keep reading the same sentences.
5. **`style.css`:** `.leader-line` (large, calm), and `.leader-warnings p` in the existing warning style (red for water).
6. **Deploy:** `npx wrangler secret put LLM_API_KEY` (optional; without it everything works, with the templates), then `npx wrangler deploy` in `proxy/`.
