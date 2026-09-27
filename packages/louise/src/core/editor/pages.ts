// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the generic `pages` route. Framework content pages CRUD:
//   GET    /api/louise/pages        list
//   POST   /api/louise/pages        create
//   GET    /api/louise/pages/:id    read one
//   PATCH  /api/louise/pages/:id    update
//   DELETE /api/louise/pages/:id    delete
// One `WorkerRoute` handles both the collection path and the `/:id` item path.
// Writes are allowlisted (only configured fields) and rich fields sanitized
// (louise-toolkit/security) before store; the table is the site's own `pages`.

import { asc, eq, getTableColumns } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import { reportDegraded } from "../degraded.js";
import { LouiseValidationError } from "../errors.js";
import { s, standardValidate } from "../schema/index.js";
import { sanitizeRichHtml } from "../security/index.js";
import type { EditorSession } from "../auth/types.js";
import { toPageId } from "../content/ids.js";
import { type CollectionConfig, flattenFields } from "../content/types.js";
import type { WorkerRoute } from "../worker/index.js";
import type { DraftBufferKV } from "./draft-buffer.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";
import { applySaveDraft, hasPendingDraft, type SaveDraftDeps } from "./versions.js";

/** Context passed to a {@link PagesRouteConfig.validate} hook. */
export interface PagesValidateContext {
  operation: "create" | "update";
  /** Row id on update. */
  id?: number;
}

/** A server-side write validator. Throw {@link LouiseValidationError} to reject. */
export type PagesValidator = (
  data: Record<string, unknown>,
  ctx: PagesValidateContext,
) => void | Promise<void>;

/** Run a validator, turning a {@link LouiseValidationError} into a 422 response
 *  (with the per-field violations) and re-throwing anything else. */
async function runValidate(
  validate: PagesValidator,
  data: Record<string, unknown>,
  ctx: PagesValidateContext,
): Promise<Response | null> {
  try {
    await validate(data, ctx);
    return null;
  } catch (err) {
    if (err instanceof LouiseValidationError) {
      return json({ error: err.message, violations: err.violations }, 422);
    }
    throw err;
  }
}

