---
"louise-toolkit": minor
---

Customers can sign in by magic link instead of a password: `customers.signIn: "magic-link"` on `getLouiseAuth`.

- **Email and password turn off.** The instance mounts no password sign-in, sign-up, or reset endpoint.
- **The magic-link endpoint opens to every address.** Before, the factory mailed a link only to the admin allowlist, on every instance. Now a customer instance mails anyone who asks; following the link signs them in, creating the account unless `customers.disableSignUp` is set, and marks the email verified. With sign-up closed, an address with no account gets no email, and the response is the same either way.
- **Turnstile and rate limits cover it.** The factory's captcha already guards `/sign-in/magic-link` whenever it's active, and Better Auth rate-limits the magic-link routes.

**Upgrading:** nothing changes unless you set the option; `"password"` is the default. If you set it, serve the instance with `auth.handler`, not `handleAuthRequest`, whose gate admits only admins. A customer who had a password signs in by link to the same account.
