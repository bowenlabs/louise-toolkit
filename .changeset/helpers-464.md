---
"louise-toolkit": patch
"@louise-toolkit/astro": patch
---

A batch of small helpers the client sites each hand-rolled (#464):

- **`kvCached(kv, key, load, { ttlSeconds, cacheMisses? })`** and **`kvBust`** in
  `louise-toolkit/worker`: a read-through KV cache for one value looked up on every
  request. Misses are cached by default, so a garbage hostname costs one read per TTL.
  It fails open on KV errors. `ttlSeconds` is required and must be at least 60, KV's
  minimum.
- **`isNoindexHost(hostname, { prefixes?, suffixes? })`** in `louise-toolkit/security`
  covers `*.workers.dev` preview and version URLs by default, plus your own prefixes.
  `louiseSecurityHeaders` takes **`noindex`** to send `X-Robots-Tag: noindex`, and
  `@louise-toolkit/astro`'s `createLouiseMiddleware` takes **`noindex: (host) =>
  boolean`**. Set it in middleware: a header set in a streamed page is silently dropped.
- **`majorToCents(amount, fractionDigits?)`** and **`parseMoneyInput(text,
  fractionDigits?)`** in `louise-toolkit/commerce`. They replace two different
  functions that were both called `dollarsToCents`. One was `Math.round(d * 100)`,
  which turns 1.005 into 100 rather than 101. The other parsed form input as text, and
  is kept but made currency-agnostic.

Considered and left in the sites: cart-line math (three carts, three shapes; the shared
part is a one-liner) and a modal focus trap (one site only).
