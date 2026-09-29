// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the draft/publish/versions route. Exposes a collection's
// `createVersionedLocalApi` (louise-toolkit/content) over HTTP, so the editor can stage
// edits as drafts and promote them on publish without the change going live:
//   GET  /api/louise/pages/:id/versions   list versions (newest first) + field revs
//   POST /api/louise/pages/:id/versions   save a draft (merged over the live row);
//                                         `$base` holds the revs it started from,
//                                         and `softLocks` refuses a held field
//   POST /api/louise/pages/:id/publish    publish a draft (body.versionId | latest),
//                                         or show a hidden page again
//   POST /api/louise/pages/:id/unpublish  hide the page from visitors
//
// The main table row holds the current version's snapshot (find/render read it);
// drafts live in `${slug}_versions` until published. ADR 0021 gives each fact one
// source: the row's `status` is visibility, `published_version_id` is which
// version the row holds, and a version's state comes from `versionState`
// (louise-toolkit/content), measured against the highest version ever promoted.

import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import type { EditorSession } from "../auth/types.js";
import {
  type PageId,
  parsePageId,
  parseVersionId,
  toVersionId,
  type VersionId,
} from "../content/ids.js";
import {
  type LifecycleVersion,
  pageState,
  promotedHighWater,
  versionState,
} from "../content/lifecycle.js";
import { createVersionedLocalApi, type DeferReindex } from "../content/localApi.js";
import { type CollectionConfig, flattenFields } from "../content/types.js";
import { LouiseContentError, LouiseValidationError } from "../errors.js";
import {
  d1Bookmark,
  db,
  openD1Session,
  type pageRedirects,
  serializeD1BookmarkCookie,
  slugChangeStatements,
} from "../db/index.js";
import { reportFallback } from "../degraded.js";
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
import { DRAFT_BASE_KEY, type DraftConflict, fieldRev, fieldRevs, parseDraftBase } from "./revs.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

// Bodies for the version actions. `publish` may omit `versionId` (it falls back
// to the latest pending draft); `discard` requires an integer `versionId`.
const PUBLISH_BODY = s.object({ versionId: s.optional(s.number({ int: true })) });
const DISCARD_BODY = s.object({ versionId: s.number({ int: true }) });

/** The store-side deps a versioned draft save needs—the subset of
 *  {@link VersionsRouteConfig} that {@link applySaveDraft} uses (no transport/auth
 *  concern), shared with the host's `saveDraft` endpoint so the raw route and the
 *  Action build the same versioned local API and buffer. */
export interface SaveDraftDeps<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The main content table (for example, the composed `pages`). */
  table: SQLiteTable;
  /** The `${slug}_versions` companion table (see content codegen's `collectionVersionsTable`). */
  versionsTable: SQLiteTable;
  /** The collection config—its `fields` drive the draft snapshot + publish validation. */
  config: CollectionConfig;
  /**
   * Optional validation of the full merged draft before it's saved (for example, the
   * site's `assertValidSections`). Throw to reject the draft with the thrown
   * error's message; a `LouiseValidationError` surfaces its `violations`.
   */
  validate?: (data: Record<string, unknown>) => void | Promise<void>;
  /**
   * Move FTS reindex off the publish path (#77). Given the runtime `env` (so it
   * can reach a queue binding), return a {@link DeferReindex} that enqueues a
   * reindex of the published row's id instead of syncing the index inline; the
   * consumer drains it with `reindexDoc`. Return `undefined` (or omit) to keep
   * syncing inline—so a site without a queue keeps working unchanged.
   */
  deferReindex?: (env: Env) => DeferReindex | undefined;
  /**
   * Coalesce high-frequency auto-save writes through a KV buffer (#70). Given
   * the runtime `env`, return the KV namespace to buffer working drafts in;
   * return `undefined` (or omit) to write every draft straight to D1 (unchanged).
   * When set: each auto-save updates the buffer, and D1 is flushed only on the
   * first write, every {@link bufferFlushMs}, and on publish (which then clears
   * the buffer). Resume reads should prefer the buffer—see `readDraftBuffer`.
   */
  bufferKv?: (env: Env) => DraftBufferKV | undefined;
  /** Flush cadence for the KV buffer, ms. Default {@link DEFAULT_FLUSH_MS} (10 seconds). */
  bufferFlushMs?: number;
}

