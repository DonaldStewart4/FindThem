# Integrity report: no event can corrupt the shared map

Branch `integrity`, 2026-11-22. Written for Nathan, to read in the morning. Short version: everything asked for is done and committed, and **the real Firebase emulator agreed with our rules evaluator on every step: 0 differences.** One assumption in the evaluator turned out to be wrong, but in the safe direction; it is now fixed (see "Differences found").

## What was asked, and what was done

| Ask | Done |
|---|---|
| Strict rules for every event type; case written once; events append-only; searcher positions as before | Commit 1 (`3c95c6d`) |
| `sync.js` validates incoming events, de-duplicates, carries `engineVersion` | Commit 1 |
| Mock enforces the same rules; tests for malformed, oversized, wrong-type, duplicate and replayed events | Commit 1, extended here |
| `caseUpdate` and `found` in the rules, `sync.js`, the mock and the table | This commit |
| `INTERFACES.md` §6 updated | This commit |
| Run the table against the Firebase emulator | This commit: Java 24 was available; firebase-tools 15.37.0, database emulator v4.11.2 |

### caseUpdate `{ type, field, value?, by, at }`
- **`field`** is one of `minutes`, `minutesAt`, `direction`, `mobility`, `familiarPlaces`, `travel`, `description`. Anything else is refused, including `seed`, `lastSeen` and `engineVersion`.
- **`value` is checked exactly like the case field it replaces:**
  - minutes 1–1440
  - minutesAt a time in ms
  - one of the 8 directions
  - normal / slow / walker
  - 0–3 places `{lat, lng, label ≤ 100}` with nothing extra
  - travel (see below)
  - description text ≤ 300
