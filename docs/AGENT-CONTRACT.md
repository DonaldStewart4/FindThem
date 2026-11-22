# Agent contract: how an AI agent may talk to FindThem's intelligence layer

Branch `agent-contract`. Owner: Nathan. Written Nov 22. **Status: approved by Nathan on Nov 22.** `ReportDraft` v2, street corners and `assigned.toId` are now in `INTERFACES.md`. Parts of the contract are built and tested (marked *built*); the rest is specified, not built.

## The principle

The AI agent sits between a frightened person and the search map. **We assume it is unreliable.** Today the agent is Jev (TypeSafe AI) in the report box, plus the optional voice bot. Later it could be any LLM front end.

- The agent **reads and proposes**. It never sets a probability, never writes an event, and never gives search advice of its own.
- **Only a confirmed, schema-valid event changes the map.** The person confirms it; the screen writes it.
- **Accuracy beats speed.** A wrong answer can send searchers the wrong way and cost a life. A blank field only costs the person a tap. When in doubt, the agent leaves the field empty and says so.

```
 person ──text/voice──▶ agent ──draft──▶ validateClue ──▶ proposeClue (preview, on the phone)
                          ▲                                   │
                          │ reason codes only                 ▼
                       explain ◀── engine ◀── Event ◀── person taps Confirm ── screen writes it
```

The **intelligence layer** is the engine (`engine/index.js`) plus the checkers in `report.js`. Everything it hands the agent is data or codes. Everything the agent hands back is a draft.

## Versions

| Schema | Version | Where |
|---|---|---|
| `CaseInput` | 1 | `INTERFACES.md` §1 |
| `CaseDraft` | 1 | below (proposed) |
| `ReportDraft` (a clue draft) | **2** | below; `report.js` `DRAFT_SCHEMA` (*built*) |
| `Event` (a clue) | 1 | `INTERFACES.md` §1 |
| `AgentReply` | 1 | below (proposed) |

- Every call from the agent names the schema version it targets (`schema: 2`). A version the layer doesn't know is rejected with `schema_version`.
- Any change bumps the version. Readers accept the current and the previous version.
- New fields are optional and are left out when empty, so a version-1 `ReportDraft` is still a valid version 2.

## Schemas

### `ReportDraft` v2 (a clue draft) — *built*

Version 1 (`INTERFACES.md` §5), plus two optional lists of **codes, never text**:

```js
ReportDraft = {
  kind: 'sighting' | 'searched' | 'message',
  placeText: 'Lake Elizabeth' | '',   // only ever a name from the nearby-places list the phone sent
  lat, lng,                            // that place's own point, or null (the person taps the map)
  direction: 'E' | null,
  minutesSince: 10 | null,
  reliability: 0.3 | 0.6 | 0.9,
  note: '...',                         // only ever the person's own words, cut at 300 characters
  unsure: ['place', 'direction'],      // optional: fields the reader wasn't sure about
  flags: ['water', 'conflict'],        // optional: safety warnings for the screen
}
```

- **`unsure`** ⊆ `kind, place, direction, minutesSince, reliability`.
  - A `place`, `direction` or `minutesSince` in `unsure` is **always empty**: `validateDraft` empties it. So a guess can never sit in the form.
  - A `kind` or `reliability` in `unsure` holds a default (sighting / 0.6) that the person must check.
- **`flags`** ⊆ these, in this order:

| Flag | Meaning | What the screen should say (English; all 5 languages go in `i18n.js`) |
|---|---|---|
| `emergency` | hurt, fallen, in the water | "Call emergency services now." |
| `water` | the report mentions water | "Water nearby: don't go in. Leave it to professionals, and call emergency services if they may be in the water." |
| `vehicle` | car, bus, train | "They may be in a vehicle. Tell the police now: they could be far away." |
| `conflict` | the report says two different things, or the two readers disagreed | "Parts of this report don't agree, so I left them empty." |
| `guess` | a guess or worry, not a sighting | "This sounds like a guess, so I didn't put it on the map." |
| `other_person` | it turned out to be someone else | "This sounds like someone else, so I didn't put it on the map." |
| `joke` | reads like a joke or sarcasm | "This didn't read as a real report, so I didn't fill anything in." |

Flags only ever add caution. None of them changes the map.

