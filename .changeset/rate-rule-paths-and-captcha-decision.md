---
"louise-toolkit": minor
---

Two security fixes from a pre-launch audit of a site built on the toolkit.

**Rate rules match every spelling of a path.** `matchRateRule` tested each rule against the raw path. With Astro's default `trailingSlash: "ignore"`, `/api/checkout/` reaches the `/api/checkout` endpoint, so an exact rule such as `(p) => p === "/api/checkout"` missed it, and that spelling had no per-address limit. `matchRateRule` now also tests each rule against `normalizeRatePath(path)`, a new export from `louise-toolkit/security`. It percent-decodes with `decodeURI` until the path stops changing (at most 10 times), collapses each run of slashes to one, and removes a trailing slash, except on `/`. Every spelling counts against the rule's one budget, because the bucket is keyed by the rule's name.

A rule still sees the path as given too, so a rule written for a slashed path keeps matching, and the change only ever adds matches. `createLouiseMiddleware` in `@louise-toolkit/astro` calls `matchRateRule`, so it picks this up with no change. Nothing to do on upgrade: write new rules against the canonical path, with no trailing slash.

**A control can make its captcha fail closed.** `activeCaptcha` answers `null` both when Turnstile isn't provisioned and when the site key is real but the secret can't be read, so a broken Secrets Store binding turns the captcha off without a word. That's the intended trade for the studio's sign-in, and wrong for a checkout. `louise-toolkit/auth` adds:

- `resolveCaptcha(env, { devServer })`, which returns a `CaptchaDecision`: `{ kind: "off" }`, `{ kind: "on", siteKey, secret }`, or `{ kind: "unavailable" }` for a real site key whose secret is missing, the placeholder, or unreadable. Each `unavailable` result is reported with `reportDegraded` as `auth.captcha-unavailable` (`CAPTCHA_UNAVAILABLE_DEGRADED`). Pass the build's dev flag, such as `import.meta.env.DEV`, as `devServer`: the dev server has the real site key and no Secrets Store, so it's `off` there. It's a build flag, not the request's host, because a local preview of a build rewrites the host to the route's zone.
- The types `CaptchaDecision`, `CaptchaEnv` (the two Turnstile bindings), and `ResolveCaptchaOptions`.

Existing exports keep their behavior: `activeCaptcha`, `activeCaptchaSecret`, `turnstileSecret`, and `turnstileSiteKey` still fail open, and the studio's sign-in still uses them. To make a payment form fail closed, read `resolveCaptcha` for the page's widget and the route's check alike, and answer `unavailable` with a 503. ADR 0012's amendment of 2026-10-03 records which controls fail open and which fail closed.
