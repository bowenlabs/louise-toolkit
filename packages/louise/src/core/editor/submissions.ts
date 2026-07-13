// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — review route for the shared generic `submissions` table
// (issue #46, Tier 3). The read/delete companion to a generic `formRoute`
// (`genericTable`): GET lists a form's submissions newest-first (parsing the
// JSON `data` back to a flat row), DELETE removes one by id. Scoped to one
// `form` name so each catalog form gets its own review tab over the one table.

import type { WorkerRoute } from "../worker/index.js";
import {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  matchPath,
  type ResolveEditor,
} from "./shared.js";

export interface SubmissionsRouteConfig<Env extends EditorRouteEnv> {
  /** The generic table name (default `"submissions"`). */
  table?: string;
  /** The form name to scope this review to (matches `formRoute`'s form). */
  form: string;
  /** Resolve the editor session. */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path. Default `/api/louise/submissions/<form>`. */
  path?: string;
  /** Max rows returned by GET. Default 200. */
  limit?: number;
}

/**
 * Build the review route for one form's rows in the shared `submissions` table.
 * GET (read) returns each row's `id`/`createdAt` plus its parsed `data` fields
 * flattened onto the row (so the Settings panel renders columns as it does for a
 * typed table); DELETE (mutation, same-origin-guarded) removes one by `?id=`.
 */
export function submissionsRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: SubmissionsRouteConfig<Env>,
): WorkerRoute<Env> {
  const table = config.table ?? "submissions";
  const path = config.path ?? `/api/louise/submissions/${config.form}`;
  const limit = config.limit ?? 200;

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;

    if (request.method === "GET") {
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      const { results } = await env.DB.prepare(
        `SELECT "id","data","created_at" FROM ${ident(table)} WHERE "form" = ?1 ORDER BY "id" DESC LIMIT ?2`,
      )
        .bind(config.form, limit)
        .all<{ id: number; data: string; created_at: number }>();
      const inquiries = results.map((row) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(row.data) as Record<string, unknown>;
        } catch {
          data = {};
        }
        return { ...data, id: row.id, createdAt: row.created_at };
      });
      // Keyed `inquiries` so the existing generic submissions panel can render it
      // unchanged (the review surface is form-agnostic).
      return json({ inquiries });
    }

    if (request.method === "DELETE") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const id = Number(new URL(request.url).searchParams.get("id"));
      if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);
      const { results } = await env.DB.prepare(
        `DELETE FROM ${ident(table)} WHERE "id" = ?1 AND "form" = ?2 RETURNING "id"`,
      )
        .bind(id, config.form)
        .all();
      if (results.length === 0) return json({ error: "Not found" }, 404);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