### `Event` v1 (a clue) — *built*, unchanged

`sighting` and `searched`, exactly as in `INTERFACES.md` §1. A clue exists only after the person taps Confirm. The screen builds it from the form (`app.js` `saveSighting`, `markSearched`), never from the agent's draft directly.

### `CaseDraft` v1 (proposed)

What an agent may propose when a case is being set up:

```js
CaseDraft = {
  schema: 1,
  lastSeen: { lat, lng } | null,       // from a place the person picked, or a map tap; never invented
  minutes: 45 | null,
  direction: 'NE' | null,
  mobility: 'normal' | 'slow' | 'walker' | null,
  familiarPlaces: [ { lat, lng, label } ],   // 0 to 3, each one the person confirmed
  unsure: ['minutes', 'mobility'],     // same rule as ReportDraft
}
```

The agent never sets `seed`. The screen picks it once when the search is created.

### `AgentReply` v1 (proposed)

Anything the agent says is built from this, using fixed sentences from `i18n.js`. It is never the agent's free text:

```js
AgentReply = {
  schema: 1,
  say: [ { code: 'filled', fields: ['place', 'minutesSince'] },
         { code: 'unsure', fields: ['direction'] },
         { code: 'flag', flag: 'water' },
         { code: 'check_then_confirm' } ],
  quote: 'the person\'s own words'     // optional; the only free text allowed
}
```

The voice read-back in `app.js` (`readBackText`) already works this way.

**Changed Nov 22 (Nathan):** a reply may now be **generated** wording, under constraints. It goes through `POST /say`, and `replies.js` `checkReply` holds every number, place and direction to `data`, bans advice and promises, and falls back to the fixed template on any failure. `emergency` and `found` stay fixed. See `docs/REPLIES.md`.

## The functions

All of them run on the phone and are pure: same inputs, same output on every phone. None of them writes to Firebase.

### `caseGaps(case) → [ Gap ]` (proposed)

What is missing from the case, ranked by how much each answer would change the map.

```js
Gap = {
  field: 'direction',            // lastSeen | minutes | mobility | direction | familiarPlaces
  impact: 0.31,                  // 0..1, see below
  changesTopSectors: true,       // would some answer change the 3 sectors searchers get first?
  question: { code: 'ask_direction', type: 'choice',
              options: ['N','NE','E','SE','S','SW','W','NW','unknown'] }
}
```

- **Impact.** For field *f* with possible answers *v₁…vₙ*:
  - impact(*f*) = (1/n) Σᵢ TV(p, pᵢ), where TV(p, q) = ½ Σ |p − q| over every grid cell, plus one extra cell for "rest of world" once prior v2 lands.
  - `p` is the current map. `pᵢ` is `replay` with *f* = *vᵢ*.
  - Both are normalized to sum to 1, so it works before and after prior v2.
  - TV is 0 when an answer changes nothing and 1 when it moves the whole map.
- **Answer sets:**
  - direction: the 8 compass points;
  - mobility: 3;
  - minutes: 15 / 30 / 60 / 120 / 240;
  - familiarPlaces: one place at each of the current top 3 spots.
