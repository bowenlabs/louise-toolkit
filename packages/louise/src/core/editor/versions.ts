// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the draft/publish/versions route. Exposes a collection's
// `createVersionedLocalApi` (louise-toolkit/content) over HTTP, so the editor can stage
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

import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { createVersionedLocalApi, type DeferReindex } from "../content/localApi.js";
import { type CollectionConfig, flattenFields } from "../content/types.js";
import { db } from "../db/index.js";
import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

// Bodies for the version actions. `publish` may omit `versionId` (it falls back
// to the latest pending draft); `discard` requires an integer `versionId`.
const PUBLISH_BODY = s.object({ versionId: s.optional(s.number({ int: true })) });
const DISCARD_BODY = s.object({ versionId: s.number({ int: true }) });

export interface VersionsRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The main content table (e.g. the composed `pages`). */
  table: SQLiteTable;
  /** The `${slug}_versions` companion table (see content codegen's `collectionVersionsTable`). */
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
  /**
   * Move FTS reindex off the publish path (#77). Given the runtime `env` (so it
   * can reach a queue binding), return a {@link DeferReindex} that enqueues a
   * reindex of the published row's id instead of syncing the index inline; the
   * consumer drains it with `reindexDoc`. Return `undefined` (or omit) to keep
   * syncing inline — so a site without a queue keeps working unchanged.
   */
  deferReindex?: (env: Env) => DeferReindex | undefined;
}

/** Extract per-field violations from a thrown validation error, if present. */
function violationsOf(err: unknown): { message: string; violations?: unknown } {
  const e = err as { message?: string; violations?: unknown };
  return { message: e?.message ?? "Validation failed", violations: e?.violations };
}

/**
 * The newest still-*pending* draft among `versions` (which {@link findVersions}
 * returns newest-first, so the first match is the newest), or `undefined` when
 * there is none. A draft is pending only if it's newer than the live pointer
 * (`id > publishedVersionId`); a draft at or below `publishedVersionId` is
 * *superseded* — publishing has already moved the live row past it, so it must
 * not be resumed or auto-published as if it were current work.
 *
 * This backs two behaviours:
 *  - **Concurrent surfaces (draft merge base):** a versioned page may mount more
 *    than one editing surface (e.g. a rich-text body canvas and a sections dock),
 *    each saving only the fields it owns. Layering every partial save over the
 *    newest pending draft — instead of always over the live row — lets those
 *    surfaces compose into one snapshot rather than each reverting the other's
 *    pending work.
 *  - **Publish with no explicit `versionId`:** promoting "the latest draft" must
 *    skip superseded drafts so a stale snapshot can't silently go live.
 */
export function latestPendingDraft(
  versions: readonly Record<string, unknown>[],
  publishedVersionId: number | null,
): Record<string, unknown> | undefined {
  return versions.find(
    (v) =>
      v.status === "draft" &&
      (publishedVersionId === null || (v.id as number) > publishedVersionId),
  );
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
    if (
      action !== "versions" &&
      action !== "publish" &&
      action !== "unpublish" &&
      action !== "discard"
    )
      return undefined;

    const id = Number(idStr);
    if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

    const method = request.method;
    const isRead = method === "GET" && action === "versions";
    const g = await guardEditor(request, env, cfg.resolveEditor, !isRead);
    if ("response" in g) return g.response;
    const context = { session: g.editor };

    const database = db(env.DB);
    const api = createVersionedLocalApi(
      database,
      cfg.table,
      cfg.versionsTable,
      cfg.config,
      undefined,
      {
        deferReindex: cfg.deferReindex?.(env),
      },
    );

    // GET /:id/versions — history, newest first, plus the live pointer so the
    // editor can flag which version is currently published. Publishing never
    // demotes a prior version's `status`, so several rows can read "published"
    // over time; `published_version_id` on the live row is the only authoritative
    // "this one is live" signal.
    if (action === "versions" && method === "GET") {
      const versions = await api.findVersions(context, id);
      const [row] = await database.select().from(cfg.table).where(eq(pkCol, id)).limit(1);
      const publishedVersionId =
        ((row as Record<string, unknown> | undefined)?.publishedVersionId as number | null) ?? null;
      return json({ versions, publishedVersionId });
    }

    // POST /:id/versions — save a draft. Merge the edit (config fields only) over
    // the newest pending draft's snapshot when one exists, else the live row, so
    // the snapshot is complete and publishable AND a second editing surface's
    // partial save layers onto — rather than reverts — the pending draft. See
    // `latestPendingDraft`.
    if (action === "versions" && method === "POST") {
      const parsedInput = await standardValidate(
        s.record(),
        await request.json().catch(() => null),
      );
      if (!parsedInput.ok) return json({ error: "Invalid JSON" }, 400);
      const input = parsedInput.value;
      const [current] = await database.select().from(cfg.table).where(eq(pkCol, id)).limit(1);
      if (!current) return json({ error: "Not found" }, 404);
      const cur = current as Record<string, unknown>;
      const publishedVersionId = (cur.publishedVersionId as number | null) ?? null;
      const versions = (await api.findVersions(context, id)) as Record<string, unknown>[];
      const pending = latestPendingDraft(versions, publishedVersionId);
      const base = (pending?.versionData as Record<string, unknown> | undefined) ?? cur;
      const merged: Record<string, unknown> = {};
      for (const key of fieldKeys) {
        // Prefer this save's fields, then the pending draft's snapshot, then the
        // live row — so a key the draft snapshot happens to lack still resolves.
        merged[key] = key in input ? input[key] : key in base ? base[key] : cur[key];
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
    // the newest still-*pending* draft (a superseded draft — one publishing has
    // already moved past — must not silently go live). See `latestPendingDraft`.
    if (action === "publish" && method === "POST") {
      const parsedBody = await standardValidate(
        PUBLISH_BODY,
        await request.json().catch(() => null),
      );
      let versionId = parsedBody.ok ? parsedBody.value.versionId : undefined;
      if (versionId === undefined) {
        const versions = (await api.findVersions(context, id)) as Record<string, unknown>[];
        const [row] = await database.select().from(cfg.table).where(eq(pkCol, id)).limit(1);
        const publishedVersionId =
          ((row as Record<string, unknown> | undefined)?.publishedVersionId as number | null) ??
          null;
        const latestDraft = latestPendingDraft(versions, publishedVersionId);
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

    // POST /:id/discard — delete a draft version from history. Body: { versionId }.
    // Scoped to drafts (never the live version) so history stays a safe cleanup.
    if (action === "discard" && method === "POST") {
      const parsedBody = await standardValidate(
        DISCARD_BODY,
        await request.json().catch(() => null),
      );
      if (!parsedBody.ok) return json({ error: "Missing versionId" }, 400);
      const versionId = parsedBody.value.versionId;
      const versions = await api.findVersions(context, id);
      const target = versions.find((v) => (v as Record<string, unknown>).id === versionId) as
        | Record<string, unknown>
        | undefined;
      if (!target) return json({ error: "Version not found" }, 404);
      if (target.status !== "draft") {
        return json({ error: "Only draft versions can be discarded" }, 400);
      }
      await api.discardVersion(context, versionId);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
