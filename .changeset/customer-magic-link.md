---
"louise-toolkit": minor
---

Customers can sign in by magic link instead of a password: `customers.signIn: "magic-link"` on `getLouiseAuth`.

- **Email and password turn off.** The instance mounts no password sign-in, sign-up, or reset endpoint.
- **The magic-link endpoint opens to every address.** Before, the factory mailed a link only to the admin allowlist, on every instance. Now a customer instance mails anyone who asks; following the link signs them in, creating the account unless `customers.disableSignUp` is set, and verifies the email. With sign-up closed, an address with no account gets no email, and the response body is the same either way.
- **Better Auth's rate limiter switches on for that instance.** Better Auth enables it by itself only when `NODE_ENV` is `production`, which a Worker never sets.
- **A new `waitUntil` option** hands the email send to the runtime, so the endpoint answers as fast whether or not it mailed.

**Upgrading:** nothing changes unless you set the option; `"password"` stays the default. If you set it:

- Serve the instance with `auth.handler`, not `handleAuthRequest`, whose gate admits only admins.
- **Turnstile guards the endpoint only with both real keys set.** With the test keys, which every Worker Preview gets, or with none, the captcha is off and the endpoint mails any address that asks; each such send off `localhost` logs an `auth.magic-link-no-captcha` degrade. Set real keys in production and `rateLimitDo`, since the KV and D1 limiter fallbacks undercount under a burst.
- Pass `waitUntil`, from `cloudflare:workers`. Without it, with `disableSignUp` on, the response time shows which addresses have an account.
- Existing password hashes stay in the `account` table (rows with `providerId = 'credential'`). Those customers sign in by link to the same account. Delete the rows to store no hash; ADR 0016 is amended to match.
