# ADR 0006 — Worker router: evaluate Hono, keep `composeWorker`

- **Status:** Accepted (2026-07-17) — **keep the hand-rolled `composeWorker`; do not adopt Hono as the router.** Revisit only under the triggers below.
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #78 (milestone: Platform features push, epic #102)
- **Related:** #72 (Astro Actions / typed client), #71 (realtime WS route), ADR 0001 (opinionated Astro + Cloudflare)

## Context

The Worker entry (`workers/site/src/worker.ts`) is a `composeWorker(...)` over an ordered array of `WorkerRoute` handlers with an Astro SSR fallback (`packages/louise/src/core/worker/index.ts`). Each editor route factory (`pagesRoute`, `versionsRoute`, `searchRoute`, …, ~15 in `packages/louise/src/core/editor/`) does its own **path matching**, calls **`guardEditor(...)`** (same-origin/CSRF + session), and does its own **method dispatch** — the cross-cutting concerns are repeated per route.

#78 asked whether [Hono](https://hono.dev) should replace `composeWorker` for: (1) typed routing, (2) DRY middleware (auth/CSRF applied once), (3) killing the **route-ordering fragility** — today three factories carry documented `MUST precede pagesRoute` constraints because `pagesRoute`'s `/:id` matcher would otherwise claim `/pages/search`, `/pages/reindex`, `/pages/:id/versions`, etc.

Two hard constraints frame any answer (both from the issue and ADR 0001):

- **`WorkerRoute` is a public primitive.** It is exported from `louise-toolkit/worker`, every editor factory returns one, sites compose them, and `runEditorRoute` runs the *same* factory from an Astro `APIRoute` (no Worker `ctx`). A router swap must stay an **internal** detail or an **optional adapter** — it cannot change that public shape.
- **Zero runtime dependencies.** `louise-toolkit`'s `dependencies` is `{}` today. Hono would be the **first** runtime dep in the core package.

## What the spike did

A self-contained spike (`scratchpad/hono-spike/`, throwaway — not merged): Hono 4.12.30 mounted behind **one** `WorkerRoute` (`honoEditorMount`) so `composeWorker` and the Astro SSR fall-through stay unchanged; the editor guard as a single `app.use("/api/louise/*", …)` middleware; a `node:test` suite over routing precedence, guard placement, and fall-through; and esbuild size measurements. All assertions pass and document Hono's **actual** behavior.

### Measurements

| Bundle (minimal editor app: guard middleware + 8 routes) | minified | gzipped |
| --- | --- | --- |
| `hono` (default, SmartRouter = RegExp + Trie) | 19.1 KB | **7.8 KB** |
| `hono/tiny` (PatternRouter) | 11.6 KB | **4.9 KB** |

### Findings

1. **The ordering fragility is NOT solved by Hono.** All three routers — `RegExpRouter`/`SmartRouter` (default), `PatternRouter` (`hono/tiny`), and `TrieRouter` — resolve an overlap between a static segment and a `:param` segment by **registration order**, not by static-beats-dynamic specificity. With `/pages/:id` registered before `/pages/search`, a request to `/pages/search` matches `:id` (id = `"search"`). So the exact discipline `composeWorker` needs today (register/order the static routes first) survives the move — it just relocates from **array order** to **`app.get` registration order**. This was the headline motivation for #78 and it does not materialize.

2. **The genuine DX wins are real but modest.** One middleware replaces ~15 per-route `guardEditor(...)` calls; `c.req.param("id")` replaces `Number(path.slice(base.length + 1))`; `app.get/post/patch/delete` replaces the manual `if (method === …) … 405`. These are ergonomic improvements, not correctness ones.

3. **Fall-through is preservable.** The mount returns `undefined` for any non-`/api/louise` path (fast pass-through) and, via a marker on Hono's `notFound`, faithfully returns `undefined` when nothing in the subtree matched — so `composeWorker` → Astro SSR is byte-for-byte unchanged. This part works cleanly.

4. **Behavioral deltas to watch.** Hono returns **404 (not 405)** on a method mismatch by default; the factories return explicit 405s today. Preserving 405 needs an extra guard. Minor, but a real migration cost across ~15 routes.

5. **The public-API boundary blunts the typed-RPC win.** Because `WorkerRoute` must stay the public primitive and factories must still run under `runEditorRoute` (no `ctx`), Hono can only live *behind* the `/api/louise` mount as an internal adapter. Hono's RPC-mode end-to-end types would therefore **not** flow to the public factory API — they'd only exist inside the confined mount. The strongest reason to adopt Hono (typed client, pairing with #72) is the one the constraints most weaken.

6. **The WS route gets no benefit.** `realtimeRoute` (#71) forwards a WebSocket upgrade by reusing the original request (`Upgrade`/`Connection` are forbidden header names, so the request can't be reconstructed). Routing it through Hono changes nothing about that forwarding.

## Decision

**Keep `composeWorker`. Do not adopt Hono as the Worker router.**

The cost/benefit is unfavorable: Hono's biggest promised win (removing the ordering fragility) **does not hold** for any of its routers; the remaining wins are ergonomic and modest; and capturing them means the **first runtime dependency** in a deliberately zero-dep core (+4.9–7.8 KB gzip in every consuming site) plus a per-route-405 migration — all while the public-API constraint (`WorkerRoute` + `runEditorRoute`) confines Hono behind the mount and blocks the typed-RPC payoff that would justify the dependency.

The two ergonomic wins are cheaper to capture **natively, at zero dependency cost**, if we want them:

- A tiny internal path-matcher (`match("/api/louise/pages/:id")` → `{ id }` | `null`) to retire the `Number(path.slice(…))` boilerplate and make param extraction uniform.
- The guard is already effectively centralized in `guardEditor`; a `withEditorGuard(routes)` composition wrapper could declare it once per mount if the per-route call ever grates.

These stay optional follow-ups (their own issues if picked up), not part of this decision.

## Consequences

- The editor routes keep the documented `MUST precede` ordering comments; that discipline is inherent to prefix-overlapping routes and is not a `composeWorker` defect Hono would have fixed.
- The core package keeps `dependencies: {}`; the framework-agnostic `WorkerRoute` primitive and `runEditorRoute` portability are unchanged.
- No bundle-size regression for the four production sites.

## Revisit triggers

Reopen the question if any of these change the calculus:

- **#72 typed client becomes a priority** and we accept Hono **confined to the editor mount** as an optional `louise-toolkit/worker/hono` adapter (opt-in dependency, public `WorkerRoute` untouched) purely to get RPC-mode types for the editor client.
- The editor route count or path-overlap complexity grows enough that a real trie with **explicit static-over-dynamic specificity** (which Hono does not provide, but a purpose-built matcher could) earns its keep — at which point build it native, zero-dep, rather than take Hono.
- A second framework target (beyond Astro) needs the routes and a shared router abstraction pays for itself.