- `lastSeen` missing is always first, with impact 1: there is no map without it.
- Ties are broken in the field order above.
- Gaps that are already answered are not listed. Answers in `unsure` are listed again.
- **Cost:** about 20 `replay` runs. Run them in a Web Worker with N_WALKERS ÷ 5 (it's only a ranking), and only when the case changes.
- **The agent may only ask** `question.code` (a fixed sentence in `i18n.js`) with `question.options`. It may not reword the question, add options, or suggest an answer.

### `validateCase(draft) → { ok, value, errors, unsure }` (proposed)

- Checks a `CaseDraft`.
- `value` is a `CaseInput` without `seed`.
- `errors` is a list of `{ field, code }`, with codes `missing`, `out_of_area`, `out_of_range`, `bad_enum`, `too_many`, `schema_version`.
- `ok` is false while any required field is missing or any field is in `unsure`.

### `validateClue(draft) → { ok, value, needs, flags }` (*built* as `confineDraft` + `validateDraft`)

- `value` is the cleaned `ReportDraft` v2 (`report.js`):
  - only known codes are kept;
  - unsure fields are emptied;
  - `note` is replaced by the person's own words;
  - `placeText` must be a name the phone sent, and the pin is that place's own point.
- `needs` lists what the person must still do: `pin` (a sighting with no point), `sector` (a searched report: the person picks the area), `kind` / `reliability` (in `unsure`).
- `ok` is true only when `needs` is empty. Even then, nothing is written until the person taps Confirm.
- *Built:* `validateDraft`, `confineDraft` (in `parseReport`), `draftToEvent`. *Not built:* the `{ ok, needs }` wrapper.

### `proposeClue(draft) → Preview` (proposed)

A preview of the map change before the person confirms.

```js
Preview = {
  candidate: Event,               // NOT written anywhere
  shift: 0.18,                    // TV(map now, map with this clue)
  topSectorsBefore: ['r12c7', 'r11c7', 'r12c8'],
  topSectorsAfter:  ['r9c4',  'r12c7', 'r9c5'],
  hazardNearby: 'creek' | null,   // HAZARD_TYPES within the new top sectors
  reasons: [ Reason ]             // as in explain()
}
```

- It runs `replay(area, case, events + [candidate])` on the phone only.
- If `validateClue` isn't `ok`, the result is `{ abstain: 'needs', needs }` and there is no preview.
- The agent may say "If you confirm, the likely area moves toward {place}" from `reasons`. It may never say "go there".

### `myAssignment(searcherId) → Assignment | Abstain` (proposed)

```js
Assignment = { sectorId, route: Route, minutes, reasons: [ Reason ] }
Abstain    = { abstain: 'no_assignment' | 'professionals_only' | 'no_map' }
```

- **Source:** the newest `assigned` event for this searcher. Otherwise, the best `nextSectors` sector not assigned to anyone else.
- **Needs:** `assigned` events to carry `toId` (the searcher id). Today they carry only a name, and app.js doesn't write them yet. That's an `INTERFACES.md` change.
- A sector whose route has no streets (`routeFor(...).points` is empty) is **never** given to a volunteer: the result is `professionals_only`.

### `explain(target) → { target, reasons: [ Reason ] }` (proposed)

`target` is `{ sectorId }` or `{ spot: i }` (the i-th of `topSpots`).

```js
Reason =
  | { code: 'probability', value: 0.043 }                      // share of the map
  | { code: 'rank', value: 2 }
  | { code: 'walker_share', value: 0.12 }
  | { code: 'near_feature', type: 'creek', name: 'Laguna Creek', distanceM: 40 }
  | { code: 'near_street', name: 'Paseo Padre Parkway', distanceM: 25 }
  | { code: 'sighting_nearby', minutesAgo: 10, reliability: 0.6, distanceM: 120 }
  | { code: 'searched', minutes: 40, pod: 0.55 }
  | { code: 'hazard', type: 'water' }
  | { code: 'rest_of_world', value: 0.08 }                     // after prior v2
```

- The agent may only put these reasons into words, one fixed sentence per code.
- It may not add a cause, rank places itself, compare them with its own judgment, or describe a hazard as safe.

## What the agent must say when it abstains

The agent abstains when:

- an answer is below `MIN_CONFIDENCE`;
- the report contradicts itself;
- the two readers disagree;
- a flag says it isn't a sighting;
- validation fails;
- it is asked something outside this contract.

It then says **exactly** these sentences (English shown; each is one `i18n.js` key in all 5 languages), and nothing else:

| Situation | Sentence |
|---|---|
| some fields left empty | "I wasn't sure about: {fields}. Please fill them in yourself." |
| nothing could be read | "I couldn't read this report, so the form is empty. Please fill it in yourself." |
| a flag | the sentence for that flag (table above), most urgent first |
| asked for advice ("where should I look?") | "I can't give search advice. Your area is on the map." (followed by `myAssignment`, if any) |
| no assignment | "You don't have an area yet. Ask the person running the search." |
| `professionals_only` | "This area is for professionals, not volunteers." |
| always last | "Check the form, then tap Confirm." |

The "Call emergency services first" banner stays on screen whatever the agent says.

## The Jev safety layer (*built*)

`proxy/jev.js` `safeJevDraft`, called by `proxy/worker.js` on every report:

1. **Choices only.** Jev is asked only `choice` and `score` questions, so none of its answers can be free text. An answer that isn't one of the options offered counts as no answer.
2. **Not sure → empty.** Below `MIN_CONFIDENCE` (0.5), the field is left empty and listed in `unsure`. A close call (top two options within `MIN_MARGIN`, 0.15) costs `CONFLICT_PENALTY` (0.25) of confidence.
3. **Two answers in the report → empty.** Two places, two directions or two times in one report leave that field empty. "Definitely" + "not sure" becomes "maybe" (0.3).
4. **A second reader.** The phone's word rules (`quickread.js`) read the same report. If both readers answer a place, direction or time and they disagree, that field is left empty. Sighting against searched is treated the same way. Any other kind disagreement costs `CONFLICT_PENALTY`. If the word rules find hedge or certainty words, the lower reliability wins.
5. **Interpret, don't invent.** A place, direction or time from Jev needs words of that kind in the report, in any of the 5 languages ("by the lake" can become Lake Elizabeth). "Certain" needs certain words; otherwise it drops to "probably".
6. **Not a sighting, whatever Jev says:**
   - a joke;
   - someone else;
   - with no "saw" words: a guess, "he took the car", or "I can't find him".
7. **Flags from word rules.** The safety checks never depend on Jev being right.
8. **A flag warns; it never drops a true sighting.**
   - "I saw him by the lake 10 minutes ago" is a sighting pinned at the lake, with the `water` warning.
   - With no place name in the report, a feature word ("the lake", "el lago", "le lac", "湖", "the creek", "the park") is pinned to the one nearby place of that kind, and only if there is exactly one. A plural like "Quarry Lakes" counts too.
   - Only `joke`, `other_person`, and, with no "saw" words, `guess` / `vehicle` / "I can't find him" turn a report into a message. `water`, `emergency` and `conflict` never do.
9. **Street corners.** The phone sends where its nearby streets cross (`quickread.js` `findIntersections`, one point per corner).
   - Two streets joined by "and / & / y / con / et / 和 / 与 / と", or with a corner word ("corner", "esquina", "cruce", "coin", "carrefour", "路口", "交差点"), are pinned at their corner.
   - Not a corner, so the place stays empty and is a `conflict`:
     - the streets don't cross;
     - they cross in two places;
     - a third place is named;
     - the names aren't joined ("on Paseo Padre, then later on Stevenson");
     - no corner list was sent.
   - If Jev names one street of the corner, the readers agree and the corner is pinned. Jev naming any other place is a disagreement.
10. **Vehicle words are read in the report's own language.** French "car" is "because", and Spanish "van" is "they go".
    - The language comes from the report itself: kana → Japanese, Han characters → Chinese, else the most common words of en / es / fr.
    - The app's language only breaks ties, because people don't always type in the app's language.

The backup reader (`quickread.js` `readLocally`) applies rules 3, 6 and 7 itself.

## How it's measured

`bench/safety-cases.json` has 74 adversarial reports in en/es/fr/zh/ja: creek guesses, true sightings by the lake and creek, contradicting sightings, street corners (and two streets that aren't a corner), wrong street names, sarcasm, panic, typos, someone else, vehicles, French "car" = "because", "definitely" + "not sure", second-hand reports, plus controls. `bench/safety-eval.js` scores each one as **right / abstained / dangerous**. Dangerous means one of:

- a filled place, direction or time that is wrong;
- a sighting that isn't one;
- a sighting/searched swap;
- a reliability that is too high;
- a missing must-have flag, or a flag that would mislead (`mustNotFlag`);
- a true sighting that a flag turned into something else.

Results on Nov 22 (74 cases):

| Reader | Right | Abstained | Dangerous |
|---|---|---|---|
| Backup word rules **before** this work (`quickread.js` at `439e868`) | 17 | 14 | **43** |
| Backup word rules now (`npm run safety-eval -- --local`) | 68 | 6 | **0** |
| The same, with no app language and no corner list (what app.js sends today) | 62 | 12 | **0** |
| A fake Jev that is confidently wrong on everything, through the layer (`--hostile`) | 36 | 37 | **1** |
| A fake Jev that gets the kind right and invents details, through the layer (`--hostile-details`) | 37 | 37 | **0** |
| Jev itself (`npm run safety-eval`) | needs the TypeSafe key | | |

- The one `--hostile` miss is a report with typos in every word ("lo bi en el parke sentral"). The word rules can't read it, so nothing contradicts Jev's "searched".
- The layer's cost: a perfect Jev answer set on `bench/jev-cases.json` keeps 137 of 138 fields. `tests/safety.test.js` checks it stays ≥ 95%.

## Jev against TypeSafe's published API (checked Nov 22 against docs.typesafe.ai)

| Item | Docs | `proxy/jev.js` |
|---|---|---|
| Endpoint, auth | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer` | same |
| Body | `{ model, state, questions }`; `state` may be text or JSON | same |
| Model | `jev-latest` is an alias; it pointed to **`jev-1.14.0`** on Nov 22 (not 1.13.0). Each response's `model` says which version answered | alias kept; tuned on 1.14.0 (see NATHAN.md: pin it?) |
| Choice | `criteria` = object of options (up to 255); answer `choice`, `probabilities`, `confidence` | same |
| Score | `criteria` = ordered array, 2–10 levels; `score` is the probability-weighted **mean** | **fixed**: we used `round(score)`; now the most likely level, never above the rounded mean, ties to the lower |
| Yes/no | type **`noul`**, answer `noul` (0–1), no confidence. Vercel's AI SDK calls it `boolean` | not used; a test checks we never send `boolean` |
| Confidence | how concentrated the probabilities are, not the chance of being right; the docs' example floor is 0.5 | `MIN_CONFIDENCE` 0.5, confirmed by a sweep (below) |
| "Choice option order" | Jev leans toward the **first** option | **fixed**: every choice lists its safe option first (`message`, `unknown`, `none`). Minute options are words, because JavaScript always puts number-like keys first |
| Errors | 429 / 529: back off and retry | 3 attempts, 0.8 s then 1.6 s |

## Tuning on real Jev answers (Nov 22)

### How it was done

- **The blind set.** `bench/blind-cases.json` holds Nathan's 120 blind reports, written without seeing the readers. `bench/split-blind.js` (seed 20261122, balanced by language × kind) splits it into two halves:
  - `blind-dev.json`: looked at, only to find *categories* of problems;
  - `blind-test.json`: never looked at, scored once at the end.
- **The scorer.** `bench/eval.js` scores every set. `acceptable` answers count as right; minutes are compared by Jev's buckets; for searched reports, minutes are the time spent searching; dangerous cases are split high / medium / low.
- **Saving Jev's answers.** The local proxy, started with `DEBUG_ANSWERS`, saves Jev's raw answers (`bench/jev-answers.json`). Rule changes can then be re-scored with `--reader replay`, and a replay check confirms the saved answers reproduce every proxy draft exactly.

### Categories fixed (none for a single report)

**Backup reader:**
- "found him" → message;
- second-hand or far away → "maybe";
- a question ending in "?" → message;
- "bus stop" is a place;
- a car report with no "saw" words → message;
- a sighting told without a "saw" verb.

**Both readers:**
- a place after "toward / from" is not where the person was;
- "BART station" is not BART Way;
- Latin place names inside Chinese/Japanese text (a word-boundary bug of mine);
- a searched report's time = time spent searching.

**Jev's wording:**
- "found" is a message;
- a hedged sighting ("maybe it was her") is still a sighting;
- a general description ("the lake") counts when only one listed place fits;
- second-hand or far away = "unsure".

The `MIN_CONFIDENCE` sweep over the saved answers (jev + safety + blind-dev together; right / empty / wrong, dangerous):

| `MIN_CONFIDENCE` | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 |
|---|---|---|---|---|---|---|
| right / empty / wrong | 500 / 13 / 4 | 502 / 13 / 2 | **503 / 13 / 1** | 500 / 16 / 1 | 495 / 21 / 1 | 487 / 30 / 0 |
| dangerous | 0 | 0 | 0 | 0 | 0 | 0 |

0.5 stays. The one wrong field left is a reliability *lower* than expected, which is the safe direction. Removing it needs 0.8, which costs 16 right answers.

### Before and after

Fields right (empty / wrong); dangerous cases (high / medium):

| Set | Backup reader before | Backup reader after | Jev before | Jev after |
|---|---|---|---|---|
| jev-cases (40) | 143/148, 97% (3 / 2); **0** | 145/148, 98% (2 / 1); **0** | 136/148, 92% (10 / 2); **1** (0/1)¹ | 148/148, 100% (0 / 0); **0** |
| safety-cases (74) | 187/189, 99% (1 / 1); **0** | 187/189, 99% (1 / 1); **0** | 178/189, 94% (11 / 0); **0** | 184/189, 97% (5 / 0); **0** |
| blind-dev (60) | 130/180, 72% (29 / 21); **9** (7/2) | 166/180, 92% (13 / 1); **0** | 146/180, 81% (31 / 3); **1** (0/1) | 171/180, 95% (8 / 1); **0** |

¹ This one was a scorer bug: it counted a *message* draft's reliability as dangerous, although a message never touches the map. It was fixed before tuning.

### The honest number: blind-test, scored once

Scored on commit `4c3a77f`, after all tuning, with nobody having looked at the cases. The scorer printed totals only.

| blind-test (60) | Right | Empty | Wrong | Dangerous |
|---|---|---|---|---|
| Backup reader (`quickread.js`) | 156/190 (82%) | 22 | 12 | **4** (high 2, medium 2) |
| Jev (`jev-1.14.0`) through the safety layer | 176/190 (93%) | 12 | 2 | **1** (high 0, medium 1) |

- Neither reader reached 0 dangerous on reports it had never seen.
- The backup reader falls from 92% on blind-dev to 82% on blind-test, and from 0 to 4 dangerous. Its word rules were fitted to the reports they were checked on.
- Jev through the layer holds up much better: 95% → 93%, 0 → 1 dangerous, and that one is medium (a wrong direction or time, or too-high certainty; no wrong place).
- blind-test is now **spent**. Any further tuning needs a new held-out set written by someone who hasn't seen the readers.

"Before" means after the API fixes above, but before any tuning. "Jev" means Jev through the safety layer, exactly as the proxy returns it, with model `jev-1.14.0`.

## Screen work to show the flags (for the `app.js` session)

Nothing below is built: `app.js`, `index.html`, `style.css` and `i18n.js` were left alone on purpose. The readers already return everything the screen needs.

### 1. Send the corners and the language (`app.js` `readReport`)

```js
import { readLocally, findIntersections } from './quickread.js';
// ...
const places = nearbyPlaces();
const intersections = findIntersections(areaCache.osm, places.map((p) => p.name), state.lastSeen);
const lang = i18n.getLanguage();
draft = await report.parseReport(text, { lastSeen: state.lastSeen, places, intersections }, lang);
// and in the catch (backup reader):
draft = report.validateDraft(readLocally(text, { places, intersections, lang }));
```

`findIntersections` is pure and fast (one pass over the ways). It can be cached per area and last-seen point.

### 2. Show the flags: `draft.flags`, in the order given (most urgent first)

- **Where:**
  - `index.html`: add `<div id="sighting-flags" class="flags" role="alert" hidden></div>` at the top of `#sighting-form`, above `#sighting-check`.
  - Add the same as `#message-flags` above the message box, and `#report-flags` under `#report-status`. Message and searched drafts can carry flags too (for example "he took the car" is a message with `vehicle`).
- **What:** one `<p class="flag flag-<code>">` per flag, text `t('flag_' + code, { number: state.emergencyNumber })`.
  - `emergency` and `water` also get a tap-to-call link (`tel:` + `state.emergencyNumber`, like `#call-link`).
- **When:**
  - Shown by `openSightingForm({ draft })` and the message / searched branches of `readReport`.
  - Cleared by `closeSightingForm`, after a message is sent, and when a new report is read.
  - Never auto-hidden: not through `showStatus` and its timeout.
- **`style.css`:** `.flag` is high contrast with a big font. `.flag-emergency` and `.flag-water` use a red background and white text. The others use the existing `.warn` look.

### 3. Highlight the `unsure` fields: `draft.unsure`

| Code | Element | Note |
|---|---|---|
| `place` | `#sighting-where` | already shows `reportNeedPin` when there's no pin; add the `unsure` class |
| `direction` | `#sighting-direction` and its label | leave it on "Unknown" |
| `minutesSince` | `#sighting-minutes` and its label | see the bug below |
| `reliability` | the `sightingSure` fieldset | |
| `kind` | `#sighting-check` | use `reportCheckKind` instead of `reportCheck` |

- Add `.unsure { outline: 3px solid <the warn color>; }`, and add `unsureMark` after the label text.
- Remove the class when the person changes the field.
- **Bug (predates this work):** when `minutesSince` is null, `openSightingForm` puts `0` in the minutes box. An unknown time becomes "just now", the most aggressive guess.
  - Leave the box empty and highlighted instead.
  - `saveSighting` should then ask for a time rather than read empty as 0. `Number('') || 0` does that today.
  - What to require is BenStew's call; the readers already leave it empty.

### 4. Read-back (`readBackText`, English voice only)

- Say the flag sentences first.
- Then use `draft.unsure` for `sayMissing`. Add `sayFieldSure` when `reliability` is unsure, and `sayFieldKind` when `kind` is unsure.

### 5. `i18n.js`: new keys, all five languages

These are AI-written drafts, like the rest of `i18n.js`, and need a native speaker's check. `{number}` is the local emergency number.

| Key | en | es | fr | zh | ja |
|---|---|---|---|---|---|
| `flag_emergency` | Call {number} now. | Llame al {number} ahora. | Appelez le {number} maintenant. | 请立即拨打 {number}。 | 今すぐ {number} に電話してください。 |
| `flag_water` | Water nearby: don't go in. If they may be in the water, call {number}. | Hay agua cerca: no entre. Si puede estar en el agua, llame al {number}. | De l'eau à proximité : n'y entrez pas. Si la personne est peut-être dans l'eau, appelez le {number}. | 附近有水：不要下水。如果他们可能在水里，请拨打 {number}。 | 近くに水辺があります。水に入らないでください。水の中にいるかもしれない場合は {number} に電話してください。 |
| `flag_vehicle` | They may be in a vehicle and far away. Tell the police now. | Puede estar en un vehículo y lejos. Avise a la policía ahora. | La personne est peut-être dans un véhicule, et loin. Prévenez la police maintenant. | 他们可能在车里，已经走远。请立即告诉警察。 | 乗り物に乗っていて遠くにいるかもしれません。今すぐ警察に伝えてください。 |
| `flag_conflict` | Parts of this report don't agree, so I left them empty. | Partes de este aviso no coinciden, así que las dejé vacías. | Certaines parties de ce signalement ne concordent pas : je les ai laissées vides. | 这份报告有些内容互相矛盾，所以我留空了。 | この報告には食い違う部分があるため、空欄にしました。 |
| `flag_guess` | This sounds like a guess, so it isn't on the map. | Esto parece una suposición, así que no está en el mapa. | Cela ressemble à une supposition : ce n'est pas sur la carte. | 这听起来像是猜测，所以没有放到地图上。 | 推測のようなので、地図には載せていません。 |
| `flag_other_person` | This sounds like someone else, so it isn't on the map. | Parece que era otra persona, así que no está en el mapa. | Il semble que ce soit quelqu'un d'autre : ce n'est pas sur la carte. | 这听起来是另一个人，所以没有放到地图上。 | 別の人のようなので、地図には載せていません。 |
| `flag_joke` | This didn't read as a real report, so nothing was filled in. | Esto no parece un aviso real, así que no se rellenó nada. | Cela ne ressemble pas à un vrai signalement : rien n'a été rempli. | 这看起来不像真实的报告，所以没有填写任何内容。 | 本当の報告ではないようなので、何も入力していません。 |
| `unsureMark` | Not sure: please check | No es seguro: revíselo | Pas sûr : vérifiez | 不确定：请检查 | 不確か：確認してください |
| `reportCheckKind` | Check what kind of report this is before you save it. | Revise qué tipo de aviso es antes de guardarlo. | Vérifiez de quel type de signalement il s'agit avant d'enregistrer. | 保存前请确认这是哪种报告。 | 保存する前に、報告の種類を確認してください。 |
| `sayFieldSure` | how sure | qué tan seguro | le degré de certitude | 有多确定 | どのくらい確かか |
| `sayFieldKind` | what kind of report | qué tipo de aviso | le type de signalement | 报告类型 | 報告の種類 |

### 6. Then

- Bump `sw.js`.
- Check by hand in each language: a lake sighting, "he took the car", and "corner of Paseo Padre and Stevenson".
- Build `caseGaps`, `validateCase`, `proposeClue`, `myAssignment` and `explain` once prior v2 is merged, since they read its map.
