// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — shared plumbing for the generic `api/louise/*` editor
// routes (issue #10, Tier 2). Each route is a `WorkerRoute` composeWorker
// composes: it matches its mount path, resolves + guards the editor session,
// then reads/writes D1. The site supplies `resolveEditor` (wrapping its own
// auth) so the editor surface stays decoupled from any one auth wiring, and
// passes its own Drizzle tables so site-specific columns come along.

import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { requireEditor } from "../auth/guard.js";
import type { EditorSession } from "../auth/types.js";
import type { WorkerRoute } from "../worker/index.js";

/** The minimum a Worker `env` must expose for the editor routes: the D1 binding.
 *  Media routes widen this with the R2 bindings (see LouiseMediaEnv). */
export interface EditorRouteEnv {
  DB: D1Database;
}

/**
 * Resolve the editor (admin) session for a request. The site wraps its own
 * auth — typically `resolveEditorSession(getLouiseAuth(env, url), request)`.
 * Returning `null` means "not an editor" and the route answers 401/403.
 */
export type ResolveEditor<Env> = (
  request: Request,
  env: Env,
) => EditorSession | null | Promise<EditorSession | null>;

/** JSON response with a status + optional extra headers (thin wrapper over
 *  `Response.json`). */
export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, headers ? { status, headers } : { status });
}

/** True when the request's pathname is exactly `path`. */
export function matchPath(request: Request, path: string): boolean {
  return new URL(request.url).pathname === path;
}

/**
 * Resolve the editor session and run the shared same-origin + session guard
 * ({@link requireEditor}). Returns the editor on success, or a `Response` to
 * short-circuit the route. `mutation` gates the same-origin (CSRF) check —
 * `false` for reads, `true` for writes.
 */
export async function guardEditor<Env>(
  request: Request,
  env: Env,
  resolveEditor: ResolveEditor<Env>,
  mutation: boolean,
): Promise<{ editor: EditorSession } | { response: Response }> {
  const editor = await resolveEditor(request, env);
  const denied = requireEditor({ request, editor }, mutation);
  if (denied) return { response: denied };
  // requireEditor only returns null when editor is set, so this is sound.
  return { editor: editor as EditorSession };
}

/**
 * Validate + double-quote a SQL identifier (table/column). Identifiers come
 * from a site's own Drizzle schema, never user input, but quote them anyway as
 * defense in depth so a typo can't become injection (mirrors louise/media's
 * `findMediaReferences`).
 */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

/** The SQL table name + primary-key column name for a Drizzle SQLite table. */
export function tableMeta(table: SQLiteTable): { name: string; pk: string } {
  const config = getTableConfig(table);
  const pkColumn = config.columns.find((c) => c.primary);
  return { name: config.name, pk: pkColumn?.name ?? "id" };
}

/** A no-op `ExecutionContext` for calling editor routes outside a Worker fetch
 *  handler (e.g. an Astro `APIRoute`). The editor routes don't use `ctx`; it's
 *  only part of the `WorkerRoute`/composeWorker contract. */
const NOOP_CTX = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

/**
 * Run an editor {@link WorkerRoute} from a non-Worker context — an Astro
 * `APIRoute`, a Nitro/Nuxt handler, etc. — where you already have the resolved
 * editor session (e.g. from middleware) and the bindings, but no
 * `ExecutionContext`. Supplies a no-op `ctx` and turns a path fall-through
 * (`undefined`) into a 404, so a consuming route is a one-liner:
 *
 * ```ts
 * // Astro: the session is already on locals; hand it back via resolveEditor.
 * export const ALL: APIRoute = (ctx) =>
 *   runEditorRoute(
 *     inquiriesRoute({ table: inquiries, resolveEditor: () => ctx.locals.editor }),
 *     ctx.request,
 *     env,
 *   );
 * ```
 */
export async function runEditorRoute<Env>(
  route: WorkerRoute<Env>,
  request: Request,
  env: Env,
): Promise<Response> {
  const res = await route(request, env, NOOP_CTX);
  return res ?? json({ error: "Not found" }, 404);
}
