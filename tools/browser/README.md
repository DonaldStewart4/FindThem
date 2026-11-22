# Browser checks

Small scripts that drive a real (headless) Chrome through the app, written on Nov 22 for the "prior v2" engine work. They are checks to run by hand, not part of `node --test`.

Start three things from the project folder, each in its own terminal:

```bash
python3 -m http.server 8000
python3 tools/mock-firebase.py
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/findthem-chrome --no-first-run about:blank
```

Then:

| Script | What it checks |
|---|---|
| `node tools/browser/demo-check.mjs [slowdown]` | Presses Demo, waits for the results, prints the top spots, the next areas and any page errors. `4` slows the page's processor four times. |
| `node tools/browser/twotab.mjs` | Two tabs on one shared search (mock database): the same map in both, the share link and the database case carry `minutesAt`, and an area marked searched in one tab reaches the other. |
| `node tools/browser/newarea.mjs` | A brand-new area with a live Overpass download: the first map from the streets alone, then the sharper map when buildings arrive. Needs the internet; can take a few minutes. With `--keep` it leaves the saved area in place and checks that it is reused at once. |
| `node tools/browser/budget.mjs` | Times a cold engine replay inside Chrome at normal speed and slowed four times (the engine runs on the page's main thread here so the slowdown applies to it), and prints the change in JS memory. |

`cdp.mjs` is the tiny helper they share (Chrome DevTools Protocol over a WebSocket; Node 22 or newer). The service worker is bypassed in every script, so each run loads the files fresh, and each script first closes any tabs left open by an earlier run (leftover tabs hold live database connections and make the next check hang).

The proxy's `/voice` check shows a CORS error on `localhost`; that is expected (the deployed proxy only answers the real site) and has nothing to do with these checks.
