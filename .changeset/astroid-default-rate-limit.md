---
"astroidjs": patch
---

The generated `middleware.ts` now ships a default rate limit on the unauthenticated auth surface (`POST /api/auth/*`, 10/min keyed by client IP via the already-provisioned `RL` KV) — so a scaffolded site isn't open to magic-link email-bombing (inbox flooding + Email/Worker spend) out of the box. The generated contact form gains a matching submission cap (`spam.rateLimit`, 5/min/IP) on top of its honeypot + minimum-time heuristics. Both read `env.RL` per request (a getter, never at module-eval) and fail open on a KV blip.
