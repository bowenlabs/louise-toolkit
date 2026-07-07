---
"louisecms": minor
---

Add `louisecms/browser` — edge browser-automation helpers on Cloudflare Browser
Run, shared across all Louise sites (#5). `ogImage` renders a per-page OG card
only on a cache miss (content-hashed key via `ogCacheKey`, byte store injected),
so the second request for unchanged content is served with no browser session;
`createPuppeteerRenderer` is the thin edge binding (`@cloudflare/puppeteer`, an
optional peer, dynamically imported). `checkLinks` is a scheduled, fetch-based
link crawler. Bindings contract: `BROWSER` (`LouiseBrowserEnv`).
