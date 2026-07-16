---
"louise-toolkit": minor
---

Add `louiseSaveAction` — the editor `save` mutation (#72) as an Astro Action: a typed, Zod-validated server function so a site calls `actions.louise.save(...)` and gets end-to-end types + automatic input validation, instead of hand-building a `fetch("/api/louise/save")` JSON body and re-parsing it server-side.

`louise-toolkit/astro` now exports `louiseSaveAction(config)`, which returns the `{ input, handler }` a site drops into `defineAction`. Because `defineAction`/`ActionError` live in Astro's virtual `astro:actions` module (only resolvable inside an Astro app), the toolkit ships the ingredients and the site assembles the action — mirroring `createLouiseMiddleware` — taking the `ActionError` class by injection so the handler still throws framework-correct 400/401/404.

```ts
// site: src/actions/index.ts
import { defineAction, ActionError } from "astro:actions";
import { louiseSaveAction } from "louise-toolkit/astro";

export const server = {
  louise: { save: defineAction(louiseSaveAction({ collections, ActionError })) },
};
```

The store path is shared with the raw `saveRoute` via a new pure `applyFieldSave` (allowlist + sanitize + D1 write), so a field is validated once per adapter and written in exactly one place — no double-parsing. CSRF stays with Astro's built-in same-origin guard for Action POSTs; the adapter ports only the editor-session (auth) check. The raw `/api/louise/save` route is unchanged and remains the fallback for non-Astro consumers and the keepalive auto-save client.
