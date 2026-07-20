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
import type { EditorSession } from "../auth/types.js";
import { createVersionedLocalApi, type DeferReindex } from "../content/localApi.js";
import { type CollectionConfig, flattenFields } from "../content/types.js";
import { LouiseValidationError } from "../errors.js";
import { d1Bookmark, db, openD1Session, serializeD1BookmarkCookie } from "../db/index.js";
import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";
import {
  clearDraftBuffer,
  DEFAULT_FLUSH_MS,
  type DraftBufferKV,
  draftBufferKey,
  readDraftBuffer,
  shouldFlushBuffer,
  writeDraftBuffer,
} from "./draft-buffer.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

// Bodies for the version actions. `publish` may omit `versionId` (it falls back
// to the latest pending draft); `discard` requires an integer `versionId`.
const PUBLISH_BODY = s.object({ versionId: s.optional(s.number({ int: true })) });
const DISCARD_BODY = s.object({ versionId: s.number({ int: true }) });

/** The store-side deps a versioned draft save needs — the subset of
 *  {@link VersionsRouteConfig} that {@link applySaveDraft} uses (no transport/auth
 *  concern), shared with the Astro `saveDraft` Action so the raw route and the
 *  Action build the same versioned local API and buffer. */
export interface SaveDraftDeps<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The main content table (e.g. the composed `pages`). */
  table: SQLiteTable;
  /** The `${slug}_versions` companion table (see content codegen's `collectionVersionsTable`). */
  versionsTable: SQLiteTable;
  /** The collection config — its `fields` drive the draft snapshot + publish validation. */
  config: CollectionConfig;
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
  /**
   * Coalesce high-frequency auto-save writes through a KV buffer (#70). Given
   * the runtime `env`, return the KV namespace to buffer working drafts in;
   * return `undefined` (or omit) to write every draft straight to D1 (unchanged).
   * When set: each auto-save updates the buffer, and D1 is flushed only on the
   * first write, every {@link bufferFlushMs}, and on publish (which then clears
   * the buffer). Resume reads should prefer the buffer — see `readDraftBuffer`.
   */
  bufferKv?: (env: Env) => DraftBufferKV | undefined;
  /** Flush cadence for the KV buffer, ms. Default {@link DEFAULT_FLUSH_MS} (10s). */
  bufferFlushMs?: number;
}

export interface VersionsRouteConfig<
  Env extends EditorRouteEnv = EditorRouteEnv,
> extends SaveDraftDeps<Env> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path (the collection base). Default `/api/louise/pages`. */
  path?: string;
}

/** The outcome of {@link applySaveDraft}: on success the exact JSON body + status
 *  the raw route returns (a created `version` at 201, or `{ buffered: true }` at
 *  200 when a KV write is coalesced), plus the D1 session `bookmark` to persist
 *  for read-your-writes on resume (#69) — `undefined` on a non-replicated D1 /
 *  runtime without the Sessions API; on failure a status + message (+ optional
 *  per-field `violations` from a `validate` throw). */
export type SaveDraftResult =
  | { ok: true; status: number; body: Record<string, unknown>; bookmark?: string }
  | { ok: false; status: number; error: string; violations?: unknown };

/**
 * Save an already-validated draft for a versioned row: merge the edit (config
 * fields only) over the freshest pending work — the KV buffer, else the newest
 * pending draft's snapshot, else the live row (see {@link latestPendingDraft}) —
 * optionally run the site's `validate`, then either absorb the write into the KV
 * buffer (#70) or write a new draft version to D1. Carries no transport/parse
 * concern — the raw {@link versionsRoute} (POST `/:id/versions`) and the Astro
 * `saveDraft` Action each validate their own input, then converge here.
 */
