---
title: worker
description: "louise-toolkit/worker — composeWorker, a cookie-aware edge cache, and typed self-healing recovery for the Worker entrypoint."
sidebar:
  order: 6.75
---

```ts
import { composeWorker, withEdgeCache, withHealing } from "louise-toolkit/worker";
```

The Worker entrypoint helpers. Every Louise site's `worker.ts` has the same
shape: try a few Louise-owned routes, fall through to the framework's SSR
handler, optionally wire `queue` / `scheduled`. `composeWorker` builds that
`ExportedHandler`; `withEdgeCache` and `withHealing` wrap the fallback and the
routes. No peers.

## `composeWorker(options)`

```ts
function composeWorker<Env>(options: ComposeWorkerOptions<Env>): ExportedHandler<Env>;

interface ComposeWorkerOptions<Env> {
  routes?: WorkerRoute<Env>[]; // first to return a Response wins
  fetch: ExportedHandler<Env>["fetch"]; // SSR fallback when no route matches
  queue?: ExportedHandler<Env>["queue"];
  scheduled?: ExportedHandler<Env>["scheduled"];
}
```

Composes an `ExportedHandler` from ordered `WorkerRoute`s over an SSR fallback.
On `fetch`, each route runs in order and the first `Response` short-circuits; if
none match, the `fetch` fallback handles it. A `WorkerRoute` returns a `Response`
to handle the request, or `undefined` to pass it to the next route.

```ts
export default composeWorker<Env>({
  routes: [louiseApiRoute, ogImageRoute],
  fetch: ssrHandler, // e.g. @astrojs/cloudflare's handle
  queue: (batch, env) => processBatch(batch, (m) => handle(m, env)),
});
```

## `withEdgeCache(handler, config)`

```ts
function withEdgeCache<Env>(
  handler: (request, env, ctx) => Response | Promise<Response>,
  config?: EdgeCacheConfig,
): (request, env, ctx) => Promise<Response>;

interface EdgeCacheConfig {
  bypass?: (request: Request) => boolean; // skip cache, always run fresh
  cache?: () => Cache; // defaults to caches.default; injectable for tests
}
```

A **cookie-aware** edge cache for the SSR fallback. It caches public GETs in the
Worker-controlled Cache API (`caches.default`), keyed by URL, and stores a
response only when it carries a cacheable [`CDN_CACHE_CONTROL`](#helpers)
directive — the header the Astro Cloudflare cache provider emits from
`Astro.cache.set(...)`. Bypassed requests (e.g. an authenticated editor) and
non-GETs always run the handler. Drop-in for `composeWorker`'s `fetch`.

```ts
export default composeWorker<Env>({
  fetch: withEdgeCache(ssrHandler, { bypass: (req) => hasEditorSession(req) }),
});
```

:::caution[Why not `Cloudflare-CDN-Cache-Control`?]
That header drives Cloudflare's **automatic** edge cache, which is keyed by URL
and runs _before_ the Worker — blind to cookies, so a page cached for an
anonymous visitor could be served to a logged-in editor. `withEdgeCache` strips
that header from every response (the automatic cache never engages) and sends
the client `Cache-Control: no-store`, keeping `caches.default` the only shared
cache holding the HTML. This was the failure mode behind earlier reverts; see
[ADR 0004](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0004-edge-caching.md).
:::

### Helpers

- `CDN_CACHE_CONTROL` — the response header consumed as the "cache me" signal.
- `isCacheableDirective(directive)` — is a Cache-Control value an opt-in
  (`public`/unspecified with a positive `max-age`, not `no-store`/`no-cache`/`private`)?

## `withHealing(route, options)`

```ts
function withHealing<Env>(route: WorkerRoute<Env>, options: HealingOptions<Env>): WorkerRoute<Env>;

interface HealingOptions<Env> {
  rules: Record<string, HealingRule<Env>>; // keyed by LouiseError.code
  fallbackRule?: HealingRule<Env>; // for codes with no explicit rule
  sleep?: (ms: number) => Promise<void>; // injectable for tests
}
```

Wraps a route so thrown [`LouiseError`](/reference/errors/)s are healed by
policy instead of surfacing as a 500. A rule (selected by `error.code`) composes
three deterministic strategies: **retry** (re-run, optional exponential
`backoffMs`), **fallback** (serve a degraded/stale `Response`), and **escalate**
(hand the failure off out-of-band via `ctx.waitUntil`, so recovery never blocks
the response). Non-`LouiseError`s, and codes with no matching rule, re-throw.

```ts
const healed = withHealing(apiRoute, {
  rules: {
    DB_ERROR: {
      retries: 2,
      backoffMs: 50,
      fallback: ({ request }) => serveStale(request),
      escalate: ({ env, ...c }) => enqueue(env.HEAL_QUEUE, describeFailure(c)),
    },
  },
});
```

:::note[Retries re-run the whole route]
Safe for idempotent reads; a retried POST can double-write — `retries` defaults
to `0`, opt in only per code. `TRANSIENT_CODES` (`DB_ERROR`, `CACHE_ERROR`,
`STORAGE_ERROR`, `QUEUE_ERROR`) is exported as guidance for which codes are
generally safe to retry. `describeFailure(ctx)` builds a flat, serializable
`FailureReport` an `escalate` hook can enqueue across a queue boundary.
:::

## Types

`WorkerRoute`, `ComposeWorkerOptions`, `EdgeCacheConfig`, `HealingRule`,
`HealingContext`, `HealingOptions`, `FailureReport`.
