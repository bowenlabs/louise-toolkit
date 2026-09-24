---
"louise-toolkit": minor
---

`composeWorker({ gate })` makes the editor API deny by default (ADR 0012).

**What's new.** Pass `gate: { resolveEditor }` and every request under `/api/louise` must come from a signed-in editor unless it's headed for a route wrapped in the new `publicRoute`. Until now each route checked for itself, so a route that forgot to was open to anyone. The gate also origin-checks WebSocket upgrades: they're `GET`s, so a method-only check would let a cross-site page open the realtime socket with the editor's cookie. And route responses now get the security headers your middleware adds to pages (`nosniff`, `X-Frame-Options`, and the rest of `louiseSecurityHeaders`), plus `Cache-Control: no-store` on gated responses. `composeWorker` routes run before the middleware, so until now they got none. `louiseApiGate` is the same check as a standalone function.

**What changed without `gate`.** `formRoute` and `vitalsRoute` now return routes marked with `publicRoute`. They behave exactly as before. `guardEditor` caches the `resolveEditor` result for the request, so the gate and the route's own check share one session lookup. Without `gate`, `composeWorker` is unchanged.

**What you have to do.** Nothing, until you turn it on. Before you do, check whether any route under `/api/louise` is meant to be reachable without an editor session: a webhook receiver, a public endpoint. Wrap it in `publicRoute`, or it starts returning 401. The three client sites have none; all 38 of their routes there already require an editor. Pass the gate the same `resolveEditor` function the editor routes get, so the session is looked up once.
