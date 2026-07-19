---
"louise-toolkit": minor
---

`createLouiseMiddleware`'s `rateLimit.kv` now also accepts a getter (`() => RateLimitBackend | undefined`), resolved per request only for a matched surface. Astro middleware is constructed at module scope, but `cloudflare:workers` `env` bindings are only valid in request scope (the same reason editor Actions take `getEnv: () => env`) — a getter lets a site pass `kv: () => env.RL` without reading the binding at module-eval, which would otherwise crash on load. A getter that yields a falsy backend (e.g. the KV namespace isn't provisioned yet) skips rate-limiting — fail open, consistent with `rateLimit`. Passing a plain `RateLimitBackend` is unchanged.