export async function applySaveDraft<Env extends EditorRouteEnv = EditorRouteEnv>(
  env: Env,
  deps: SaveDraftDeps<Env>,
  editor: EditorSession,
  id: number,
  input: Record<string, unknown>,
): Promise<SaveDraftResult> {
  // Run this save's D1 work through a `first-primary` session: the write hits
  // the primary and the session's bookmark advances past it, so a later resume
  // read anchored at that bookmark is guaranteed to see this draft even behind
  // read replication (#69). Degrades to the raw binding without the Sessions API.
  const session = openD1Session(env.DB, "first-primary");
  const database = db(session);
  const pkCol = getTableConfig(deps.table).columns.find((c) => c.primary) as SQLiteColumn;
  const fieldKeys = Object.keys(flattenFields(deps.config.fields));
  const context = { session: editor };
  const api = createVersionedLocalApi(
    database,
    deps.table,
    deps.versionsTable,
    deps.config,
    undefined,
    { deferReindex: deps.deferReindex?.(env) },
  );
  const kv = deps.bufferKv?.(env);
  const bufferKey = draftBufferKey(deps.config.slug, id);

  // `api.saveDraft` runs the collection's `beforeChange` hook, which may throw a
  // `LouiseValidationError` (e.g. an unknown section `_type`, a setting outside
  // its options). That is a client-input error, not a server fault — surface it
  // as a 422 with the per-field violations, the same shape `deps.validate`
  // produces above, rather than letting it escape the route as an unhandled 500.
  // A non-validation throw (a real DB failure) still propagates unchanged.
  const saveDraft = async (
    data: Record<string, unknown>,
  ): Promise<{ ok: true; version: unknown } | { ok: false; result: SaveDraftResult }> => {
    try {
      return { ok: true, version: await api.saveDraft(context, id, data as never) };
    } catch (err) {
      if (err instanceof LouiseValidationError) {
        const { message, violations } = violationsOf(err);
        return {
          ok: false,
          result: { ok: false, status: 422, error: message, ...(violations ? { violations } : {}) },
        };
      }
      throw err;
    }
  };

  // Read the coalescing buffer *first*: when one exists it is already the merge
  // base (it's always ≥ the D1 draft), which makes the version query below dead
  // work. The buffer coalesces writes; gating this read on it coalesces the reads
  // too, so a burst of auto-saves no longer pays for a full version list on every
  // debounce tick — only the live-row lookup, which the 404 check needs anyway.
  const buffered = kv ? await readDraftBuffer(kv, bufferKey) : null;

  const [current] = await database.select().from(deps.table).where(eq(pkCol, id)).limit(1);
  if (!current) return { ok: false, status: 404, error: "Not found" };
  const cur = current as Record<string, unknown>;
  const pending = buffered
    ? undefined
    : latestPendingDraft(
        (await api.findVersions(context, id)) as Record<string, unknown>[],
        (cur.publishedVersionId as number | null) ?? null,
      );
  // The merge base is the freshest pending work: the KV buffer (if buffering is
  // on and one exists — it's always ≥ the D1 draft), then the D1 draft, then the
  // live row. So a partial save from a second surface still layers onto the
  // in-flight buffer rather than reverting it.
  const mergeBase =
    (buffered?.data as Record<string, unknown> | undefined) ??
    (pending?.versionData as Record<string, unknown> | undefined) ??
    cur;
  const merged: Record<string, unknown> = {};
  for (const key of fieldKeys) {
    // Prefer this save's fields, then the base snapshot, then the live row — so a
    // key the snapshot happens to lack still resolves.
    merged[key] = key in input ? input[key] : key in mergeBase ? mergeBase[key] : cur[key];
  }
  if (deps.validate) {
    try {
      await deps.validate(merged);
    } catch (err) {
      const { message, violations } = violationsOf(err);
      return { ok: false, status: 422, error: message, ...(violations ? { violations } : {}) };
    }
  }

  // Buffered: absorb the write in KV; flush to D1 only on the first write of a
  // session and every bufferFlushMs, so a burst of auto-saves collapses to ~one
  // D1 version per interval. Unbuffered: write straight to D1 as before.
  if (kv) {
    const now = Date.now();
    const flushMs = deps.bufferFlushMs ?? DEFAULT_FLUSH_MS;
    if (shouldFlushBuffer(buffered, now, flushMs)) {
      const saved = await saveDraft(merged);
      if (!saved.ok) return saved.result;
      await writeDraftBuffer(kv, bufferKey, { data: merged, updatedAt: now, flushedAt: now });
      return {
        ok: true,
        status: 201,
        body: { version: saved.version, buffered: false },
        bookmark: d1Bookmark(session) ?? undefined,
      };
    }
    await writeDraftBuffer(kv, bufferKey, {
      data: merged,
      updatedAt: now,
      flushedAt: buffered ? buffered.flushedAt : now,
    });
    // No D1 write this time (coalesced into KV), but the reads above still
    // advanced the bookmark — persist it so resume stays consistent.
    return {
      ok: true,
      status: 200,
      body: { buffered: true },
      bookmark: d1Bookmark(session) ?? undefined,
    };
  }

  const saved = await saveDraft(merged);
  if (!saved.ok) return saved.result;
  return {
    ok: true,
    status: 201,
    body: { version: saved.version },
    bookmark: d1Bookmark(session) ?? undefined,
  };
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

    // KV write-buffer for auto-save (#70): present → draft writes are absorbed
    // by the buffer and only periodically flushed to D1 (see the POST handler).
    const kv = cfg.bufferKv?.(env);
    const bufferKey = draftBufferKey(cfg.config.slug, id);

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
      const result = await applySaveDraft(env, cfg, g.editor, id, parsedInput.value);
      if (!result.ok) {
        return json(
          { error: result.error, ...(result.violations ? { violations: result.violations } : {}) },
          result.status,
        );
      }
      // Persist the D1 bookmark in the editor cookie so the next edit-mode load
      // resumes this draft read-your-writes even behind read replication (#69).
      // keepalive auto-save fetches still process Set-Cookie, and it round-trips
      // on the following top-level navigation — no client code needed.
      const setCookie = serializeD1BookmarkCookie(result.bookmark ?? null);
      return json(result.body, result.status, setCookie ? { "set-cookie": setCookie } : undefined);
    }

    // POST /:id/publish — promote a draft to live. `versionId` in the body, else
    // the newest still-*pending* draft (a superseded draft — one publishing has
    // already moved past — must not silently go live). See `latestPendingDraft`.
    if (action === "publish" && method === "POST") {
      const parsedBody = await standardValidate(
        PUBLISH_BODY,
        await request.json().catch(() => null),
      );
      const explicitVersionId = parsedBody.ok ? parsedBody.value.versionId : undefined;
      // Flush any buffered work to D1 first, so "publish the latest draft" sees
      // the freshest edits (the buffer may hold writes not yet flushed) — this
      // becomes the newest draft version.
      //
      // This flush runs the collection's `beforeChange` hook, so a coalesced
      // auto-save that the buffer never validated (a bad section absorbed into
      // KV and answered 200) is validated HERE, at publish. The validation error
      // must surface as a 422 with its violations, not the raw 500 an uncaught
      // throw before the try/catch below would produce — the bad content is
      // correctly kept off the live page either way, but the editor needs the
      // violations, not a 500.
      if (kv) {
        const buffered = await readDraftBuffer(kv, bufferKey);
        if (buffered) {
          try {
            await api.saveDraft(context, id, buffered.data as never);
          } catch (err) {
            if (err instanceof LouiseValidationError) {
              const { message, violations } = violationsOf(err);
              return json({ error: message, ...(violations ? { violations } : {}) }, 422);
            }
            throw err;
          }
        }
      }
      let versionId = explicitVersionId;
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
        // Publishing the current work clears the buffer (its content is now
        // live). An explicit historic republish leaves the buffer — the pending
        // work-in-progress it holds is still newer than what just went live.
        if (kv && explicitVersionId === undefined) await clearDraftBuffer(kv, bufferKey);
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
      // Drop the buffer too, so resume doesn't resurrect the discarded work.
      if (kv) await clearDraftBuffer(kv, bufferKey);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
