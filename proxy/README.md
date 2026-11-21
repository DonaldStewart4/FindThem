# FindThem report-box proxy (Jev)

A tiny Cloudflare Worker (free tier) that turns a typed or spoken report into a `ReportDraft` JSON (see `INTERFACES.md` section 5). It asks **Jev**, TypeSafe AI's model, and holds the TypeSafe API key so the key is never in the website.

Jev doesn't write text. `jev.js` asks it five multiple-choice questions about the report:

| Question | Options |
|---|---|
| kind | sighting / searched / message |
| direction | N … NW / unknown |
| minutes ago | 0, 5, 10, 15, 30, 60 / unknown |
| how sure | maybe / probably / definitely |
| place | one of the nearby named places the app sends / none |

Any answer below `MIN_CONFIDENCE` (0.5) is left empty, so the person fills it in. The person always checks the draft and taps the button before anything reaches the map.

## Optional voice bot: Deepgram + ElevenLabs

`voice.js` adds three routes, used only if their keys are set:

| Route | Service | What it does |
|---|---|---|
| `GET /voice` | none | Tells the app which keys are set: `{ "listen": true/false, "speak": true/false }` (never the keys) |
| `POST /listen?lang=en` | **Deepgram** nova-3 | The person's recording → `{ "text": "..." }`. The app then sends that text to `POST /` as usual |
| `POST /speak` | **ElevenLabs** Flash v2.5 | `{ "text", "lang": "en" }` → MP3. The app reads back what it filled in and what it wasn't sure about. **English only:** any other `lang` gets `400 unsupported_language` without calling ElevenLabs, and the app doesn't even ask outside English |

**No keys, no change:** if `DEEPGRAM_API_KEY` is missing, the app uses the phone's own speech recognition, as before. If `ELEVENLABS_API_KEY` is missing, it doesn't speak. If Deepgram fails during use, the app switches to the phone's speech recognition.

Keys (environment variables of the Worker):

```bash
npx wrangler secret put DEEPGRAM_API_KEY
```

```bash
npx wrangler secret put ELEVENLABS_API_KEY
```

Optional: `ELEVENLABS_VOICE_ID` in `wrangler.toml` `[vars]` picks a different voice (the default is a premade voice from ElevenLabs' docs).

For `npx wrangler dev` on your own computer, copy `.dev.vars.example` to `.dev.vars` in this folder and fill in the keys there. `.dev.vars` is gitignored.

Test after deploying (replace the address; should print `{"listen":true,"speak":true}`):

```bash
curl https://findthem-proxy.<you>.workers.dev/voice -H 'Origin: https://donaldstewart4.github.io'
```

## Deploy (about 10 minutes)

1. Make a free Cloudflare account at https://dash.cloudflare.com.
2. Get a TypeSafe API key at https://console.typesafe.ai/keys. It's paid by usage, about $0.04 per million words in; there's no free tier listed.
3. In a terminal, from the project folder, sign in:

   ```bash
   cd proxy
   ```

   ```bash
   npx wrangler login
   ```

4. Store the key. Paste it when asked; Cloudflare keeps it, not the repo:

   ```bash
   npx wrangler secret put TYPESAFE_API_KEY
   ```

5. Deploy:

   ```bash
   npx wrangler deploy
   ```

6. Wrangler prints the address, like `https://findthem-proxy.<you>.workers.dev`. Put it in `PROXY_URL` in `config.js`.
7. `ALLOWED_ORIGIN` in `wrangler.toml` is already `https://donaldstewart4.github.io`, so only the live site can use the proxy. To test from `localhost`, set it to `"*"` temporarily and deploy again.

Test it (English, then try Spanish, French, Chinese and Japanese; Jev's language support isn't documented):

```bash
curl -X POST https://findthem-proxy.<you>.workers.dev -H 'Content-Type: application/json' -H 'Origin: https://donaldstewart4.github.io' -d '{"text":"I think I saw him by Lake Elizabeth 10 minutes ago, blue coat, walking east","lang":"en","context":{"places":[{"name":"Lake Elizabeth","lat":37.5487,"lng":-121.9637}]}}'
```

## Limits

- Text is cut at 1,000 characters; at most 60 nearby places.
- About 20 requests per minute per IP (best effort, kept in worker memory). If Jev is busy (429/529), the worker retries once.
- Only POST (and the browser's OPTIONS check) is allowed.

## Privacy

With the voice bot set up: the recording goes to **Deepgram** to become text, and the read-back sentence (kind, place name, minutes, direction) goes to **ElevenLabs** to become speech. Nothing is stored by the worker.

The report text, its language and the names of nearby places are sent to **TypeSafe AI** (a US company) to fill in the form. Coordinates are not sent to Jev; they stay in the worker. Don't put names, phone numbers or medical details in a report. The worker itself stores and logs nothing on purpose.

## Testing without a key

`python3 tools/mock-proxy.py`, then open http://localhost:8000/?proxy=http://localhost:9100. It answers with simple keyword rules instead of Jev. Add `--voice` to pretend the voice keys are set: `/listen` returns a fixed sentence and `/speak` a short beep. `tests/voice.test.js` checks the voice routes with fake Deepgram and ElevenLabs. `tests/jev.test.js` checks the question building, answer mapping and worker with a fake Jev.
