// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — the generic `seed` route: idempotently create the
// `site_settings` singleton row (with optional default column values) so a
// fresh deploy has a row to patch. Guarded as a mutation (same-origin) even on
// GET, so the Settings' seed *link* works from a same-origin click (which sends
// a same-origin Referer) without dropping CSRF protection on a write.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

export interface SeedRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The `site_settings` table (composed or ready-made). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Column values (Drizzle property keys) for the initial row. Default `{}`. */
  defaults?: Record<string, unknown>;
  /** Singleton row id. Default 1. */
  id?: number;
  /** Mount path. Default `/api/louise/seed`. */
  path?: string;
  /** Let a same-origin GET trigger the seed (a clickable Settings link). Default true. */
  allowGet?: boolean;
}

/**
 * Build the `seed` editor route. Ensures the settings singleton exists (insert
 * with `defaults` when absent), idempotently. Returns `{ seeded: false }` when
 * the row already existed. Returns `undefined` for a non-matching path.
 */
export function seedRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: SeedRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/seed";
  const rowId = config.id ?? 1;
  const allowGet = config.allowGet ?? true;
  const table = config.table;

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    const method = request.method;
    if (method !== "POST" && !(allowGet && method === "GET")) {
      return json({ error: "Method not allowed" }, 405);
    }

    const g = await guardEditor(request, env, config.resolveEditor, true);
    if ("response" in g) return g.response;

    const database = db(env.DB);
    const existing = await database.select().from(table).limit(1);
    if (existing.length > 0) return json({ ok: true, seeded: false });

    await database.insert(table).values({ id: rowId, ...config.defaults } as never);
    return json({ ok: true, seeded: true });
  };
}
