---
"louise-toolkit": minor
---

Webhook and form-notify URLs are checked on every redirect hop (ADR 0012, slice 5).

**What's new.** `fetchPublicUrl` in `louise-toolkit/security` is `upstreamFetch` for a URL someone else chose, such as a webhook endpoint or a form's notify target. It refuses (with a `BlockedUrlError`) any URL that:

- isn't https on the default port;
- has credentials in it;
- uses an IP address in any form, including `2130706433` or `0x7f.1`, which both mean `127.0.0.1`;
- is a single-label name, `localhost`, or a private-network name (`.local`, `.internal`, `.home.arpa`, …);
- matches your `blockHosts`.

Every redirect hop is checked the same way. A `POST` follows only a `307` or `308`: a `301`, `302` or `303` would turn it into an empty `GET` that looks like success. Cross-origin hops drop `Authorization` and `Cookie`. `publicUrlProblem(url)` runs the same checks without fetching, for validating a URL when it's saved.

**What changed.** `deliverWebhookMessage` and `notifySubmission` now use it. Content webhooks used to check the hostname against a regex, followed redirects, and had no timeout. The regex missed CGNAT, IPv4-mapped IPv6 and resolved names, and nothing re-checked a redirect. Form-notify webhooks had no check at all. Webhook errors now name the endpoint's **origin only**, because a hook's path is often its credential (Slack and Discord hook URLs are). `deliverWebhookMessage(message, policy?)` takes an optional second argument for `blockHosts` and `allowHttp`.

**What you have to do:**

- **A webhook URL that's plain `http`, uses an IP address, or has a non-default port is now refused.** Content webhooks throw, so the queue retries until the message reaches your dead-letter queue. Form notifications are skipped silently, and the submission still succeeds. Move the endpoint to https on a hostname. If it really must be http, pass `{ allowHttp: true }` to `deliverWebhookMessage`.
- **Consider adding your site's own host to `blockHosts`,** and setting the `global_fetch_strictly_public` compatibility flag in `wrangler.jsonc`. Without the flag, a Worker's fetch to its own zone goes straight to the origin, skipping the WAF. The flag changes how _every_ same-zone fetch is routed, so check anything that fetches your own domain (a link checker, for example) on a preview deploy first.
