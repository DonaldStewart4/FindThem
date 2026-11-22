# Updates by Nate: notes for the screen

Changes Nathan's sessions made that the screen side (`app.js`, `i18n.js`, `sw.js`, `INTERFACES.md`) needs to know about or act on. Newest first. Each item says what changed, what the screen must do, and what breaks if it doesn't.

## 2026-11-22 (later): `caseUpdate` and `found` events (branch `integrity`)

Files changed: `firebase-rules.json`, `sync.js`, `tools/mock-firebase.py`, `tests/sync.test.js`, `INTERFACES.md` §6 (approved by Nathan). The full report is in `docs/INTEGRITY-REPORT.md`.

### What changed for the screen
- **New event `caseUpdate { type, field, value?, by, at }`** changes one case field after the search was shared. The case itself can still only be written once.
  - `field`: `minutes`, `minutesAt`, `direction`, `mobility`, `familiarPlaces`, `travel`, `description`.
  - `value` is checked like that case field. Leave `value` out (or pass `null` / `[]`; sync.js drops them) to clear `direction`, `familiarPlaces` or `description`.
- **New event `found { type, lat, lng, by, at, note? }`**: the person was found.
- **`caseDoc` from `sync.subscribe` / `sync.loadSearch` now has every caseUpdate applied** (the latest `at` per field wins; ties go to the larger id). `baseCase` is the case as first written, and `info.caseUpdates` counts the updates.
- **New optional case fields:** `travel` (`'walking' | 'car' | 'bus' | 'unknown'`) and `description` (text ≤ 300). These are my reading of `docs/INTAKE-SPEC.md`; say if the intake session wants another shape.
- New exports in `sync.js`: `applyCaseUpdates`, `compareIds`, `TRAVEL`, `CASE_UPDATE_FIELDS`.

### What the screen should do (not done; these files aren't mine)
1. **Corrections after sharing** ("actually 40 minutes"): send a `caseUpdate` with `recordEvent` instead of changing the form only on this phone.
   - For `minutes`, also send a `minutesAt` update with the same `at`, so every phone counts the minutes from the same moment.
2. **Use `caseDoc` from `sync.subscribe` to rebuild the case on every change.** Today `startLive` reads only `caseDoc.startedAt`, so another phone's correction would not reach this phone's map.
3. **A "Found" button**: send `found` at the searcher's position, stop sending positions, show the end-of-search state and the hand-off sheet. All UI text goes in `i18n.js` (5 languages).
4. `engineEventsKey` in app.js only counts `searched` and `sighting`. Add `caseUpdate`, or the map won't recompute when only the case changes.

## 2026-11-22: event integrity (branch `integrity`)

Files changed: `firebase-rules.json`, `sync.js`, `tools/mock-firebase.py`, `tests/sync.test.js`. No screen file was touched.

### What changed for the screen
- **Firebase now refuses anything that isn't exactly a known event.** The known events are `searched`, `sighting`, `message`, `assigned`, `released` and `completed`, each with the right fields, types and ranges and nothing extra. Events can't be edited or deleted, and the case can be written only once.
- **`sync.subscribe` callback has a 4th argument, `info`:** `onChange(caseDoc, events, searchers, info)`. The old 3-argument callback still works.
  - `info.versionMismatch` is true when the case was made by a different engine version, so this phone may draw a different map.
  - `info.caseEngineVersion` and `info.engineVersion` give both versions.
  - `info.dropped` and `info.duplicates` count events left out because they broke the rules or were copies.
  - `info.caseProblem` says why the case was refused, when it was.
- **`sync.loadSearch` returns `{ caseDoc, events, info }`.** `caseDoc` is `null` if the stored case breaks the rules; app.js then falls back to the case in the link, as it already does when there is no case. `caseDoc.direction` and `caseDoc.familiarPlaces` are now always present (`null` / `[]`); Firebase used to drop them.
- **Only checked data reaches the screen:**
  - `events` holds only valid events, each content-identical copy once, sorted by `at` then `id`.
  - `searchers` holds only valid positions.
  - A garbage message from the stream is ignored instead of throwing.
- **`sync.addEvent` and `sync.createSearch` can return `{ ok: false, error: 'invalid', reason }`.** The event or case broke the rules, so it was not queued and not sent (example reasons: `'bad:minutesSince'`, `'extra:foo'`).
- **Events are now sent with PUT at an id the phone makes** (Firebase push-id format), not POST. A retried send can't create a second copy.
- **`createSearch` adds `engineVersion` to the case** and cuts `startedBy` to 40 characters and familiar-place labels to 100.

### What the screen should do (not done; these files aren't mine)
1. **Show a warning when `info.versionMismatch` is true**, for example "This search was started on a different version of FindThem. Reload to update; maps may differ until then." Add the text to `i18n.js` in all 5 languages. Today the flag is only logged to the console.
2. **Handle `error: 'invalid'` in `recordEvent`.** The optimistic copy currently stays on this phone's map even though it was never sent. Either check it first with `sync.checkEvent(event)`, or remove it from `state.optimistic` and show a status.
3. **Clamp before recording.** These values break the rules:
   - sighting `minutesSince` above 1440: the field has `max="1440"`, but typing 5000 is possible.
   - `searched.minutes` below 1 or above 600: `markSearched` only checks `> 0`, so 0.5 or 900 gets through.
   - planner `completed.minutes` below 1: round up to at least 1.
4. **Familiar-place name field:** add `maxlength="100"` (sync.js cuts longer names, so nothing breaks).
5. **Engine version:** ideally `engine/index.js` exports `ENGINE_VERSION` and app.js calls `sync.setEngineVersion(ENGINE_VERSION)` at start. Until then `sync.js` holds `ENGINE_VERSION = '2026-11-22.1'`; bump it whenever the engine's output changes for the same inputs (for example when `prior-v2` merges).
6. **`app.js` `currentEvents` de-duplicates by `cid` alone.**
   - `cid` is `local-<ms>-<counter>`, so two phones can produce the same one, and anyone can copy one.
   - A different event with a copied `cid` would hide the real one on every phone.
   - `sync.js` already removes true copies (same content), so app.js could de-duplicate only its optimistic and queued copies against what came back.
7. **Bump `sw.js` `CACHE_VERSION`**, because `sync.js` changed.
8. **Done later the same day:** `INTERFACES.md` §6 was updated (approved by Nathan). It needed:
   - `case` now carries `engineVersion`.
   - Events are written with PUT at a client-made push id.
   - §1's `assigned` should list the planner's shape next to the old one.

### Deploying
- **Publish `firebase-rules.json` and the new `sync.js` together.**
  - An older phone still running the cached `sync.js` can join and add events: real Firebase still accepts a POST of a valid event.
  - An older phone can't create a new search, because its case has no `engineVersion`.
- **Planner events are accepted in both shapes:**
  - the planner shape `{ searcherId, taskId, expiresAt, track, searchMin, partnerId? }`
  - the `INTERFACES.md` shape `{ sectorId, to, toId? }`
  - `track` is a list of up to 2000 whole square numbers (0–999999).
  - If the planner's event shape changes, the rules must change in all three places (rules, sync.js, mock); the test table shows any disagreement.
