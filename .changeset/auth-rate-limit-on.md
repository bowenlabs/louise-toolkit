---
"louise-toolkit": minor
---

Better Auth's rate limiter is on for every `getLouiseAuth` instance, except on `localhost` and `127.0.0.1`. Until now it was off on every Louise site, the editor's magic-link and passkey endpoints included: Better Auth turns it on by itself only when `NODE_ENV` is `production`, which a Worker never sets. Only a customer instance with `customers.signIn: "magic-link"` had it.

- **Each count is keyed on `CF-Connecting-IP`.** Better Auth's default header, `X-Forwarded-For`, carries whatever the client sent ahead of the real address. When it holds more than one address, Better Auth puts every such request in one shared bucket per path, where a stranger could spend everyone's sign-in budget. Sessions now record their IP address from the same header.
- **`rateLimitDo` still chooses where it counts.** Without it, the limiter counts in KV when `sessionCacheKv` is set, and otherwise in each isolate's memory.

**What a site might notice:** Better Auth answers a burst with a 429 and an `X-Retry-After` header, from any auth endpoint. The default budgets, per address and path, are 5 a minute each for requesting and following a magic link, 3 per 10 seconds for other sign-in and sign-up paths, and 100 per 10 seconds for everything else, passkeys included. People who share an address, such as a shop's guest Wi-Fi, share a budget.

**Upgrading:**

- Make your sign-in forms show a 429 as "try again in a moment" rather than a generic error. A followed magic link that's over budget gets Better Auth's JSON error, not a redirect.
- An end-to-end test that signs in many times against a deployed Preview can now hit the limit. Run it against `localhost`, or space the sign-ins out.
- Set `rateLimitDo` if you haven't. The KV and in-memory counters undercount under a burst, which is weak for sign-in; see `createRateLimiter` in `louise-toolkit/security` for the Durable Object.