/** The write a {@link PagesRouteConfig.afterWrite} hook runs after. */
export interface PagesWrite {
  operation: "create" | "update" | "delete";
  /** The written row's ID. After a delete, the ID the row had. */
  id: number;
}

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
  /** Rich-HTML sanitizer; defaults to louise-toolkit/security's `sanitizeRichHtml`. */
  sanitize?: (html: string) => string;
  /** Mount path (collection). Default `/api/louise/pages`. */
  path?: string;
  /**
   * Optional server-side validation, run after field-allowlisting and before
   * the insert/update. Throw {@link LouiseValidationError}—for example, via
   * `assertValidSections(catalog, data.sections, ctx)`—to reject the write
   * with a 422 carrying the per-field violations. Only the allowlisted `data`
   * is passed, so absent fields (partial update) aren't spuriously validated.
   */
  validate?: PagesValidator;
  /**
   * Transform the allowlisted write data before validation + store—clamp
   * lengths, coerce enums, normalize the slug, strict-media checks (a site's
   * `cleanPagePatch`). Runs after field-allowlisting, before {@link validate}.
   */
  transform?: (
    data: Record<string, unknown>,
    ctx: PagesValidateContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Slugs rejected on create/update with a 422—for example, reserved file-route paths
   * the catch-all can never serve (so a page can't be saved and then be
   * silently unreachable). Compared after {@link transform}.
   */
  reservedSlugs?: Iterable<string>;
  /**
   * Best-effort hook after a successful create/update/delete—for example, sync
   * the search (FTS) index, which plain CRUD writes don't touch. A throw is
   * swallowed so search staleness can never fail the write itself.
   *
   * The second argument names the row the write touched, so you can update
   * that one row's index entry with `reindexDoc` instead of rebuilding the
   * whole index after every edit:
   *
   * ```ts
   * afterWrite: (_editor, { id }) => reindexDoc(db(env.DB), pages, pagesCollection, id),
   * ```
   *
   * `reindexDoc` re-reads the row, so the same call removes the entry after a
   * delete.
   */
  afterWrite?: (editor: EditorSession, write: PagesWrite) => void | Promise<void>;
  /**
   * The collection's version-snapshot table (`collectionVersionsTable(...)`),
   * when the page uses the draft/publish workflow. DELETE then cascades to it
   * (`WHERE parent_id = :id`)—those snapshots have no FK to the page row, so
   * without this they orphan. Omit for an unversioned collection.
   */
  versionsTable?: SQLiteTable;
  /**
   * Keep an update in the page's pending draft (#530). An update writes the
   * live row, but publish copies the whole draft snapshot onto that row, so
   * without this, a rename made while a draft was pending comes undone at the
   * next publish, and a changed slug moves the page back to its old URL.
   *
   * With it, an update that changes a field of `config` also saves those
   * fields into the pending work: the KV buffer, else the newest pending draft.
   * A page with no pending work gets no draft. Pass the same `config` and
   * `bufferKv` as `versionsRoute`; it needs {@link versionsTable}.
   */
  drafts?: {
    /** The collection config; its fields are the ones a draft snapshot holds. */
    config: CollectionConfig;
    /** The KV draft buffer, as `versionsRoute` takes it. */
    bufferKv?: (env: Env) => DraftBufferKV | undefined;
  };
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
  // The primary key's Drizzle property key, to read a created row's ID back.
  const pkKey = Object.entries(getTableColumns(table)).find(([, c]) => c === pkCol)?.[0] ?? "id";
  const orderCol = (columns.find((c) => c.name === "sort_order") ?? pkCol) as SQLiteColumn;
  const hasUpdatedAt = columns.some((c) => c.name === "updated_at");
  const reserved = new Set(config.reservedSlugs ?? []);
  // Version-snapshot table (draft/publish workflow) + its parent-id column, so
  // DELETE can cascade to it—the snapshots have no FK to the page row.
  const versionsTable = config.versionsTable;
  const versionsParentCol = versionsTable
    ? (getTableConfig(versionsTable).columns.find((c) => c.name === "parent_id") as
        | SQLiteColumn
        | undefined)
    : undefined;
  if (config.drafts && !versionsTable) {
    throw new Error("pagesRoute: `drafts` needs `versionsTable`.");
  }
  const draftDeps: SaveDraftDeps<Env> | undefined =
    config.drafts && versionsTable
      ? {
          table,
          versionsTable,
          config: config.drafts.config,
          bufferKv: config.drafts.bufferKv,
        }
      : undefined;
  const snapshotKeys = new Set(
    config.drafts ? Object.keys(flattenFields(config.drafts.config.fields)) : [],
  );

  /** Save an update's snapshot fields into the page's pending work, if any (#530). */
  const carryIntoDraft = async (
    env: Env,
    editor: EditorSession,
    id: number,
    data: Record<string, unknown>,
  ): Promise<void> => {
    if (!draftDeps) return;
    const carry: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) if (snapshotKeys.has(key)) carry[key] = value;
    if (Object.keys(carry).length === 0) return;
    const pageId = toPageId(id);
    try {
      if (!(await hasPendingDraft(env, draftDeps, editor, pageId))) return;
      const saved = await applySaveDraft(env, draftDeps, editor, pageId, carry);
      if (!saved.ok) throw new Error(`draft save answered ${saved.status}: ${saved.error}`);
    } catch (err) {
      // The live write already landed. Reported, because until the draft is
      // saved again, the next publish puts the old values back.
      reportDegraded("editor.pages.draftCarry", err, { id });
    }
  };

  /** Reject a write whose (transformed) slug is a reserved path. */
  const reservedSlugRejection = (data: Record<string, unknown>): Response | null => {
    if ("slug" in data && reserved.has(String(data.slug ?? ""))) {
      return json({ error: `“${String(data.slug)}” is a reserved path.` }, 422);
    }
    return null;
  };

  /** Fire the best-effort post-write hook, swallowing any error. */
  const fireAfterWrite = async (editor: EditorSession, write: PagesWrite): Promise<void> => {
    if (!config.afterWrite) return;
    try {
      await config.afterWrite(editor, write);
    } catch (err) {
      // Best-effort—a post-write hook (for example, search reindex) must never fail the write.
      reportDegraded("editor.pages.afterWrite", err);
    }
  };

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
        const parsed = await standardValidate(s.record(), await request.json().catch(() => null));
        if (!parsed.ok) return json({ error: "Invalid JSON" }, 400);
        let data = pickFields(parsed.value, fields, richFields, sanitize);
        if (config.transform) data = await config.transform(data, { operation: "create" });
        const reservedRejection = reservedSlugRejection(data);
        if (reservedRejection) return reservedRejection;
        if (config.validate) {
          const rejected = await runValidate(config.validate, data, { operation: "create" });
          if (rejected) return rejected;
        }
        try {
          const [created] = await database
            .insert(table)
            .values(data as never)
            .returning();
          const createdId = Number((created as Record<string, unknown> | undefined)?.[pkKey]);
          await fireAfterWrite(g.editor, { operation: "create", id: createdId });
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
      const parsed = await standardValidate(s.record(), await request.json().catch(() => null));
      if (!parsed.ok) return json({ error: "Invalid JSON" }, 400);
      let data = pickFields(parsed.value, fields, richFields, sanitize);
      if (config.transform) data = await config.transform(data, { operation: "update", id });
      if (Object.keys(data).length === 0) return json({ error: "Nothing to update" }, 400);
      const reservedRejection = reservedSlugRejection(data);
      if (reservedRejection) return reservedRejection;
      if (config.validate) {
        const rejected = await runValidate(config.validate, data, { operation: "update", id });
        if (rejected) return rejected;
      }
      if (hasUpdatedAt) data.updatedAt = new Date();
      try {
        const [updated] = await database
          .update(table)
          .set(data as never)
          .where(eq(pkCol, id))
          .returning();
        if (!updated) return json({ error: "Not found" }, 404);
        await carryIntoDraft(env, g.editor, id, data);
        await fireAfterWrite(g.editor, { operation: "update", id });
        return json({ page: updated });
      } catch {
        return json({ error: "Update failed (duplicate slug?)" }, 400);
      }
    }
    if (method === "DELETE") {
      const [deleted] = await database.delete(table).where(eq(pkCol, id)).returning();
      if (!deleted) return json({ error: "Not found" }, 404);
      // Cascade to the version snapshots (no FK—they'd orphan otherwise).
      if (versionsTable && versionsParentCol) {
        await database.delete(versionsTable).where(eq(versionsParentCol, id));
      }
      await fireAfterWrite(g.editor, { operation: "delete", id });
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  };
}
