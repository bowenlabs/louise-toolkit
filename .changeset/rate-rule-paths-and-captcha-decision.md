---
"louise-toolkit": minor
---

Two security fixes from a pre-launch audit of a site built on the toolkit.

**Rate rules match every spelling of a path.** `matchRateRule` tested each rule against the raw path. With Astro's default `trailingSlash: "ignore"`, `/api/checkout/` reaches the `/api/checkout` endpoint, so an exact rule such as `(p) => p === "/api/checkout"` missed it, and that spelling had no per-address limit. `matchRateRule` now also tests each rule against `normalizeRatePath(path)`, a new export from `louise-toolkit/security`. It percent-decodes with `decodeURI` until the path stops changing (at most 10 times), collapses each run of slashes to one, and removes a trailing slash, except on `/`. Every spelling counts against the rule's one budget, because the bucket is keyed by the rule's name. `createLouiseMiddleware` in `@louise-toolkit/astro` calls `matchRateRule`, so it picks this up with no change.

A rule still sees the path as given too, so a rule written for a slashed path keeps matching. A request that matched a rule before still matches one, but two things can change on upgrade:

- **The matching rule can be a different one.** Rules are tried in order, and an earlier rule now also sees the normalized path. With a rule for `/a` ahead of a rule for `/a/`, a request to `/a/` used to match the second and now matches the first, so it spends the first rule's budget. If you wrote a rule for each spelling of one endpoint, keep only the one for the canonical path, with no trailing slash.
- **Requests that had no limit can now get a 429.** A client that posts to a slashed URL, such as a form with `action="/api/contact/"`, used to skip the exact rule and now spends its budget. Check that the budget fits that traffic, or fix the URL the client posts to.

**A control can make its captcha fail closed.** `activeCaptcha` answers `null` both when Turnstile isn't provisioned and when the site key is real but the secret can't be read, so a broken Secrets Store binding silently turns the captcha off. That's the intended trade for the studio's sign-in, and wrong for a checkout. `louise-toolkit/auth` adds:

- `resolveCaptcha(env, { devServer })`, which returns a `CaptchaDecision`: `{ kind: "off" }`, `{ kind: "on", siteKey, secret }`, or `{ kind: "unavailable" }` for a real site key whose secret is missing, the placeholder, or unreadable. Pass the build's dev flag, such as `import.meta.env.DEV`, as `devServer`: the dev server has the real site key and no Secrets Store, so it's `off` there. It's a build flag, not the request's host, because a local preview of a build rewrites the host to the route's zone.
- Each `unavailable` result is reported with `reportDegraded` as `auth.captcha-unavailable` (`CAPTCHA_UNAVAILABLE_DEGRADED`). The cause says whether the binding is missing or the secret is unreadable, so the incident record names the fix. A binding that throws is also reported as `security.readSecret`, so that outage opens two incidents.
- The types `CaptchaDecision`, `CaptchaEnv` (the two Turnstile bindings), and `ResolveCaptchaOptions`. `turnstileSiteKey` and `turnstileSecret` now accept a `CaptchaEnv`, which every `LouiseAuthEnv` satisfies.

Existing exports keep their behavior: `activeCaptcha`, `activeCaptchaSecret`, `turnstileSecret`, and `turnstileSiteKey` still fail open, and the studio's sign-in still uses them. To make a payment form fail closed, read `resolveCaptcha` for the page's widget and the route's check alike, and answer `unavailable` with a 503. Then add `auth.captcha-unavailable` to `onIncident`'s `critical` list: a closed checkout answers 503 until someone repairs the secret, and only a critical incident sends an alert. ADR 0012's two amendments of 2026-10-03 record which controls fail open and which fail closed, and the rate-rule change.

**To upgrade:** this is a minor release, and before 1.0 a caret range doesn't admit the next minor. Widen your `louise-toolkit` range to this version to get either fix, and move `astroidjs` and `@louise-toolkit/astro` with it.
