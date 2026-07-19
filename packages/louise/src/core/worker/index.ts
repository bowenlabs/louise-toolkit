// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker — the Worker entrypoint compose helper (issue #10, Tier 2).
//
// Every Louise site's `worker.ts` is the same shape: try a few Louise-owned
// routes (the generic `api/louise/*` handlers, an OG-image endpoint, …), fall
// through to the framework's SSR handler (Astro), and optionally wire a
// `queue`/`scheduled` handler. `composeWorker` builds that `ExportedHandler` so
// the entrypoint is a declaration of routes + fallback rather than hand-rolled
// per site.

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
  /** Fallback when no route matches — typically the framework SSR handler
   *  (e.g. `@astrojs/cloudflare`'s `handle`). */
  fetch: NonNullable<ExportedHandler<Env>["fetch"]>;
  /** Optional Queue consumer, passed through unchanged. */
  queue?: NonNullable<ExportedHandler<Env, QMessage>["queue"]>;
  /** Optional Cron/scheduled handler, passed through unchanged. */
  scheduled?: NonNullable<ExportedHandler<Env>["scheduled"]>;
}

/**
 * Compose a Cloudflare `ExportedHandler` from Louise-owned routes plus an SSR
 * fallback, with optional `queue`/`scheduled` handlers. On `fetch`, each route
 * runs in order and the first `Response` short-circuits; if none match, the
 * `fetch` fallback handles it.
 */
export function composeWorker<Env = unknown, QMessage = unknown>(
  options: ComposeWorkerOptions<Env, QMessage>,
): ExportedHandler<Env, QMessage> {
  const routes = options.routes ?? [];
  const handler: ExportedHandler<Env, QMessage> = {
    async fetch(request, env, ctx) {
      for (const route of routes) {
        const res = await route(request, env, ctx);
        if (res) return res;
      }
      return options.fetch(request, env, ctx);
    },
  };
  if (options.queue) handler.queue = options.queue;
  if (options.scheduled) handler.scheduled = options.scheduled;
  return handler;
}

// `withHealing` — self-healing recovery that maps typed LouiseErrors to
// deterministic retry / stale-fallback / async-escalation strategies. Kept in
// its own file; re-exported here so it's part of the `louise-toolkit/worker`
// subpath alongside `composeWorker`.
export * from "./healing.js";

// `withEdgeCache` — cookie-aware Worker Cache API layer for the SSR fallback
// (#163), so public pages edge-cache while personalized (editor) requests always
// run fresh. Its own file; re-exported here alongside `composeWorker`.
export * from "./edge-cache.js";
