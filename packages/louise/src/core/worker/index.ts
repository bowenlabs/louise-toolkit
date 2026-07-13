// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/worker — the Worker entrypoint compose helper (issue #10, Tier 2).
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

export interface ComposeWorkerOptions<Env = unknown> {
  /** Ordered route handlers; the first to return a `Response` wins. */
  routes?: WorkerRoute<Env>[];
  /** Fallback when no route matches — typically the framework SSR handler
   *  (e.g. `@astrojs/cloudflare`'s `handle`). */
  fetch: NonNullable<ExportedHandler<Env>["fetch"]>;
  /** Optional Queue consumer, passed through unchanged. */
  queue?: NonNullable<ExportedHandler<Env>["queue"]>;
  /** Optional Cron/scheduled handler, passed through unchanged. */
  scheduled?: NonNullable<ExportedHandler<Env>["scheduled"]>;
}

/**
 * Compose a Cloudflare `ExportedHandler` from Louise-owned routes plus an SSR
 * fallback, with optional `queue`/`scheduled` handlers. On `fetch`, each route
 * runs in order and the first `Response` short-circuits; if none match, the
 * `fetch` fallback handles it.
 */
export function composeWorker<Env = unknown>(
  options: ComposeWorkerOptions<Env>,
): ExportedHandler<Env> {
  const routes = options.routes ?? [];
  const handler: ExportedHandler<Env> = {
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
