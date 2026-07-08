// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/editor — the generic `pages` route. Framework CMS pages CRUD:
//   GET    /api/louise/pages        list
//   POST   /api/louise/pages        create
//   GET    /api/louise/pages/:id    read one
//   PATCH  /api/louise/pages/:id    update
//   DELETE /api/louise/pages/:id    delete
// One `WorkerRoute` handles both the collection path and the `/:id` item path.
// Writes are allowlisted (only configured fields) and rich fields sanitized
// (louisecms/security) before store; the table is the site's own `pages`.

import { asc, eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import { sanitizeRichHtml } from "../security/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

/** The editable `pages` fields (Drizzle property keys) exposed by default. */
export const DEFAULT_PAGE_FIELDS = [
  "slug",
  "title",
  "body",
  "status",
  "seoTitle",
  "seoDescription",
  "ogImage",
  "noindex",
  "sortOrder",
] as const;

export interface PagesRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The `pages` table (composed from `pagesColumns` or the ready-made `pages`). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Editable fields (Drizzle property keys) for create/update. */
  fields?: readonly string[];
  /** Rich-HTML fields sanitized on write. Default `["body"]`. */
  richFields?: readonly string[];
  /** Rich-HTML sanitizer; defaults to louisecms/security's `sanitizeRichHtml`. */
  sanitize?: (html: string) => string;
  /** Mount path (collection). Default `/api/louise/pages`. */
  path?: string;
}

/** Keep only allowlisted fields from `input`, sanitizing the rich ones. Pure. */
export function pickFields(
  input: Record<string, unknown>,
  fields: Iterable<string>,
  richFields: Iterable<string>,
  sanitize: (html: string) => string,
): Record<string, unknown> {
  const allow = new Set(fields);
  const rich = new Set(richFields);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allow.has(key)) continue;
    out[key] = rich.has(key) && typeof value === "string" ? sanitize(value) : value;
  }
  return out;
}

/**
 * Build the `pages` editor route. Handles the collection path (GET list, POST
 * create) and the `/:id` item path (GET/PATCH/DELETE). Returns `undefined` for
 * any other path so `composeWorker` falls through.
 */
export function pagesRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: PagesRouteConfig<Env>,
): WorkerRoute<Env> {
  const base = config.path ?? "/api/louise/pages";
  const fields = config.fields ?? DEFAULT_PAGE_FIELDS;
  const richFields = config.richFields ?? ["body"];
  const sanitize = config.sanitize ?? sanitizeRichHtml;
  const table = config.table;
  const columns = getTableConfig(table).columns;
  const pkCol = columns.find((c) => c.primary) as SQLiteColumn;
  const orderCol = (columns.find((c) => c.name === "sort_order") ?? pkCol) as SQLiteColumn;
  const hasUpdatedAt = columns.some((c) => c.name === "updated_at");

  return async (request, env) => {
    const path = new URL(request.url).pathname;
    const isBase = path === base;
    const isItem = path.startsWith(`${base}/`);
    if (!isBase && !isItem) return undefined;

    const method = request.method;
    const g = await guardEditor(request, env, config.resolveEditor, method !== "GET");
    if ("response" in g) return g.response;
    const database = db(env.DB);

    // Collection path: list + create.
    if (isBase) {
      if (method === "GET") {
        const rows = await database.select().from(table).orderBy(asc(orderCol));
        return json({ pages: rows });
      }
      if (method === "POST") {
        const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!input || typeof input !== "object") return json({ error: "Invalid JSON" }, 400);
        const data = pickFields(input, fields, richFields, sanitize);
        try {
          const [created] = await database
            .insert(table)
            .values(data as never)
            .returning();
          return json({ page: created }, 201);
        } catch {
          return json({ error: "Create failed (missing required field or duplicate slug)" }, 400);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }

    // Item path: read / update / delete by id.
    const id = Number(path.slice(base.length + 1));
    if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

    if (method === "GET") {
      const [row] = await database.select().from(table).where(eq(pkCol, id)).limit(1);
      if (!row) return json({ error: "Not found" }, 404);
      return json({ page: row });
    }
    if (method === "PATCH") {
      const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!input || typeof input !== "object") return json({ error: "Invalid JSON" }, 400);
      const data = pickFields(input, fields, richFields, sanitize);
      if (Object.keys(data).length === 0) return json({ error: "Nothing to update" }, 400);
      if (hasUpdatedAt) data.updatedAt = new Date();
      try {
        const [updated] = await database
          .update(table)
          .set(data as never)
          .where(eq(pkCol, id))
          .returning();
        if (!updated) return json({ error: "Not found" }, 404);
        return json({ page: updated });
      } catch {
        return json({ error: "Update failed (duplicate slug?)" }, 400);
      }
    }
    if (method === "DELETE") {
      const [deleted] = await database.delete(table).where(eq(pkCol, id)).returning();
      if (!deleted) return json({ error: "Not found" }, 404);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  };
}
