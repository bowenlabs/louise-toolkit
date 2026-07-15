---
"louise-toolkit": minor
---

Rate limiter: optional Cloudflare native Rate Limiting binding, with the KV counter retained as fallback (#89).

- `louise-toolkit/security` `rateLimit(backend, key, limit, windowSec)` now accepts either a KV binding (as before) or Cloudflare's native Rate Limiting binding — a new `RateLimitBackend = KVLike | RateLimiterBinding` union, dispatched on the binding shape. The native path is in-colo (no KV round-trip) and cheaper for the hot public abuse-control surfaces (pay/email, form submissions, search). Both paths fail open, so a limiter outage never blocks sign-in or a form.
- Callers are unchanged: `KVLike` stays assignable, and the `formRoute({ rateLimitKv })` and Astro-middleware `rateLimit.kv` slots widen to `RateLimitBackend` so a site opts into the native binding just by passing it (typically `env.RATE_LIMIT ?? env.KV`).
- Semantics note for the native path: the budget lives in wrangler config (`ratelimits` binding, `period` capped at 10 or 60s), so `limit`/`windowSec` become **advisory**, `remaining` is best-effort, and `retryAfter` is a bounded upper estimate — not the exact reset the KV path reports. Use it for coarse burst control; keep long-window budgets (e.g. per-day) on KV.

Sandbox: the hand-rolled per-IP limiter on the `/api/checkout` pay+email endpoint now runs through the shared `rateLimit` primitive — an optional native `RATE_LIMIT` burst guard (20/60s, no provisioning needed) in front of the existing per-day KV budget.
