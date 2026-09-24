---
"@louise-toolkit/astro": minor
"louise-toolkit": minor
---

`createLouiseMiddleware({ apiGate })`: the deny-by-default editor API gate for routes mounted as Astro API routes (ADR 0012, slice 2).

**What's new.** `composeWorker({ gate })` protects routes the worker dispatches. A site that mounts the editor routes as Astro API routes through `runEditorRoute` never reaches that gate. Pass `apiGate: true` to the middleware and every request under `/api/louise` must come from a signed-in editor before any route runs. Writes and WebSocket upgrades are origin-checked, and gated responses get `Cache-Control: no-store` unless the route set its own. If `resolveEditor` throws, pages still render publicly as before, but the API **refuses** rather than serving an anonymous request.

**Public routes are declared by path here.** Middleware runs before Astro knows which route file will answer, so a route can't mark itself public the way `publicRoute` does for `composeWorker`. The toolkit's own public routes are exempt at their default paths (`/api/louise/forms/*`, `/api/louise/vitals`); add your own with `apiGate: { isPublic: (pathname) => … }`. `louise-toolkit/worker` now exports those default paths (`LOUISE_FORMS_PATH`, `LOUISE_VITALS_PATH`, `isLouisePublicPath`), which `formRoute` and `vitalsRoute` build their defaults from, so the exemption can't drift from where the routes answer. It also exports `underPrefix`.

**What you have to do.** Nothing until you turn it on. Before you do, list any Astro route under `/api/louise` that must answer without an editor session (a webhook, for example) and name it in `isPublic`, or it starts returning 401. Behind `composeWorker({ gate })` it's a second check on requests the worker already let through, and costs nothing: the middleware resolves the editor on every request anyway.
