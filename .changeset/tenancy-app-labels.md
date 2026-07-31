---
"astroidjs": minor
---

**`TenancyConfig.apps` — first-party apps on their own subdomain labels.**

`apps: { studio: "/studio" }` serves `studio.example.com/<path>` from
`src/pages/studio/<path>`, closing the gap the PWA config already assumed was
closed: `PwaConfig.emitDir`'s docs describe "a PWA served from its own
subdomain that rewrites to a path prefix", but nothing could express that
rewrite. A reserved label renders the ordinary site — which turns the admin
host into a second copy of the marketing homepage — and a tenant label goes
through `resolveTenant` and rewrites to `${rewritePrefix}/<slug>`, which is
both the wrong path shape and a per-request lookup for an app that exists
whether or not any tenant does.

An app label is **implicitly reserved**: `tenantLabel` never offers it to
`resolveTenant`, and listing it in `reserved` too is refused at config time —
one list per fact, or the two drift. The generated middleware checks the
static map first, inside the same `rewrite` hook the tenant dispatch uses, so
ordering guarantees (after `guard`, outside `extend`'s try/catch) carry over
unchanged.

New pure export `appPrefix(host, tenancy)` mirrors `tenantLabel`'s host
handling (port and case ignored, one label only), so `wrangler dev` behaves
like production and a site can unit-test its app map without standing up a
request.

Three config-time refusals, each for a failure that otherwise surfaces as the
wrong page with nothing pointing back at the config: a dotted app label (the
wildcard matches one level), a label in both `apps` and `reserved`, and a
prefix that isn't `/name`-shaped (the rewrite is `prefix + pathname`, so `"/"`
or a trailing slash produces `//…`).