export interface VersionsRouteConfig<
  Env extends EditorRouteEnv = EditorRouteEnv,
> extends SaveDraftDeps<Env> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path (the collection base). Default `/api/louise/pages`. */
  path?: string;
  /**
   * The soft-locks a draft save respects (#572), from the site's realtime
   * session: `realtimeSoftLocks` from `louise-toolkit/realtime`. See
   * {@link SaveDraftOptions.softLocks}.
   */
  softLocks?: DraftSoftLocks<Env>;
  /**
   * Remember a page's old URL when a publish changes its slug (#574): the
   * `pageRedirects` table from `louise-toolkit/db`, as `pagesRoute` takes it.
   * The publish runs its own write, so the redirect is written right after it;
   * if that fails, the publish still stands and the failure is reported as
   * `editor.redirects`.
   */
  redirects?: typeof pageRedirects;
}

/** The page a soft-lock read is for. */
export interface DraftSoftLockTarget {
  /** The collection slug. */
  slug: string;
  /** The row being saved. */
  id: PageId;
}

/**
 * Where a draft save finds the soft-locks another editor holds (#572). A
 * realtime session only enforces its locks on its own socket, so a save that
 * reaches the draft route another way (a surface whose socket dropped, a
 * second tab without one, a script) checks them here.
 */
export interface DraftSoftLocks<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The fields under a soft-lock: the session's `lockFields`. A save that
   *  changes none of them never reads the locks. */
  fields: readonly string[];
  /** The held locks on a row, as field name → the holder's user ID. Throw when
   *  they can't be read, and the save goes ahead unchecked and reports it. */
  read: (env: Env, target: DraftSoftLockTarget) => Promise<Readonly<Record<string, string>>>;
}

/** The outcome of {@link applySaveDraft}: on success the exact JSON body + status
 *  the raw route returns (a created `version` at 201, or `{ buffered: true }` at
 *  200 when a KV write is coalesced), plus the D1 session `bookmark` to persist
 *  for read-your-writes on resume (#69)—`undefined` on a non-replicated D1 /
 *  runtime without the Sessions API; on failure a status + message (+ optional
 *  per-field `violations` from a `validate` throw). */
export type SaveDraftResult =
  | { ok: true; status: number; body: Record<string, unknown>; bookmark?: string }
  | {
      ok: false;
      status: number;
      error: string;
      violations?: unknown;
      /** On a 409: the fields someone else changed since `base`. */
      conflicts?: DraftConflict[];
      /** On a 423: the fields this save changes that another editor holds. */
      locked?: string[];
    };

/** Options for {@link applySaveDraft}. */
export interface SaveDraftOptions<Env extends EditorRouteEnv = EditorRouteEnv> {
  /**
   * The field revisions the save started from, from the `revs` of an earlier
   * save or of `GET /:id/versions`. A field in the save whose stored value
   * has moved since its revision here is a conflict, and the save answers 409
   * with the current values instead of merging, unless the new value already
   * equals the stored one. A field with no revision here isn't checked, so a
   * save without `base` merges as it always has.
   *
   * With the KV buffer on, the check reads the buffer and then writes it, and
   * KV isn't atomic, so two saves that land together can both pass. The check
   * narrows that window; it doesn't close it.
   */
  base?: Record<string, string>;
  /**
   * The soft-locks this save respects (#572). A save that changes a field
   * another editor holds answers 423 with `locked`, and nothing is written. A
   * field whose new value equals the stored one isn't a change, and the lock
   * holder's own save goes through. When the locks can't be read, the save
   * goes ahead and the failure is reported as `editor.softLocks`.
   *
   * The realtime session's own `persist` leaves this out: the session already
   * enforces its locks, and its coalesced flush can carry a locked field
   * another editor wrote.
   */
  softLocks?: DraftSoftLocks<Env>;
  /**
   * The surface the save came through, recorded on the version when the
   * collection sets `versions.provenance`. The realtime session's `persist`
   * passes `"realtime"`. Leave it out for an editor route. An agent's save is
   * recorded as `"agent"` from its session whatever this says.
   */
  source?: "realtime";
}

