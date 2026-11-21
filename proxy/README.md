# FindThem LLM proxy

A tiny Cloudflare Worker (free tier) that turns a typed or spoken report into a
`ReportDraft` JSON (see `INTERFACES.md` section 5). It holds the DeepSeek API key
so the key is never in the website. It returns JSON only; the person still checks
the draft and taps Confirm before anything reaches the map.

## Deploy (about 5 minutes)

1. Make a free Cloudflare account at https://dash.cloudflare.com.
2. Get a DeepSeek API key at https://platform.deepseek.com.
3. In a terminal:
   ```bash
   cd proxy
   npx wrangler login                      # opens the browser to sign in
   npx wrangler secret put DEEPSEEK_API_KEY  # paste the key when asked; it is stored by Cloudflare, not in the repo
   npx wrangler deploy
   ```
4. Wrangler prints the address, like `https://findthem-proxy.<you>.workers.dev`.
   Put it in `PROXY_URL` in `config.js`.
5. In `wrangler.toml`, set `ALLOWED_ORIGIN` to the site's address
   (e.g. `https://benstew.github.io`, no trailing slash) and run `npx wrangler deploy` again.

Test it:
```bash
curl -X POST https://findthem-proxy.<you>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"text":"I think I saw him by the lake 10 minutes ago, blue coat, walking east","lang":"en","context":{"lastSeen":{"lat":37.548,"lng":-121.963},"streetNames":["Paseo Padre Pkwy"]}}'
```

## Limits

- Text is cut at 1000 characters; at most 50 street names.
- About 20 requests per minute per IP (best effort, kept in worker memory).
- Only POST (and the browser's OPTIONS check) is allowed.

## Privacy

The report text, the last-seen point and the nearby street names are sent to
**DeepSeek** (a company in China) to make the draft. Don't put names, phone
numbers or other private details in a report unless needed. The worker itself
stores nothing and logs nothing on purpose.
