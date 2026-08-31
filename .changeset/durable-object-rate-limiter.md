---
"louise-toolkit": minor
---

security: a Durable-Object rate limiter, and Better Auth wired to use it

New `createRateLimiter` / `durableRateLimitStorage` in `louise-toolkit/security`,
and a `rateLimitDo` option on `getLouiseAuth`. Set it and Better Auth's rate
limiting stops going through KV entirely.

**Why a Durable Object.** It is the only atomic counter on Workers. A DO handles
one request at a time, so read-decide-write inside it cannot race. The two
alternatives both trade that away: the KV counter has a read→write gap that
undercounts under a burst, and Cloudflare documents the native Rate Limiting
binding as permissive, eventually consistent, and scoped **per location** — so an
attacker spreading across colos receives one budget per colo. That is a fine
trade for blunting form spam. It is a weak one for sign-in, which is what this
addresses.

Better Auth checks `rateLimit.customStorage` **before** secondary storage, so
wiring `rateLimitDo` means the KV `increment` added in 0.27 is never called. It
stays in place for sites that have not provisioned a DO, but it is now explicitly
the fallback rather than the recommendation.

Following the `realtime` and `workflows` pattern, the site owns the
`DurableObject` subclass and the wrangler binding; the library provides the logic
it delegates to:

```ts
export class RateLimitDO extends DurableObject<Env> {
  #rl = createRateLimiter(this.ctx);
  fetch(request: Request) { return this.#rl.fetch(request); }
  alarm() { return this.#rl.alarm(); }
}
```

One object per key, so no single object is a bottleneck (a DO sustains roughly
500–1,000 simple ops/sec, a per-key ceiling rather than a per-site one). Fixed
window, matching `security/rate-limit` — a client can reach ~2x the budget across
a boundary, the accepted cost of one number instead of a list of timestamps. The
window is never extended while blocking, or a client under sustained load would
never be let back in. An alarm reaps the counter once its window passes, so a
per-IP key does not occupy storage forever.

**Fails open**, like the KV limiter: an unreachable object allows the request. A
limiter outage must never lock every editor out of their own site.
