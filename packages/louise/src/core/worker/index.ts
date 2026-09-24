// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker — the Worker entrypoint compose helper (issue #10, Tier 2).
//
// Every Louise site's `worker.ts` is the same shape: try a few Louise-owned
// routes (the generic `api/louise/*` handlers, an OG-image endpoint, …), fall
// through to the framework's SSR handler, and optionally wire a
// `queue`/`scheduled` handler. `composeWorker` builds that `ExportedHandler` so
// the entrypoint is a declaration of routes + fallback rather than hand-rolled
// per site.

import {
  type ApiGateConfig,
  isPublicRoute,
  LOUISE_API_PREFIX,
  louiseApiGate,
  underPrefix,
  withRouteHeaders,
} from "./gate.js";

/**
 * A Louise-owned route: return a `Response` to handle the request, or
 * `undefined` to pass it to the next route (and ultimately the SSR fallback).
 */
export type WorkerRoute<Env = unknown> = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Response | undefined | Promise<Response | undefined>;

/**
 * @typeParam Env - the Worker's bindings.
 * @typeParam QMessage - the queue's message type. Supply it (rather than
 * leaving the `unknown` default) so the `queue` consumer receives a typed
 * `MessageBatch` instead of having to cast every message body.
 */
export interface ComposeWorkerOptions<Env = unknown, QMessage = unknown> {
  /** Ordered route handlers; the first to return a `Response` wins. */
  routes?: WorkerRoute<Env>[];
  /** Fallback when no route matches — typically the handler the framework's
   *  Cloudflare adapter exposes. */
  fetch: NonNullable<ExportedHandler<Env>["fetch"]>;
  /** Optional Queue consumer, passed through unchanged. */
  queue?: NonNullable<ExportedHandler<Env, QMessage>["queue"]>;
  /** Optional Cron/scheduled handler, passed through unchanged. */
  scheduled?: NonNullable<ExportedHandler<Env>["scheduled"]>;
  /**
   * Deny-by-default gate for the editor API (ADR 0012). Set it and every
   * request under `/api/louise` must resolve to an editor unless it's headed
   * for a {@link publicRoute} — including the site's own framework routes
   * under that prefix, which the fallback serves after the gate. Every route
   * response also gets the baseline security headers the site's middleware
   * never sees. Omitted, `composeWorker` behaves exactly as before.
   */
  gate?: ApiGateConfig<Env>;
}

/**
 * Compose a Cloudflare `ExportedHandler` from Louise-owned routes plus an SSR
 * fallback, with optional `queue`/`scheduled` handlers. On `fetch`, each route
 * runs in order and the first `Response` short-circuits; if none match, the
 * `fetch` fallback handles it. With `gate`, the editor API is deny-by-default
 * (see {@link ComposeWorkerOptions.gate} and ADR 0012).
 */
export function composeWorker<Env = unknown, QMessage = unknown>(
  options: ComposeWorkerOptions<Env, QMessage>,
): ExportedHandler<Env, QMessage> {
  const routes = options.routes ?? [];
  const { gate } = options;
  const first = async (
    list: WorkerRoute<Env>[],
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    for (const route of list) {
      const res = await route(request, env, ctx);
      if (res) return res;
    }
    return undefined;
  };

  if (!gate) {
    return withQueueAndCron(options, {
      async fetch(request, env, ctx) {
        return (await first(routes, request, env, ctx)) ?? options.fetch(request, env, ctx);
      },
    });
  }

  // Under the prefix, public routes answer first so an anonymous request can
  // reach them at all; then the gate; then everything else in order. Public
  // routes' paths don't overlap guarded ones, so trying them first changes no
  // match. Outside the prefix, the original order stands.
  const prefix = gate.prefix ?? LOUISE_API_PREFIX;
  const publicRoutes = routes.filter(isPublicRoute);
  const guardedRoutes = routes.filter((r) => !isPublicRoute(r));
  return withQueueAndCron(options, {
    async fetch(request, env, ctx) {
      const { hostname, pathname } = new URL(request.url);
      if (!underPrefix(pathname, prefix)) {
        const res = await first(routes, request, env, ctx);
        return res ? withRouteHeaders(res, hostname, false) : options.fetch(request, env, ctx);
      }
      const open = await first(publicRoutes, request, env, ctx);
      if (open) return withRouteHeaders(open, hostname, false);
      const denied = await louiseApiGate(request, env, gate);
      if (denied) return withRouteHeaders(denied, hostname, true);
      const res = await first(guardedRoutes, request, env, ctx);
      // No Louise route matched: the site's own framework routes under the
      // prefix, now reached only by an editor. Their headers are the
      // middleware's job, as for any page.
      return res ? withRouteHeaders(res, hostname, true) : options.fetch(request, env, ctx);
    },
  });
}

function withQueueAndCron<Env, QMessage>(
  options: ComposeWorkerOptions<Env, QMessage>,
  handler: ExportedHandler<Env, QMessage>,
): ExportedHandler<Env, QMessage> {
  if (options.queue) handler.queue = options.queue;
  if (options.scheduled) handler.scheduled = options.scheduled;
  return handler;
}

// The deny-by-default editor API gate (ADR 0012): `composeWorker({ gate })`,
// and `publicRoute` for the routes an anonymous request may reach.
export { type ApiGateConfig, LOUISE_API_PREFIX, louiseApiGate, publicRoute } from "./gate.js";

// `withHealing` — self-healing recovery that maps typed LouiseErrors to
// deterministic retry / stale-fallback / async-escalation strategies. Kept in
// its own file; re-exported here so it's part of the `louise-toolkit/worker`
// subpath alongside `composeWorker`.
export * from "./healing.js";

// `withEdgeCache` — cookie-aware Worker Cache API layer for the SSR fallback
// (#163), so public pages edge-cache while personalized (editor) requests always
// run fresh. Its own file; re-exported here alongside `composeWorker`.
export * from "./edge-cache.js";
// A read-through KV cache for one value (tenant, settings row, flag) — cached misses, fail-open.
export * from "./kv-cache.js";
