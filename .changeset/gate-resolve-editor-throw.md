---
"louise-toolkit": patch
---

A `resolveEditor` that throws no longer crashes the request. Behind `composeWorker({ gate })`, a failed session lookup escaped the API gate, and the Worker answered with a 1101 error instead of refusing the request. Now the error is logged once per request and counts as "no editor", so the gate and every editor route's own guard answer 401, or 403 for a cross-origin write. `@louise-toolkit/astro`'s middleware already handled this case.

Nothing to change on upgrade.
