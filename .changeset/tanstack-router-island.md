---
"louise-toolkit": patch
---

**Documented: a routed app inside an Astro `client:only` island.**

`@tanstack/solid-router` mounted in a `client:only="solid-js"` island is
undocumented anywhere upstream — the Router repo's Solid examples are all
standalone Vite or Start-based. Spiked (#317) against `astro@7.1.6` +
`@tanstack/solid-router@1.170.18` and verified in a real browser: deep-link
refresh through an Astro catch-all, `basepath`, history across island
navigations, and that navigation genuinely stays client-side.

Both router configurations work — literal prefixed route paths, or
`basepath: "/app"` with root-relative ones. Router #4888 is filed against
`@tanstack/solid-start` and doesn't apply.

**One caveat, documented rather than smoothed over:** Astro's static build emits
directory-style URLs (`/app/orders/` → `index.html`) while the router writes
history entries *without* a trailing slash. `astro preview` serves both, but
that's the preview server being lenient — confirm it on a real deploy, since this
is the class of thing that works in dev and 404s in production. Serving the app
from its own subdomain sidesteps it entirely: the browser only sees root paths, so
`basepath` is `/`.

Docs only. ADR 0011 moves Router from "unproven, spike before committing" to
adopted, and records the #316 form findings alongside it.
