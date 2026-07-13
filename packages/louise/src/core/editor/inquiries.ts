// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — the generic `inquiries` route. Contact-form submissions
// are created by the public site; the Settings' Inquiries tab only reviews and
// clears them, so this is read-mostly: GET lists newest-first, DELETE removes
// one by id. The table is the site's own (composed from `inquiriesColumns` or
// the ready-made `inquiries`), passed in so site-specific columns come along.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { WorkerRoute } from "../worker/index.js";
import {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  matchPath,
  type ResolveEditor,
  tableMeta,
} from "./shared.js";

export interface InquiriesRouteConfig<Env extends EditorRouteEnv> {
  /** The inquiries table (site-composed or the ready-made `inquiries`). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path. Default `/api/louise/inquiries`. */
  path?: string;
  /** Max rows returned by GET. Default 200. */
  limit?: number;
}

/**
 * Build the `inquiries` editor route. GET (read) lists submissions newest-first;
 * DELETE (mutation, same-origin-guarded) removes one by `?id=`. Returns
 * `undefined` for a non-matching path so `composeWorker` falls through to the
 * next route / SSR.
 */
export function inquiriesRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: InquiriesRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/inquiries";
  const limit = config.limit ?? 200;
  const { name, pk } = tableMeta(config.table);

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;

    if (request.method === "GET") {
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${ident(name)} ORDER BY ${ident(pk)} DESC LIMIT ?1`,
      )
        .bind(limit)
        .all();
      return json({ inquiries: results });
    }

    if (request.method === "DELETE") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const id = Number(new URL(request.url).searchParams.get("id"));
      if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);
      const { results } = await env.DB.prepare(
        `DELETE FROM ${ident(name)} WHERE ${ident(pk)} = ?1 RETURNING ${ident(pk)}`,
      )
        .bind(id)
        .all();
      if (results.length === 0) return json({ error: "Not found" }, 404);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