- **Clearing:** leaving `value` out clears the field. Only `direction` (→ unknown), `familiarPlaces` (→ none) and `description` can be cleared. Firebase can't store null or an empty list, so "cleared" can only be "absent".
- **Append-only** like every event.
- **Latest `at` wins per field.** With the same `at`, the larger push id wins, by Unicode code point (`sync.compareIds`; the test includes a case where code-point order and JavaScript's normal string order differ).
- **Any update beats the case's first value**, even one with an older `at`. Decision: a phone whose clock is a few minutes behind must still be able to correct the case.
- `sync.readMirror`, `subscribe` and `loadSearch` return `caseDoc` with all updates applied and `baseCase` as first written. `info.caseUpdates` counts the updates.

### found `{ type:'found', lat, lng, by?, at, note? ≤ 300 }`
- `lat` and `lng` are required. Extra fields (for example `reliability`, `text`) are refused.
- The engine ignores it.

### Two assumptions you may want to change
- **`travel`:** `'walking' | 'car' | 'bus' | 'unknown'`, from the chips in `docs/INTAKE-SPEC.md` ("Walking · Maybe car · Maybe bus · Not sure").
- **`description`:** plain text ≤ 300. The spec says "color chips + free text"; no structure was defined. If the intake session wants `{ top, text }`, change the rule in all three places; the table will show any mismatch.
- Both are also allowed as optional fields of the case itself, so a case can be created with them.

## How it was tested

- **One table of 118 events:** 30 good, 88 bad, 1 of the bad ones refused only by the server (a time 2 h in the future: phones don't check their own clock). That's the 75 from commit 1, plus 36 caseUpdate and 7 found rows.
- **Plus write scenarios:**
  - append-only: overwrite, single-field edit, delete, replacing the whole list, deleting the search
  - lone-field writes
  - a whole event sent field by field in one PATCH
  - a PATCH with an extra field
  - POST, good and bad
  - an all-or-nothing multi-path PATCH, checking that nothing from a refused PATCH is stored
  - bad search id
  - write-once case, 14 bad cases, starting a case one field at a time
  - searcher overwrite, remove and bad shapes
  - over HTTP only: a non-JSON body → 400, reading the whole database → 401
- **The same scenario list runs against four stand-ins**, and each must give the expected answer to every step:
  1. `sync.js` `checkEvent` / `checkCase` (what phones accept)
  2. `firebase-rules.json` in the small evaluator in `tests/sync.test.js`, run twice: checking the levels above the written path, and not checking them
  3. `tools/mock-firebase.py` over HTTP
  4. **the Firebase Realtime Database emulator** over HTTP, with `firebase-rules.json` loaded
- **Results:**
  - `node --test` (everything): 127 tests, 126 pass, 0 fail, 1 skipped. The skipped one is the emulator test, which runs only when `FIREBASE_EMULATOR` is set.
  - With the emulator running: `node --test tests/sync.test.js` gives 25 tests, 25 pass, 0 fail, 0 skipped. Test 24, "the Firebase emulator gives the expected answer to every write scenario", passes with no disagreements.

### Proof the emulator test isn't empty
- The emulator applies `firebase-rules.json` only to the namespace `demo-findthem-default-rtdb`. Other namespaces are open (probe: a bogus event got 200 in `ns=demo-findthem` and 401 in `ns=demo-findthem-default-rtdb`). The test uses the right one.
- **Mutation A:** loosening `reliability` to also accept 0.5 made the emulator accept a 0.5 sighting (200). So it really runs our rules file, and the 0-difference result means agreement, not "nothing was checked".
- Commit 1's mutation check still holds: loosening one rule and one mock check each makes the table fail.

## Differences found

**Evaluator vs. emulator, 1 difference in how rules are run (no difference in results with our rules):**
- **What the evaluator assumed:** a `.validate` rule runs only at the written place and below it. That's the weaker reading of Firebase's docs.
- **Mutation B:** I removed the case's completeness check from its `.write`, keeping it in the case's `.validate`. The emulator *still* refused a lone `case/minutes` write (401) and a lone `case/lastSeen/lat` write (401).
- **Conclusion:** real Firebase also runs `.validate` on the levels *above* the written place, against the data as it would be after the write. It is stricter than the evaluator assumed.
- **Effect on our rules:** none. They put every completeness check in `.write`, so they are safe under both readings. That's why the real rules gave 0 differences.
- **Fixed:** the evaluator now also checks the levels above (the real behaviour). The scenarios run both ways, so the rules stay safe even if that detail changes.

**Bugs found in my own work while building the table** (all fixed before commit):
- commit 1: the rules accepted `track: "r1c1"` (text instead of a list); sync.js accepted an event with a stored `id` field
- this commit: none in the rules; two test-code mistakes

## How to re-run the emulator check

```bash
npm install firebase-tools            # once, anywhere (not a dependency of the app)
# firebase.json next to a copy of firebase-rules.json:
#   { "database": { "rules": "firebase-rules.json" },
#     "emulators": { "database": { "port": 9123 }, "ui": { "enabled": false } } }
firebase emulators:exec --only database --project demo-findthem \
  "FIREBASE_EMULATOR='http://127.0.0.1:9123?ns=demo-findthem-default-rtdb' node --test tests/sync.test.js"
```
- `demo-` project ids need no login.
- If firebase-tools fails with "update check failed … ~/.config", run it with `HOME` set to a writable folder (that's what I did).

## Not tested / still open

- **Not tested on the real Firebase database.** The emulator is Google's own rules engine, so this should match. Still do the planned test on the real database before publishing: deploy the rules, then two phones.
- **`sync.js` itself never talked to the emulator.** sync.js builds URLs without `?ns=`; the scenarios use raw HTTP. sync.js was tested end to end against the mock only.
- **The live-stream format for multi-path PATCHes from real Firebase wasn't seen.** `applyChange` handles both "patch with `a/b` keys" and separate puts.
- **Screen work** (`app.js`, `i18n.js`, `sw.js`) is listed in `UPDATESBYNATE.md`:
  - show the version warning
  - send `caseUpdate` when a case field is corrected after sharing, and use `caseDoc` from sync
  - a "Found" button that sends `found` and ends the search
  - handle `error: 'invalid'`
  - clamp minutes
  - bump the cache version
- **The rules generator was a scratch script.** `firebase-rules.json` is the source now; edit it by hand and run the tests. They check it against sync.js, the mock and (optionally) the emulator.
- **Lies aren't stopped.** A well-formed but false event (a made-up sighting) is accepted. There are no accounts; that's out of scope.
