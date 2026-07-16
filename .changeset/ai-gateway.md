---
"louise-toolkit": minor
---

Route the Workers AI helpers through [AI Gateway](https://developers.cloudflare.com/ai-gateway/) (#87) — response caching, cost caps / rate limiting, provider fallback, retries, and request logging in front of every call, without changing the module's contract.

- New `AiGatewayOptions` (`{ id, cacheKey?, cacheTtl?, skipCache? }`) — a `gateway?` option on `generateAltText` / `rewriteText` / `suggestSeo` (and their `AltTextOptions` / `RewriteOptions` / `SeoOptions`), threaded to Workers AI's `run` as `options.gateway`.
- `aiRoute` gains a `gateway?: (env) => AiGatewayOptions | undefined` accessor for the rewrite/SEO calls; the media route's alt text picks it up via `altTextOptions.gateway`.

Gateway caching already keys on the full request (model + inputs), so identical calls dedupe automatically — `cacheKey` is only for deliberately widening a cache entry. Omit `gateway` and calls go direct; the gateway is purely additive. See the new `guide/ai-assists.md` for setup (creating a gateway, cost caps, and fallback).
