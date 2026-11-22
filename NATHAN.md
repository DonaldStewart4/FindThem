# Nathan: to-do list

What BenStew would like Nathan to do before the deadline. **Code freeze Sun Nov 22, 9:30 am. Submit by 11:00 am.**
Top to bottom is the order of importance. Tick a box when it's done and commit (with a `CommitHistory.md` entry, see `CLAUDE.md`).

Live site: https://donaldstewart4.github.io/FindThem/

## 1. Get the TypeSafe AI API key (BenStew doesn't have one)
Without it, the report box shows only the plain form, and Jev can't fill in the draft.

- [ ] Make a TypeSafe account and create a key at https://console.typesafe.ai/keys. It's paid by usage (about $0.04 per million words in). A few dollars of credit is plenty for testing and the demo.
- [ ] Put the key into the Cloudflare Worker as a **secret**. Pick one way:
  - **Best:** BenStew adds you to his Cloudflare account (dash.cloudflare.com → Manage Account → Members). Then, from the project folder:
    ```bash
    cd proxy
    ```
    ```bash
    npx wrangler login
    ```
    ```bash
    npx wrangler secret put TYPESAFE_API_KEY
    ```
    Paste the key when asked. It doesn't show on screen.
  - **Or:** hand the key to BenStew in person or through a password manager's share, and he runs the same `secret put` command.
- [ ] **Never** put the key in the repo, `config.js`, a commit, a screenshot, a group chat or an AI chat. If it leaks, delete it on the TypeSafe site and make a new one.
- [ ] Check that it works (replace the address with the one `npx wrangler deploy` printed):
  ```bash
  curl -X POST https://findthem-proxy.<you>.workers.dev/ -H 'Origin: https://donaldstewart4.github.io' -H 'Content-Type: application/json' -d '{"text":"saw him by the lake 10 minutes ago walking east","lang":"en","context":{}}'
  ```
  You should get a JSON draft back with `"kind":"sighting"`.

## 2. Tune the Jev questions with real reports
- [ ] Once the key is in, run the scorer: it sends 40 realistic reports (all 5 languages, `bench/jev-cases.json`) through the live proxy and shows what Jev gets right, leaves empty, or gets wrong:
  ```bash
  npm run jev-eval -- --show
  ```
  For comparison, the phone's backup word rules (`quickread.js`) score 95% on the same set (`npm run jev-eval -- --local`), but they were written alongside these reports, so Jev should be judged on reports it hasn't seen too.
- [ ] Add your own real-sounding reports to `bench/jev-cases.json`, the way a panicking family member would type or say them. Jev's support for other languages isn't documented, so note what fails.
- [ ] Adjust the question wording and `MIN_CONFIDENCE` (now 0.5) so wrong answers get left empty rather than guessed.
- [ ] Keep `tests/jev.test.js` passing, and add a test for anything you change.

## 3. Test on two real phones (one iPhone, one Android if possible)
- [ ] **Sharing:** start a search on phone A, open the share link on phone B, and check that searched areas, sightings and messages show up on both.
- [ ] **Voice with a real mic:** tap Speak, say a report, and check the form fills in. On iPhone especially, check that recording works. In English, the form should be read back aloud; in other languages, nothing should be spoken.
- [ ] **Offline:** open the app once, turn on airplane mode, reopen it. The Demo should still run, and messages should say "no internet", not "server busy".
- [ ] **Direction arrow:** drag it with a finger on the map; the pill should change (Northeast, East…).
- [ ] **Speed:** time the Demo button on each phone.
- [ ] Write down anything broken or confusing (phone model, browser, steps, screenshot) and send it to BenStew.

## 4. UI review
- [ ] Go through every screen on a phone as if a relative just went missing. Is it obvious what to tap first? Is any text too small, unclear or untranslated? Report anything confusing.

## 5. Tests and reliability
- [ ] Run the tests and keep them green (64 pass right now):
  ```bash
  node --test
  ```
- [ ] Add a test for each bug found in step 3, if it can be tested without a phone.
- [ ] Re-run the benchmark (`npm run bench`) **only if the engine changes**, and update the tables in `README.md` and `bench/results.md`.
- [ ] Be ready to explain the tests you own (`tests/`, `bench/`), including any that AI helped write.
