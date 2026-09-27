---
"louise-toolkit": minor
---

`pagesRoute` falls through on any path under its prefix that isn't an all-digit `/:id`, so `versionsRoute`, `searchRoute`, and `seoFixRoute` no longer have to mount before it (#538).

Before, `pagesRoute` answered `400 Bad id` for `/api/louise/pages/search`, `/api/louise/pages/42/versions`, and every other non-integer path, which is why each sibling route carried a "mount before `pagesRoute`" rule. It now returns `undefined` for those paths, before the editor guard runs, and keeps the `400` only for an all-digit ID too large to hold exactly.

**Upgrading:** nothing to change; the old order still works. A request to a path no route owns, such as `/api/louise/pages/abc`, now reaches the next route or your fallback instead of getting a `400`.
