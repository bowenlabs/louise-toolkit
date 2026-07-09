// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/editor — the draft/publish/versions route. Exposes a collection's
// `createVersionedLocalApi` (louisecms/cms) over HTTP, so the editor can stage
// edits as drafts and promote them on publish without the change going live:
//   GET  /api/louise/pages/:id/versions   list versions (newest first)
//   POST /api/louise/pages/:id/versions   save a draft (merged over the live row)
//   POST /api/louise/pages/:id/publish    publish a draft (body.versionId | latest)
//   POST /api/louise/pages/:id/unpublish  clear the live pointer
//
// The main table row stays the LIVE document (find/render read it); drafts live
// in `${slug}_versions` until published. `published_version_id` (nullable) is the
// authoritative "is live" signal, maintained by publish()/unpublish() — the site
// filters on it, so no separate status column write is needed here.

import { desc, eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { createVersionedLocalApi } from "../cms/localApi.js";
import { type CollectionConfig, flattenFields } from "../cms/types.js";
import { db } from "../db/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

export interface VersionsRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The main content table (e.g. the composed `pages`). */
  table: SQLiteTable;
  /** The `${slug}_versions` companion table (see cms codegen's `collectionVersionsTable`). */
  versionsTable: SQLiteTable;
  /** The collection config — its `fields` drive the draft snapshot + publish validation. */
  config: CollectionConfig;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path (the collection base). Default `/api/louise/pages`. */
  path?: string;
  /**
   * Optional validation of the full merged draft before it's saved (e.g. the
   * site's `assertValidSections`). Throw to reject the draft with the thrown
   * error's message; a `LouiseValidationError` surfaces its `violations`.
   */
  validate?: (data: Record<string, unknown>) => void | Promise<void>;
}

/** Extract per-field violations from a thrown validation error, if present. */
function violationsOf(err: unknown): { message: string; violations?: unknown } {
  const e = err as { message?: string; violations?: unknown };
  return { message: e?.message ?? "Validation failed", violations: e?.violations };
}

/**
 * Build the draft/publish/versions route for a versioned collection. Returns
 * `undefined` for any path it doesn't own so `composeWorker` falls through.
 */
export function versionsRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  cfg: VersionsRouteConfig<Env>,
): WorkerRoute<Env> {
  const base = cfg.path ?? "/api/louise/pages";
  const pkCol = getTableConfig(cfg.table).columns.find((c) => c.primary) as SQLiteColumn;
  // Config field keys (flattened) — the only keys a draft snapshot may carry, so
  // a merged draft strips bookkeeping columns (id/status/published_version_id/…).
  const fieldKeys = Object.keys(flattenFields(cfg.config.fields));

  return async (request, env) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(`${base}/`)) return undefined;
    // `${base}/<id>/<action>` — anything else isn't ours.
    const [idStr, action, ...extra] = path.slice(base.length + 1).split("/");
    if (extra.length > 0 || !action) return undefined;
    if (action !== "versions" && action !== "publish" && action !== "unpublish") return undefined;

    const id = Number(idStr);
    if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

    const method = request.method;
    const isRead = method === "GET" && action === "versions";
    const g = await guardEditor(request, env, cfg.resolveEditor, !isRead);
    if ("response" in g) return g.response;
    const context = { session: g.editor };

    const database = db(env.DB);
    const api = createVersionedLocalApi(database, cfg.table, cfg.versionsTable, cfg.config);

    // GET /:id/versions — history, newest first.
    if (action === "versions" && method === "GET") {
      const versions = await api.findVersions(context, id);
      return json({ versions });
    }

    // POST /:id/versions — save a draft. Merge the edit over the current live
    // row (config fields only) so the snapshot is complete and publishable.
    if (action === "versions" && method === "POST") {
      const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!input || typeof input !== "object") return json({ error: "Invalid JSON" }, 400);
      const [current] = await database.select().from(cfg.table).where(eq(pkCol, id)).limit(1);
      if (!current) return json({ error: "Not found" }, 404);
      const cur = current as Record<string, unknown>;
      const merged: Record<string, unknown> = {};
      for (const key of fieldKeys) {
        merged[key] = key in input ? input[key] : cur[key];
      }
      if (cfg.validate) {
        try {
          await cfg.validate(merged);
        } catch (err) {
          const { message, violations } = violationsOf(err);
          return json({ error: message, ...(violations ? { violations } : {}) }, 422);
        }
      }
      const version = await api.saveDraft(context, id, merged as never);
      return json({ version }, 201);
    }

    // POST /:id/publish — promote a draft to live. `versionId` in the body, else
    // the newest still-draft version.
    if (action === "publish" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { versionId?: number };
      let versionId = body.versionId;
      if (versionId === undefined) {
        const versions = await api.findVersions(context, id);
        const latestDraft = versions.find(
          (v) => (v as Record<string, unknown>).status === "draft",
        ) as Record<string, unknown> | undefined;
        if (!latestDraft) return json({ error: "No draft to publish" }, 400);
        versionId = latestDraft.id as number;
      }
      try {
        const page = await api.publish(context, versionId);
        return json({ page });
      } catch (err) {
        const { message, violations } = violationsOf(err);
        return json({ error: message, ...(violations ? { violations } : {}) }, 422);
      }
    }

    // POST /:id/unpublish — clear the live pointer (the row's data is untouched).
    if (action === "unpublish" && method === "POST") {
      const page = await api.unpublish(context, id);
      return json({ page });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