/** The message a 409 conflict carries. */
const CONFLICT_MESSAGE = "Someone else changed this since you opened it.";

/** The message a 423 carries. */
const LOCKED_MESSAGE = "Someone else is editing this right now.";

/**
 * Save an already-validated draft for a versioned row: merge the edit (config
 * fields only) over the freshest pending work—the KV buffer, else the newest
 * pending draft's snapshot, else the live row (see {@link latestPendingDraft})—optionally
 * run the site's `validate`, then either absorb the write into the KV
 * buffer (#70) or write a new draft version to D1. Carries no transport/parse
 * concern—the raw {@link versionsRoute} (POST `/:id/versions`) and the host's
 * `saveDraft` Action each validate their own input, then converge here.
 */
export async function applySaveDraft<Env extends EditorRouteEnv = EditorRouteEnv>(
  env: Env,
  deps: SaveDraftDeps<Env>,
  editor: EditorSession,
  id: PageId,
  input: Record<string, unknown>,
  options: SaveDraftOptions<Env> = {},
): Promise<SaveDraftResult> {
  // Run this save's D1 work through a `first-primary` session: the write hits
  // the primary and the session's bookmark advances past it, so a later resume
  // read anchored at that bookmark is guaranteed to see this draft even behind
  // read replication (#69). Degrades to the raw binding without the Sessions API.
  const session = openD1Session(env.DB, "first-primary");
  const database = db(session);
  const pkCol = getTableConfig(deps.table).columns.find((c) => c.primary) as SQLiteColumn;
  const fieldKeys = Object.keys(flattenFields(deps.config.fields));
  const context = { session: editor, ...(options.source ? { source: options.source } : {}) };
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
  // `LouiseValidationError` (for example, an unknown section `_type`, a setting outside
  // its options). That is a client-input error, not a server fault—surface it
  // as a 422 with the per-field violations, the same shape `deps.validate`
  // produces above, rather than letting it escape the route as an unhandled 500.
  // A non-validation throw (a real DB failure) still propagates unchanged.
  const asUnprocessable = async <T>(
    run: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; result: SaveDraftResult }> => {
    try {
      return { ok: true, value: await run() };
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
  const saveDraft = (data: Record<string, unknown>) =>
    asUnprocessable(() => api.saveDraft(context, id, data as never));
  // A buffered save never reaches `api.saveDraft`, so it runs the same access
  // check, `beforeChange` hooks, and field check here. Without this, the buffer
  // held raw input: HTML the collection's hook would sanitize went to KV as
  // sent, and `resumeDraft` rendered it in edit mode.
  const prepareDraft = (data: Record<string, unknown>) =>
    asUnprocessable(() => api.prepareDraft(context, data as never));

  // Read the coalescing buffer *first*: when one exists it is already the merge
  // base (it's always ≥ the D1 draft), which makes the version query below dead
  // work. The buffer coalesces writes; gating this read on it coalesces the reads
  // too, so a burst of auto-saves no longer pays for a full version list on every
  // debounce tick—only the live-row lookup, which the 404 check needs anyway.
  const buffered = kv ? await readDraftBuffer(kv, bufferKey) : null;

  const [current] = await database.select().from(deps.table).where(eq(pkCol, id)).limit(1);
  if (!current) return { ok: false, status: 404, error: "Not found" };
  const cur = current as Record<string, unknown>;
  const pending = buffered
    ? undefined
    : latestPendingDraft((await api.findVersions(context, id)) as Record<string, unknown>[]);
  // The merge base is the freshest pending work: the KV buffer (if buffering is
  // on and one exists—it's always ≥ the D1 draft), then the D1 draft, then the
  // live row. So a partial save from a second surface still layers onto the
  // in-flight buffer rather than reverting it.
  const mergeBase =
    (buffered?.data as Record<string, unknown> | undefined) ??
    (pending?.versionData as Record<string, unknown> | undefined) ??
    cur;
  // The optimistic check (#572): a field this save sets, whose stored value has
  // moved since the revision the client started from, is someone else's edit.
  // Report it rather than overwrite it, unless both ended up at the same value.
  const savedKeys = fieldKeys.filter((key) => key in input);
  const storedValue = (key: string) => (key in mergeBase ? mergeBase[key] : cur[key]);
  // The soft-lock check (#572): a field another editor holds in the realtime
  // session is theirs until they release it, whatever path this save took.
  if (options.softLocks) {
    const locked = await lockedByOthers(env, options.softLocks, editor, {
      slug: deps.config.slug,
      id,
      keys: savedKeys,
      input,
      stored: storedValue,
    });
    if (locked.length > 0) return { ok: false, status: 423, error: LOCKED_MESSAGE, locked };
  }
  if (options.base) {
    const conflicts: DraftConflict[] = [];
    for (const key of savedKeys) {
      const expected = options.base[key];
      if (expected === undefined) continue;
      const stored = storedValue(key);
      const rev = await fieldRev(stored);
      if (rev !== expected && (await fieldRev(input[key])) !== rev) {
        conflicts.push({ field: key, value: stored, rev });
      }
    }
    if (conflicts.length > 0) {
      return { ok: false, status: 409, error: CONFLICT_MESSAGE, conflicts };
    }
  }
  const merged: Record<string, unknown> = {};
  for (const key of fieldKeys) {
    // Prefer this save's fields, then the base snapshot, then the live row—so a
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
      // Buffer what D1 stored (after the hooks), not the raw merge.
      const stored = (saved.value as { versionData?: unknown }).versionData;
      const data = isRecord(stored) ? stored : merged;
      await writeDraftBuffer(kv, bufferKey, { data, updatedAt: now, flushedAt: now });
      return {
        ok: true,
        status: 201,
        body: { version: saved.value, buffered: false, revs: await fieldRevs(data, savedKeys) },
        bookmark: d1Bookmark(session) ?? undefined,
      };
    }
    const prepared = await prepareDraft(merged);
    if (!prepared.ok) return prepared.result;
    await writeDraftBuffer(kv, bufferKey, {
      data: prepared.value,
      updatedAt: now,
      flushedAt: buffered ? buffered.flushedAt : now,
    });
    // No D1 write this time (coalesced into KV), but the reads above still
    // advanced the bookmark—persist it so resume stays consistent.
    return {
      ok: true,
      status: 200,
      body: { buffered: true, revs: await fieldRevs(prepared.value, savedKeys) },
      bookmark: d1Bookmark(session) ?? undefined,
    };
  }

  const saved = await saveDraft(merged);
  if (!saved.ok) return saved.result;
  const stored = (saved.value as { versionData?: unknown }).versionData;
  return {
    ok: true,
    status: 201,
    body: {
      version: saved.value,
      revs: await fieldRevs(isRecord(stored) ? stored : merged, savedKeys),
    },
    bookmark: d1Bookmark(session) ?? undefined,
  };
}

/** The outcome of {@link applyPublish}: the live row, or a status and message
 *  (with per-field `violations` when a hook or validation refused it). */
export type PublishResult =
  | { ok: true; body: { page: unknown } }
  | { ok: false; status: number; error: string; violations?: unknown };

/** What {@link applyPublish} needs: the draft deps, plus the redirects table. */
export interface PublishDeps<
  Env extends EditorRouteEnv = EditorRouteEnv,
> extends SaveDraftDeps<Env> {
  /** See {@link VersionsRouteConfig.redirects}. */
  redirects?: typeof pageRedirects;
}

/**
 * Publish a versioned row, as `POST /:id/publish` does. With `versionId`, that
 * version, which must belong to `id`. Without it, the newest still-pending
 * draft, after flushing any buffered work into one. With no pending draft, a
 * hidden row is shown again as it stands, and a row never published goes live
 * as it stands. Otherwise there's nothing to publish.
 *
 * The collection's `publish` access function decides whether `editor` may, so
 * the MCP route's `publish_<slug>` and the editor's own button share one rule.
 */
export async function applyPublish<Env extends EditorRouteEnv = EditorRouteEnv>(
  env: Env,
  deps: PublishDeps<Env>,
  editor: EditorSession,
  id: PageId,
  explicitVersionId?: VersionId,
): Promise<PublishResult> {
  const database = db(env.DB);
  const pkCol = getTableConfig(deps.table).columns.find((c) => c.primary) as SQLiteColumn;
  // The columns `collectionVersionsTable` generates, which the ownership check reads.
  const versionsCols = deps.versionsTable as unknown as {
    id: SQLiteColumn;
    parentId: SQLiteColumn;
  };
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
  const refused = (status: number, err: unknown): PublishResult => {
    const { message, violations } = violationsOf(err);
    return { ok: false, status, error: message, ...(violations ? { violations } : {}) };
  };

  /** The live row's slug, read before a publish that may change it (#574). */
  const liveSlug = async (): Promise<string | undefined> => {
    const [row] = await database.select().from(deps.table).where(eq(pkCol, id)).limit(1);
    const slug = (row as Record<string, unknown> | undefined)?.slug;
    return typeof slug === "string" ? slug : undefined;
  };
  /** Record `/old → /new` when a publish changed the slug. Never fails the
   *  publish, which has already gone live. */
  const recordPublishedRename = async (before: string | undefined, after: unknown) => {
    if (!deps.redirects || before === undefined || typeof after !== "string") return;
    const writes = slugChangeStatements(database, deps.redirects, before, after);
    if (writes.length === 0) return;
    try {
      await database.batch(writes as [(typeof writes)[number], ...typeof writes]);
    } catch (err) {
      reportFallback("editor.redirects", err, { id });
    }
  };

  // An explicit version must belong to the page in the path (#535).
  // `api.publish` finds the page through the version row's `parentId`, so
  // without this check a mismatched pair publishes a different page than the
  // URL names. Check before the flush below, so a rejected publish leaves
  // this page's buffered work where it was.
  if (explicitVersionId !== undefined) {
    const [version] = await database
      .select({ parentId: versionsCols.parentId })
      .from(deps.versionsTable)
      .where(eq(versionsCols.id, explicitVersionId))
      .limit(1);
    if ((version as { parentId?: unknown } | undefined)?.parentId !== id) {
      return { ok: false, status: 404, error: "Version not found" };
    }
  }
  // Flush any buffered work to D1 first, so "publish the latest draft" sees
  // the freshest edits (the buffer may hold writes not yet flushed)—this
  // becomes the newest draft version.
  //
  // This flush runs the collection's `beforeChange` hook again. Every
  // buffered save already ran it through `prepareDraft`, so this rarely
  // throws, but a hook can still reject what it once accepted (a section
  // type the site has since removed). That error must surface as a 422
  // with its violations, not the raw 500 an uncaught throw before the
  // try/catch below would produce.
  if (kv) {
    const buffered = await readDraftBuffer(kv, bufferKey);
    if (buffered) {
      try {
        await api.saveDraft(context, id, buffered.data as never);
      } catch (err) {
        if (err instanceof LouiseValidationError) {
          return refused(422, err);
        }
        throw err;
      }
    }
  }
  let versionId = explicitVersionId;
  if (versionId === undefined) {
    const versions = (await api.findVersions(context, id)) as Record<string, unknown>[];
    const [row] = await database.select().from(deps.table).where(eq(pkCol, id)).limit(1);
    if (!row) return { ok: false, status: 404, error: "Not found" };
    const latestDraft = latestPendingDraft(versions);
    const state = pageState(row as Record<string, unknown>);
    if (latestDraft) {
      versionId = toVersionId(latestDraft.id as number);
    } else if (state === "hidden") {
      // Nothing newer to publish, so show the page again as it stands
      // (ADR 0021). No snapshot is copied, so an edit made while it was
      // hidden stays.
      try {
        return { ok: true, body: { page: await api.republish(context, id) } };
      } catch (err) {
        if (err instanceof LouiseContentError) return refused(422, err);
        throw err;
      }
    } else if (state === "new") {
      // Never published and no draft: publish the page as it stands, by
      // saving it as the first version.
      const snapshot: Record<string, unknown> = {};
      const row0 = row as Record<string, unknown>;
      for (const key of Object.keys(flattenFields(deps.config.fields))) {
        if (key in row0) snapshot[key] = row0[key];
      }
      try {
        const first = (await api.saveDraft(context, id, snapshot as never)) as Record<
          string,
          unknown
        >;
        versionId = toVersionId(first.id as number);
      } catch (err) {
        return refused(422, err);
      }
    } else {
      return { ok: false, status: 400, error: "No draft to publish" };
    }
  }
  try {
    const slugBefore = deps.redirects ? await liveSlug() : undefined;
    const page = await api.publish(context, versionId);
    await recordPublishedRename(slugBefore, (page as Record<string, unknown> | null)?.slug);
    // Publishing the current work clears the buffer (its content is now
    // live). An explicit historic republish leaves the buffer—the pending
    // work-in-progress it holds is still newer than what just went live.
    if (kv && explicitVersionId === undefined) await clearDraftBuffer(kv, bufferKey);
    return { ok: true, body: { page } };
  } catch (err) {
    return refused(422, err);
  }
}

/** The fields among `keys` this save changes that someone other than `editor`
 *  holds a soft-lock on. Reads the locks only when a lockable field changes. */
async function lockedByOthers<Env extends EditorRouteEnv>(
  env: Env,
  softLocks: DraftSoftLocks<Env>,
  editor: EditorSession,
  save: {
    slug: string;
    id: PageId;
    keys: readonly string[];
    input: Record<string, unknown>;
    stored: (key: string) => unknown;
  },
): Promise<string[]> {
  const changed: string[] = [];
  for (const key of save.keys) {
    if (!softLocks.fields.includes(key)) continue;
    if ((await fieldRev(save.input[key])) !== (await fieldRev(save.stored(key)))) changed.push(key);
  }
  if (changed.length === 0) return [];
  let locks: Readonly<Record<string, string>>;
  try {
    locks = await softLocks.read(env, { slug: save.slug, id: save.id });
  } catch (err) {
    // Fail open: a soft-lock is advisory, and an unreachable session mustn't
    // stop every save. Reported, because while it lasts the lock isn't checked.
    reportFallback("editor.softLocks", err, { id: save.id });
    return [];
  }
  return changed.filter((key) => {
    const holder = locks[key];
    return holder !== undefined && holder !== "" && holder !== editor.userId;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract per-field violations from a thrown validation error, if present. */
function violationsOf(err: unknown): { message: string; violations?: unknown } {
  const e = err as { message?: string; violations?: unknown };
  return { message: e?.message ?? "Validation failed", violations: e?.violations };
}

/**
 * The newest still-*pending* draft among `versions` (which {@link findVersions}
 * returns newest-first, so the first match is the newest), or `undefined` when
 * there is none. A draft is pending only if it's newer than every version ever
 * promoted (ADR 0021's high-water mark); a draft at or below it is
 * *superseded*—publishing has already moved past it, so it must not be resumed
 * or auto-published as if it were current work. The mark, not the live pointer,
 * because the pointer moves back when an older version is republished, and
 * that mustn't bring stale drafts back.
 *
 * This backs two behaviours:
 *  - **Concurrent surfaces (draft merge base):** a versioned page may mount more
 *    than one editing surface (for example, a rich-text body canvas and a sections dock),
 *    each saving only the fields it owns. Layering every partial save over the
 *    newest pending draft—instead of always over the live row—lets those
 *    surfaces compose into one snapshot rather than each reverting the other's
 *    pending work.
 *  - **Publish with no explicit `versionId`:** promoting "the latest draft" must
 *    skip superseded drafts so a stale snapshot can't silently go live.
 */
export function latestPendingDraft(
  versions: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const highWater = promotedHighWater(versions as unknown as LifecycleVersion[]);
  return versions.find(
    (v) => v.status === "draft" && (highWater === null || (v.id as number) > highWater),
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
    // `${base}/<id>/<action>`—anything else isn't ours.
    const [idStr, action, ...extra] = path.slice(base.length + 1).split("/");
    if (extra.length > 0 || !action) return undefined;
    if (
      action !== "versions" &&
      action !== "publish" &&
      action !== "unpublish" &&
      action !== "discard"
    )
      return undefined;

    const id = parsePageId(idStr);
    if (id === undefined) return json({ error: "Bad id" }, 400);

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

    // GET /:id/versions—history, newest first, each version with its `state`
    // (ADR 0021: pending, scheduled, superseded, current, or earlier), plus the
    // pointer and the page's own state (new, live, or hidden). A version's stored
    // `status` only records that it was promoted once; read `state` instead.
    //
    // `revs` are the field revisions of the work a save would build on (the
    // buffer, else the newest pending draft, else the live row), so the editor
    // can send them back as a save's `$base` (#572).
    if (action === "versions" && method === "GET") {
      const versions = await api.findVersions(context, id);
      const [row] = await database.select().from(cfg.table).where(eq(pkCol, id)).limit(1);
      const live = row as Record<string, unknown> | undefined;
      const publishedVersionId = (live?.publishedVersionId as number | null) ?? null;
      const buffered = kv ? await readDraftBuffer(kv, bufferKey) : null;
      const pending = latestPendingDraft(versions as Record<string, unknown>[]);
      const mergeBase =
        (buffered?.data as Record<string, unknown> | undefined) ??
        (pending?.versionData as Record<string, unknown> | undefined) ??
        live ??
        {};
      const fieldKeys = Object.keys(flattenFields(cfg.config.fields));
      const current: Record<string, unknown> = {};
      for (const key of fieldKeys) current[key] = key in mergeBase ? mergeBase[key] : live?.[key];
      const page = live ?? {};
      const highWater = promotedHighWater(versions as unknown as LifecycleVersion[]);
      return json({
        versions: (versions as unknown as LifecycleVersion[]).map((v) => ({
          ...v,
          state: versionState(v, page, highWater),
        })),
        publishedVersionId,
        pageState: pageState(page),
        revs: await fieldRevs(current, fieldKeys),
      });
    }

    // POST /:id/versions—save a draft. Merge the edit (config fields only) over
    // the newest pending draft's snapshot when one exists, else the live row, so
    // the snapshot is complete and publishable AND a second editing surface's
    // partial save layers onto—rather than reverts—the pending draft. See
    // `latestPendingDraft`.
    if (action === "versions" && method === "POST") {
      const parsedInput = await standardValidate(
        s.record(),
        await request.json().catch(() => null),
      );
      if (!parsedInput.ok) return json({ error: "Invalid JSON" }, 400);
      // The fields, plus the revisions they started from under `$base` (#572).
      const { [DRAFT_BASE_KEY]: rawBase, ...fields } = parsedInput.value;
      const result = await applySaveDraft(env, cfg, g.editor, id, fields, {
        base: parseDraftBase(rawBase),
        softLocks: cfg.softLocks,
      });
      if (!result.ok) {
        return json(
          {
            error: result.error,
            ...(result.violations ? { violations: result.violations } : {}),
            ...(result.conflicts ? { conflicts: result.conflicts } : {}),
            ...(result.locked ? { locked: result.locked } : {}),
          },
          result.status,
        );
      }
      // Persist the D1 bookmark in the editor cookie so the next edit-mode load
      // resumes this draft read-your-writes even behind read replication (#69).
      // keepalive auto-save fetches still process Set-Cookie, and it round-trips
      // on the following top-level navigation—no client code needed.
      const setCookie = serializeD1BookmarkCookie(result.bookmark ?? null);
      return json(result.body, result.status, setCookie ? { "set-cookie": setCookie } : undefined);
    }

    // POST /:id/publish—promote a draft to live. `versionId` in the body (a
    // version of this page, else 404), else the newest still-*pending* draft (a
    // superseded draft—one publishing has already moved past—must not silently
    // go live). See `latestPendingDraft`.
    //
    // Only an absent `versionId` (an empty body, `{}`) means "the latest draft".
    // A `versionId` that's present but isn't a positive JSON integer (`"7"`,
    // `1.5`, `null`, `0`), or a body that isn't a JSON object, is a 400: falling
    // back to the latest draft would publish something the caller never named.
    // The body takes a JSON number, as `discard` does; `parseVersionId`'s
    // decimal strings are for path parameters and tool arguments, not here.
    if (action === "publish" && method === "POST") {
      const bodyText = await request.text();
      let body: unknown = {};
      if (bodyText.trim() !== "") {
        try {
          body = JSON.parse(bodyText);
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
      }
      const parsedBody = await standardValidate(PUBLISH_BODY, body);
      if (!parsedBody.ok) return json({ error: "Bad versionId" }, 400);
      const requestedVersionId = parsedBody.value.versionId;
      const explicitVersionId =
        requestedVersionId === undefined ? undefined : parseVersionId(requestedVersionId);
      if (requestedVersionId !== undefined && explicitVersionId === undefined) {
        return json({ error: "Bad versionId" }, 400);
      }
      const result = await applyPublish(env, cfg, g.editor, id, explicitVersionId);
      return result.ok
        ? json(result.body)
        : json(
            {
              error: result.error,
              ...(result.violations ? { violations: result.violations } : {}),
            },
            result.status,
          );
    }

    // POST /:id/unpublish—hide the page. Its data and pointer stay (ADR 0021),
    // so publishing again brings the same content back.
    if (action === "unpublish" && method === "POST") {
      try {
        return json({ page: await api.unpublish(context, id) });
      } catch (err) {
        if (err instanceof LouiseContentError) return json({ error: err.message }, 422);
        throw err;
      }
    }

    // POST /:id/discard—delete a draft version from history. Body: { versionId }.
    // Scoped to drafts (never the live version) so history stays a safe cleanup.
    if (action === "discard" && method === "POST") {
      const parsedBody = await standardValidate(
        DISCARD_BODY,
        await request.json().catch(() => null),
      );
      if (!parsedBody.ok) return json({ error: "Missing versionId" }, 400);
      const versionId = parseVersionId(parsedBody.value.versionId);
      if (versionId === undefined) return json({ error: "Bad versionId" }, 400);
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

/**
 * Whether a row has pending work a draft save would build on: a KV buffer, or
 * a draft newer than the live pointer. `pagesRoute` checks this before it
 * carries a live write into the draft (#530), so a plain rename in the Pages
 * panel doesn't start a draft of its own.
 */
export async function hasPendingDraft<Env extends EditorRouteEnv = EditorRouteEnv>(
  env: Env,
  deps: SaveDraftDeps<Env>,
  editor: EditorSession,
  id: PageId,
): Promise<boolean> {
  const kv = deps.bufferKv?.(env);
  if (kv && (await readDraftBuffer(kv, draftBufferKey(deps.config.slug, id)))) return true;
  const database = db(env.DB);
  const pkCol = getTableConfig(deps.table).columns.find((c) => c.primary) as SQLiteColumn;
  const [row] = await database.select().from(deps.table).where(eq(pkCol, id)).limit(1);
  if (!row) return false;
  const api = createVersionedLocalApi(database, deps.table, deps.versionsTable, deps.config);
  const versions = (await api.findVersions({ session: editor }, id)) as Record<string, unknown>[];
  return latestPendingDraft(versions) !== undefined;
}
