---
"@louise-toolkit/astro": minor
---

This release requires `louise-toolkit` 0.44.0. The adapter pins the toolkit to an exact version, so it's a minor rather than a patch. A caret range on 0.9 doesn't pick it up. If it did, it would install a second toolkit beside the one your site or `astroidjs` resolves.

Security fix: the middleware reports and re-throws a failed query's error as `loggableError`'s copy, from `louise-toolkit/errors`, so the incident, Astro's error log, and the runtime's exception record hold none of the bound values drizzle-orm puts in its message. Any other error is reported and re-thrown as it was. With `reportErrors: false`, errors pass through untouched.

**Upgrading:** bump `@louise-toolkit/astro`, `louise-toolkit`, and `astroidjs` together, then check that the lockfile holds one `louise-toolkit` version. The toolkit's 0.44.0 entry lists what changes for query-error incidents.
