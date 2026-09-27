// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import {
  and,
  asc,
  count as countRows,
  desc,
  eq,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  isNotNull,
  lte,
  max,
  type SQL,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  type BaseSQLiteDatabase,
  integer,
  type SQLiteColumnBuilderBase,
  type SQLiteTableWithColumns,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { reportDegraded } from "../degraded.js";
import { LouiseAccessDeniedError, LouiseContentError } from "../errors.js";
import { collectionSearchTableName, extractSearchText } from "./codegen.js";
import type { PageId, VersionId } from "./ids.js";
import { diffDocuments, type FieldChange } from "./patch.js";
import {
  type CollectionAccess,
  type CollectionConfig,
  flattenDoc,
  flattenFields,
  type JsonValue,
  nestDoc,
  type RelationshipDepth,
} from "./types.js";
import { assertValid } from "./validation.js";

// oxlint-disable-next-line typescript/no-explicit-any -- matches drizzle-orm's own SQLiteTableWithColumns default generic usage
type AnyTable = SQLiteTableWithColumns<any>;

/**
 * `TContext` is the per-request value passed to every method and forwarded
 * unchanged to the collection's `access` functions (see {@link CollectionAccess}).
 * Louise doesn't standardize its shape—Louise types it as `{ session }`,
 * other consumers may type it differently. `context` is a required first
 * argument on every method (not optional) so a call site can't forget it.
 */
export interface LocalApi<TTable extends AnyTable, TContext = unknown> {
  /**
   * `depth: 0` (default) returns relationship fields as bare ids; `depth: 1`
   * batch-resolves `hasMany: false` relationship fields into the related
   * row, gated by that collection's own `read` access fn—see
   * `resolveRelationships` below. Requires `createLocalApi`'s `registry`
   * param; throws LouiseContentError if `depth: 1` is requested without one.
   */
  find(
    context: TContext,
    options?: {
      where?: SQL;
      depth?: RelationshipDepth;
      /** Row cap, applied after `where`—for paginated list views. */
      limit?: number;
      /** Rows to skip, applied after `where`—pairs with `limit`. */
      offset?: number;
      /** One or more `asc(table.col)`/`desc(table.col)` expressions. */
      orderBy?: SQL | SQL[];
    },
  ): Promise<InferSelectModel<TTable>[]>;
  findByID(
    context: TContext,
    id: number,
    options?: { depth?: RelationshipDepth },
  ): Promise<InferSelectModel<TTable>>;
  /**
   * Total row count for `where` (ignoring `limit`/`offset`)—pairs with
   * `find` to compute page counts/next-page availability without fetching
   * every row. Gated by the same `read` access check as `find`.
   */
  count(context: TContext, options?: { where?: SQL }): Promise<number>;
  /**
   * Full-text search over this collection's `search.fields`-configured
   * companion FTS5 table—see types.ts's `CollectionConfig.search` and
   * codegen.ts's `collectionSearchTableSQL`. Gated by `read` access, same
   * as `find`/`findByID`. Throws `LouiseContentError` if the collection has no
   * `search` config.
   */
  search(
    context: TContext,
    query: string,
    options?: { limit?: number },
  ): Promise<InferSelectModel<TTable>[]>;
  /**
   * Rebuild the FTS5 index from the current main-table rows—replaces every
   * row's entry in place, in batches that each commit as one transaction, then
   * removes the entries whose row no longer exists. The index never empties
   * along the way, so a search during a rebuild returns whole results, and a
   * rebuild that fails partway leaves every entry old or new, never missing.
   * For backfilling after the FTS table is first created (an empty
   * `search.fields`-configured migration) or after a bulk import that bypassed
   * the Local API; to update one row after a write, use {@link reindexDoc}.
   * Gated by `read` access; returns the number of rows indexed. A no-op
   * (returns 0) when the collection has no `search` config.
   */
  reindexSearch(context: TContext): Promise<number>;
  create(context: TContext, input: InferInsertModel<TTable>): Promise<InferSelectModel<TTable>>;
  update(
    context: TContext,
    id: number,
    input: Partial<InferInsertModel<TTable>>,
  ): Promise<InferSelectModel<TTable>>;
  deleteByID(context: TContext, id: number): Promise<InferSelectModel<TTable>>;
}

// `input` here is always already-flattened (group fields expanded to
// `<key>_<subKey>`)—both callers in create()/update() flatten via
// flattenDoc before reaching these, so flattening config.fields too means
// every key in input lines up with a key in this flattened field map.
function validateRequiredFields(config: CollectionConfig, input: Record<string, unknown>): void {
  for (const [key, field] of Object.entries(flattenFields(config.fields))) {
    const hasDefault = field.defaultValue !== undefined;
    if (field.required && !hasDefault && input[key] === undefined) {
      throw new LouiseContentError(
        `Missing required field "${key}" for collection "${config.slug}"`,
      );
    }
  }
}

function rejectUnknownFields(config: CollectionConfig, input: Record<string, unknown>): void {
  const flatFields = flattenFields(config.fields);
  for (const key of Object.keys(input)) {
    if (!(key in flatFields)) {
      throw new LouiseContentError(`Unknown field "${key}" for collection "${config.slug}"`);
    }
  }
}

// The driver-level "UNIQUE constraint failed: …" text we classify on isn't
// always on the top-level error's `message`: drizzle-orm's D1 driver wraps the
// underlying D1/SQLite error, surfacing `message = "Failed query: …"` and
// stashing the real SQLite text on `error.cause` (sometimes a level deeper).
// Classifying off `message` alone therefore misses every unique violation
// against D1—they fall through to the generic "Write failed", and callers
// that branch on the unique message (for example, the ecommerce plugin's webhook dedup
// guard) never recognize the duplicate. Flatten the whole `cause` chain so the
// match holds regardless of how deep the driver buried it. The depth cap is a
// guard against a pathological self-referential `cause`.
function errorChainMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts.join(" | ");
}

function wrapWriteError(config: CollectionConfig, error: unknown): never {
  if (error instanceof LouiseContentError) throw error;
  const message = errorChainMessage(error);
  if (message.includes("UNIQUE constraint failed")) {
    throw new LouiseContentError(
      `Unique constraint violated for collection "${config.slug}"`,
      error,
    );
  }
  throw new LouiseContentError(`Write failed for collection "${config.slug}"`, error);
}

/**
 * Returns the table's `id` column, the key `findByID`, `update`, `deleteByID`,
 * search, and every versioned method look rows up by. Throws
 * `LouiseContentError` naming the fix when the table has no `id` column, so a
 * collection without one fails where the Local API is built rather than on its
 * first query with an error about SQL. A table from `collectionToTable` gets
 * the column only when the collection declares an `id` field with
 * `autoIncrement: true`; a hand-written table needs its own.
 */
function requireIdColumn(table: AnyTable, config: CollectionConfig): AnyTable["id"] {
  if (table.id !== undefined) return table.id;
  const autoIncrementKey = Object.entries(config.fields).find(
    ([, field]) => field.type === "number" && field.autoIncrement,
  )?.[0];
  const fix = autoIncrementKey
    ? `Rename its autoIncrement field "${autoIncrementKey}" to "id", and set the field's \`name\` to keep the column name.`
    : 'Add `id: { type: "number", autoIncrement: true }` to the collection\'s fields, or `id: integer("id").primaryKey({ autoIncrement: true })` to a table you wrote by hand.';
  throw new LouiseContentError(
    `Collection "${config.slug}" can't use the Local API because its table has no "id" column, which the Local API finds, updates, and deletes rows by. ${fix}`,
  );
}

function notFound(config: CollectionConfig, id: number): never {
  throw new LouiseContentError(`No "${config.slug}" document found with id ${id}`);
}

/**
 * Lets `createLocalApi` resolve `depth: 1` relationship fields without
 * importing every other collection's Local API (which would be a circular
 * dependency the moment two collections relate to each other). The
 * registry is just the raw ingredients—a table and a config per
 * collection slug—built once by the app (for example, from `contentConfig.collections`)
 * and passed to every `createLocalApi` call that has relationship fields.
 *
 * `apis` is a second, optional registry on the same object, for a
 * different problem: a *hook* (not `createLocalApi` itself) on one
 * collection that needs to write to *another* collection's Local API—for example,
 * a CRM upsert hook on a lead-capture collection that creates/updates
 * `contacts`/`activities` rows. `tables`/`configs` can't serve this, since
 * a hook needs a real `LocalApi` (with its own access/hooks/search wiring
 * already applied), not raw ingredients to rebuild one from.
 *
 * The chicken-and-egg problem this solves: building collection A's
 * `LocalApi` might need to reference collection B's `LocalApi` (for a
 * hook), but collection B's `LocalApi` doesn't exist yet at the point A's
 * is constructed—and vice versa if B also has a hook referencing A.
 * The fix is **late binding**: build one `ContentRegistry` object, pass the
 * *same reference* into every `createLocalApi` call (so every collection's
 * hooks close over the same mutable object), construct every `LocalApi`,
 * then fill in `registry.apis` afterwards:
 *
 * ```ts
 * const registry: ContentRegistry = { tables, configs, apis: {} };
 * const contactsApi = createLocalApi(db, contactsTable, contactsCollection, registry);
 * const inquiriesApi = createLocalApi(db, inquiriesTable, inquiriesCollection, registry);
 * // populate *after* every createLocalApi call returns; any hook that
 * // reads registry.apis lazily (inside its returned function body, not
 * // at hook-factory-call time) sees the fully-populated map, since hooks
 * // only ever run once real requests start landing.
 * Object.assign(registry.apis!, { contacts: contactsApi, inquiries: inquiriesApi });
 * ```
 *
 * See `getRegisteredApi` for the accessor a hook factory should use to
 * read from this map, rather than indexing `registry.apis` directly.
 */
export interface ContentRegistry {
  tables: Record<string, AnyTable>;
  configs: Record<string, CollectionConfig>;
  // oxlint-disable-next-line typescript/no-explicit-any -- collections in the same registry can have different TContext shapes—same `any` escape hatch hono/content.ts's ContentRoutesOptions already uses for the same reason
  apis?: Record<string, LocalApi<AnyTable, any>>;
}

/**
 * Reads collection `slug`'s `LocalApi` out of `registry.apis`—the
 * accessor hook factories should use (see `ContentRegistry`'s doc comment for
 * the late-binding pattern this assumes) instead of indexing
 * `registry.apis` directly, so every caller gets the same clear error if
 * the registry wasn't built/populated correctly. `TContext` is a type-only
 * parameter (the registry itself is stored with `never` to stay variance-
 * safe across collections with different context shapes)—callers assert
 * the context type they expect, the same way `resolveRelationships`'s own
 * registry lookups do.
 */
export function getRegisteredApi<TContext>(
  registry: ContentRegistry | undefined,
  slug: string,
): LocalApi<AnyTable, TContext> {
  const api = registry?.apis?.[slug];
  if (!api) {
    throw new LouiseContentError(
      `No LocalApi registered for collection "${slug}". Pass a ContentRegistry whose "apis" map has been populated with every collection a hook needs to reach (see ContentRegistry's doc comment for the late-binding build order)`,
    );
  }
  return api;
}

/**
 * Batch-resolves this collection's `hasMany: false` relationship fields
 * for an already-fetched page of `rows`, one query per relationship field
 * (not one query per row—the N+1 the `depth: 1` design note in types.ts
 * calls out avoiding). The related collection's `read` access fn is run
 * once per field against `context`, not once per row: there's a single
 * yes/no for "can this context read collection X", not a row-by-row
 * filter. When it rejects, the field is left as the bare id rather than
 * throwing—a denied relationship is an omission, not a failed request.
 * `hasMany: true` relationship fields are untouched (no column on this
 * table to resolve from—they live in a join table, out of scope here).
 */
async function resolveRelationships<TContext>(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  rows: AnyRecord[],
  context: TContext,
  registry: ContentRegistry | undefined,
): Promise<AnyRecord[]> {
  const relationshipFields = Object.entries(config.fields).filter(
    ([, field]) => field.type === "relationship" && !field.hasMany,
  );
  if (relationshipFields.length === 0) return rows;
  if (!registry) {
    throw new LouiseContentError(
      `Collection "${config.slug}" requested depth: 1 but createLocalApi was not given a registry to resolve relationship fields against`,
    );
  }

  let result = rows;
  for (const [key, field] of relationshipFields) {
    const relationTo = (field as { relationTo: string }).relationTo;
    const relatedConfig = registry.configs[relationTo];
    const relatedTable = registry.tables[relationTo];
    if (!relatedConfig || !relatedTable) {
      throw new LouiseContentError(
        `Collection "${config.slug}" field "${key}" relates to unknown collection "${relationTo}", which isn't in the registry`,
      );
    }

    const readFn = relatedConfig.access?.read;
    const allowed = readFn ? await readFn(context) : true;
    if (!allowed) continue;

    const ids = [
      ...new Set(
        result.map((row) => row[key]).filter((id): id is number => typeof id === "number"),
      ),
    ];
    if (ids.length === 0) continue;

    const relatedIdColumn = requireIdColumn(relatedTable, relatedConfig);
    const relatedRows = await db.select().from(relatedTable).where(inArray(relatedIdColumn, ids));
    const byId = new Map(relatedRows.map((row) => [(row as AnyRecord).id, row as AnyRecord]));

    result = result.map((row) => {
      const id = row[key];
      const related = typeof id === "number" ? byId.get(id) : undefined;
      return related ? { ...row, [key]: related } : row;
    });
  }
  return result;
}

// Hook runners. `config.hooks` (CollectionHooks) is folded into every
// write/read below. Transforming hooks (beforeChange, beforeRead,
// afterRead) run in array order, each fed the previous one's output; side-
// effect hooks (afterChange, beforeDelete, afterDelete) run in order for
// their effects only. All may be async. `config.access` is checked by
// checkAccess() below, before any hook or DB work runs for that operation.
type AnyRecord = Record<string, unknown>;

/**
 * Non-throwing counterpart to `checkAccess` below, for UI code that wants
 * to hide/disable an action a context can't perform rather than let it
 * fail server-side after a click (see Phase 6 / issue #26's
 * `getPageCapabilities`). `checkAccess` calls through this same function
 * rather than duplicating the "no access fn = allowed" logic, so `can()`'s
 * answer and the real operation's enforcement can never disagree.
 */
export async function can<TContext>(
  config: CollectionConfig,
  operation: keyof CollectionAccess,
  context: TContext,
): Promise<boolean> {
  const fn = config.access?.[operation];
  if (!fn) return true;
  return await fn(context);
}

// Runs config.access[operation](context) if configured, throwing
// LouiseAccessDeniedError when it resolves false. No access function for
// an operation means that operation is unconditionally allowed—matches
// the pre-Section-2 default of "no enforcement at all".
async function checkAccess<TContext>(
  config: CollectionConfig,
  operation: keyof CollectionAccess,
  context: TContext,
): Promise<void> {
  if (await can(config, operation, context)) return;
  throw new LouiseAccessDeniedError(
    `Access denied for "${operation}" on collection "${config.slug}"`,
  );
}

async function runBeforeChange(config: CollectionConfig, data: AnyRecord): Promise<AnyRecord> {
  let result = data;
  for (const hook of config.hooks?.beforeChange ?? []) {
    result = (await hook({ data: result })) as AnyRecord;
  }
  return result;
}

async function runAfterChange(
  config: CollectionConfig,
  doc: AnyRecord,
  operation: "create" | "update",
): Promise<void> {
  for (const hook of config.hooks?.afterChange ?? []) {
    await hook({ doc, operation });
  }
}

async function runReadHooks(config: CollectionConfig, doc: AnyRecord): Promise<AnyRecord> {
  let result = doc;
  for (const hook of config.hooks?.beforeRead ?? []) {
    result = (await hook({ doc: result })) as AnyRecord;
  }
  for (const hook of config.hooks?.afterRead ?? []) {
    result = (await hook({ doc: result })) as AnyRecord;
  }
  return result;
}

function hasReadHooks(config: CollectionConfig): boolean {
  return Boolean(config.hooks?.beforeRead?.length || config.hooks?.afterRead?.length);
}

async function runBeforeDelete(config: CollectionConfig, id: number): Promise<void> {
  for (const hook of config.hooks?.beforeDelete ?? []) {
    await hook({ id });
  }
}

async function runAfterDelete(config: CollectionConfig, id: number): Promise<void> {
  for (const hook of config.hooks?.afterDelete ?? []) {
    await hook({ id });
  }
}

// Keeps a collection's FTS5 companion table (see codegen.ts's
// collectionSearchTableSQL) in sync on every create/update—issue #29's
// "populated via an afterChange hook" wording, but wired in here rather
// than exposed on `CollectionHooks.afterChange` since it's derived
// entirely from `config.search` (no operator-authored hook function),
// the same precedent as the `versions` companion table being built into
// createVersionedLocalApi rather than a user-facing hook. FTS5 has no
// native UPSERT; a plain DELETE-then-INSERT keyed by rowid (== the main
// table's `id`) is the standard pattern for keeping an external,
// non-content FTS5 table in sync with its source row. The pair goes out as
// one batch, which D1 commits as one transaction, so a reader sees the old
// entry or the new one—never neither—and a failure between the two can't
// drop the row from search (#573).
async function syncSearchIndex(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  doc: AnyRecord,
): Promise<void> {
  await runAtomically(db, searchIndexStatements(db, config, doc));
}

/** A Drizzle table object for a collection's FTS5 table, so its statements are
 *  query builders. Drizzle's D1 driver can't batch a raw `db.run(sql…)` that has
 *  bound parameters, but it can batch a builder. Cached per config. */
const searchTables = new WeakMap<CollectionConfig, AnyTable>();
function searchTable(config: CollectionConfig): AnyTable {
  let table = searchTables.get(config);
  if (!table) {
    const columns: Record<string, SQLiteColumnBuilderBase> = { rowid: integer("rowid") };
    for (const key of config.search?.fields ?? []) columns[key] = text(key);
    table = sqliteTable(collectionSearchTableName(config), columns) as AnyTable;
    searchTables.set(config, table);
  }
  return table;
}

/** The unexecuted DELETE and INSERT that replace one row's FTS entry, or none
 *  for a non-searchable collection or a row without a numeric ID (the FTS
 *  rowid). Drizzle statements run only when awaited or batched, so the caller
 *  decides how they commit. */
function searchIndexStatements(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  doc: AnyRecord,
): SearchIndexStatement[] {
  const fields = config.search?.fields;
  if (!fields?.length) return [];
  const id = doc.id;
  if (typeof id !== "number") return [];
  const fts = searchTable(config);
  const values = extractSearchText(config, doc);
  const entry: Record<string, unknown> = { rowid: id };
  fields.forEach((key, index) => {
    entry[key] = values[index];
  });
  return [db.delete(fts).where(eq(fts.rowid, id)), db.insert(fts).values(entry)];
}

/** A statement that can go in a batch, or run alone when awaited. */
type SearchIndexStatement = BatchItem<"sqlite"> & PromiseLike<unknown>;

/** Rows per reindex batch: two statements each, so 100 statements a batch. A
 *  batch is one D1 transaction, and a transaction blocks every other write to
 *  the database while it runs, so a whole-table rebuild commits in slices
 *  rather than in one long transaction. */
const REINDEX_BATCH_ROWS = 50;

/** Run statements as one batch, which D1 and libsql commit as one transaction.
 *  A driver without `batch` runs them in order instead, the prior behavior. */
async function runAtomically(
  db: BaseSQLiteDatabase<"async", unknown>,
  statements: readonly SearchIndexStatement[],
): Promise<void> {
  if (statements.length === 0) return;
  if (canBatch(db)) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement;
}

async function removeFromSearchIndex(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  id: number,
): Promise<void> {
  if (!config.search?.fields.length) return;
  const fts = searchTable(config);
  await db.delete(fts).where(eq(fts.rowid, id));
}

/**
 * Enqueue a reindex of the changed row (by id) instead of updating the FTS
 * index inline—the seam that moves search sync off the write path (#77).
 * Supplied via {@link LocalApiOptions.deferReindex}; a queue consumer later
 * runs {@link reindexDoc} to do the actual sync. Returning normally must mean
 * "enqueued", so a failure to enqueue surfaces on the write (the caller can
 * decide whether that fails the request).
 */
export type DeferReindex = (id: number, info?: DeferReindexInfo) => void | Promise<void>;

/** What a {@link DeferReindex} learns about the write beyond the row id. */
export interface DeferReindexInfo {
  /** Set when the write is a publish: the version that went live. Key
   *  per-publish follow-up work by it (a Workflow instance ID, say), because
   *  the row id repeats on every publish of the same page. */
  versionId?: VersionId;
}

export interface LocalApiOptions {
  /** Move FTS sync off the write path: when set, create/update/publish/delete
   *  call this with the changed row's id INSTEAD of syncing the index inline
   *  (#77). No-op collections (no `config.search`) never call it. */
  deferReindex?: DeferReindex;
}

/** Sync the index inline, or hand the row id to `deferReindex`—whichever the
 *  collection is configured for. Skips non-searchable collections and rows
 *  without a numeric id (the FTS rowid). */
async function reindexOrDefer(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  doc: AnyRecord,
  deferReindex?: DeferReindex,
  info?: DeferReindexInfo,
): Promise<void> {
  if (!config.search?.fields.length) return;
  const id = doc.id;
  if (typeof id !== "number") return;
  if (deferReindex) await deferReindex(id, info);
  else await syncSearchIndex(db, config, doc);
}

/** Delete counterpart of {@link reindexOrDefer}. A deferred delete enqueues the
 *  same id; the consumer re-reads, finds the row gone, and removes the entry. */
async function removeOrDefer(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  id: number,
  deferReindex?: DeferReindex,
): Promise<void> {
  if (!config.search?.fields.length) return;
  if (deferReindex) await deferReindex(id);
  else await removeFromSearchIndex(db, config, id);
}

/**
 * Sync one row's FTS entry by id—the deferred counterpart to the inline
 * search sync (#77). Re-reads the current row: present → upsert its index
 * entry; absent (it was deleted) → remove it. Call this from a queue consumer
 * to drain a `deferReindex(id)` job. No-op for a collection without
 * `config.search`, so it's always safe to call.
 */
export async function reindexDoc(
  db: BaseSQLiteDatabase<"async", unknown>,
  table: AnyTable,
  config: CollectionConfig,
  id: number,
): Promise<void> {
  if (!config.search?.fields.length) return;
  const idColumn = requireIdColumn(table, config);
  const [row] = await db.select().from(table).where(eq(idColumn, id));
  if (!row) {
    await removeFromSearchIndex(db, config, id);
    return;
  }
  const hasGroupFields = Object.values(config.fields).some((field) => field.type === "group");
  const doc = hasGroupFields
    ? (nestDoc(config.fields, row as Record<string, unknown>) as AnyRecord)
    : (row as AnyRecord);
  await syncSearchIndex(db, config, doc);
}

/**
 * Builds the access-controlled, validated Local API for one collection over its
 * Drizzle `table`. The table needs an `id` column, which the API finds,
 * updates, and deletes rows by: declare `id: { type: "number", autoIncrement:
 * true }` in the collection's fields when the table comes from
 * `collectionToTable`. Throws `LouiseContentError` when it's missing.
 */
export function createLocalApi<TTable extends AnyTable, TContext = unknown>(
  db: BaseSQLiteDatabase<"async", unknown>,
  table: TTable,
  config: CollectionConfig,
  registry?: ContentRegistry,
  options?: LocalApiOptions,
): LocalApi<TTable, TContext> {
  const deferReindex = options?.deferReindex;
  // Checked here, not on first use: `find`, `count`, and `create` don't key on
  // `id`, so without this an API missing it works until the first `findByID`,
  // `update`, or publish, and then fails with an error about SQL.
  const idColumn = requireIdColumn(table, config);
  // Group fields are the only reason a document's shape (nested) ever
  // differs from its row's shape (flat columns)—skip the flatten/nest
  // round-trip entirely for the common case of a collection with none, so
  // every existing collection (none of which have group fields yet) pays
  // zero cost for this.
  const hasGroupFields = Object.values(config.fields).some((field) => field.type === "group");
  const toFlatDoc = (doc: Record<string, unknown>) =>
    hasGroupFields ? flattenDoc(config.fields, doc) : doc;
  const toNestedDoc = (row: Record<string, unknown>) =>
    hasGroupFields ? (nestDoc(config.fields, row) as AnyRecord) : row;

  return {
    async find(context, options) {
      await checkAccess(config, "read", context);
      if (options?.depth !== undefined && options.depth !== 0 && options.depth !== 1) {
        throw new LouiseContentError(
          `Relationship resolution depth ${options.depth} is not supported for collection "${config.slug}" (only 0 and 1 are)`,
        );
      }
      let query = db.select().from(table).where(options?.where).$dynamic();
      if (options?.orderBy !== undefined) {
        query = query.orderBy(
          ...(Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy]),
        );
      }
      if (options?.limit !== undefined) query = query.limit(options.limit);
      if (options?.offset !== undefined) query = query.offset(options.offset);
      const rows = await query;
      const nestedRows = rows.map((row) => toNestedDoc(row as Record<string, unknown>));
      const afterHooks = hasReadHooks(config)
        ? await Promise.all(
            nestedRows.map((row) => runReadHooks(config, row as Record<string, unknown>)),
          )
        : nestedRows;
      const resolved =
        options?.depth === 1
          ? await resolveRelationships(db, config, afterHooks as AnyRecord[], context, registry)
          : afterHooks;
      return resolved as InferSelectModel<TTable>[];
    },

    async count(context, options) {
      await checkAccess(config, "read", context);
      const [row] = await db.select({ value: countRows() }).from(table).where(options?.where);
      return row?.value ?? 0;
    },

    async findByID(context, id, options) {
      await checkAccess(config, "read", context);
      if (options?.depth !== undefined && options.depth !== 0 && options.depth !== 1) {
        throw new LouiseContentError(
          `Relationship resolution depth ${options.depth} is not supported for collection "${config.slug}" (only 0 and 1 are)`,
        );
      }
      const [row] = await db.select().from(table).where(eq(idColumn, id));
      if (!row) notFound(config, id);
      const nestedRow = toNestedDoc(row as Record<string, unknown>);
      const afterHooks = hasReadHooks(config)
        ? await runReadHooks(config, nestedRow as Record<string, unknown>)
        : nestedRow;
      const resolved =
        options?.depth === 1
          ? (
              await resolveRelationships(db, config, [afterHooks as AnyRecord], context, registry)
            )[0]
          : afterHooks;
      return resolved as InferSelectModel<TTable>;
    },

    async search(context, query, options) {
      await checkAccess(config, "read", context);
      if (!config.search?.fields.length) {
        throw new LouiseContentError(
          `Collection "${config.slug}" has no "search" config, so search() can't run`,
        );
      }
      const fts = sql.identifier(collectionSearchTableName(config));
      const limit = options?.limit ?? 20;
      const rows = await db.all(sql`
        SELECT ${table}.* FROM ${fts}
        JOIN ${table} ON ${idColumn} = ${fts}.rowid
        WHERE ${fts} MATCH ${query}
        ORDER BY rank
        LIMIT ${limit}
      `);
      return rows.map((row) =>
        toNestedDoc(row as Record<string, unknown>),
      ) as InferSelectModel<TTable>[];
    },

    async reindexSearch(context) {
      await checkAccess(config, "read", context);
      if (!config.search?.fields.length) return 0;
      // Replace each row's entry in place, then drop only the entries whose row
      // is gone. Emptying the table first would let a search during the rebuild
      // return partial results, and leave them partial if the rebuild failed
      // partway (#573). Each batch commits as one transaction, so a reader sees
      // every entry either before or after its replacement.
      const fts = sql.identifier(collectionSearchTableName(config));
      const rows = await db.select().from(table);
      for (let start = 0; start < rows.length; start += REINDEX_BATCH_ROWS) {
        const statements = rows
          .slice(start, start + REINDEX_BATCH_ROWS)
          .flatMap((row) =>
            searchIndexStatements(
              db,
              config,
              toNestedDoc(row as Record<string, unknown>) as AnyRecord,
            ),
          );
        await runAtomically(db, statements);
      }
      // A subquery rather than `NOT IN (…)` over bound IDs: SQLite caps bound
      // parameters, and it also keeps an entry for a row created since the read.
      await db.run(sql`DELETE FROM ${fts} WHERE rowid NOT IN (SELECT ${idColumn} FROM ${table})`);
      return rows.length;
    },

    async create(context, input) {
      await checkAccess(config, "create", context);
      // beforeChange runs before validation so a hook may supply or default
      // a required field (for example, the SEO plugin defaulting metaTitle). Hooks
      // always see/return the nested document shape—flattening for the
      // DB write happens after, never inside a hook.
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      const flatData = toFlatDoc(data);
      validateRequiredFields(config, flatData);
      rejectUnknownFields(config, flatData);
      // Chainable field rules (#16)—required-flag and unknown-field checks
      // above stay; this adds value-level rules (min/max/regex/unique/
      // reference/custom) and throws LouiseValidationError with per-field
      // violations. Runs after beforeChange so a hook-supplied value is
      // validated, and before the insert so unique/reference pre-check
      // rather than relying on a raw DB constraint error.
      await assertValid(config, data as Record<string, unknown>, {
        operation: "create",
        db,
        table,
        registry,
      });
      let row: InferSelectModel<TTable> | undefined;
      try {
        const [inserted] = await db
          .insert(table)
          // oxlint-disable-next-line typescript/no-explicit-any -- TTable is an abstract generic here, so drizzle's column-mapped insert types can't narrow against it—InferInsertModel<TTable> already gives callers the real, concrete typing.
          .values(flatData as any)
          .returning();
        row = inserted as InferSelectModel<TTable>;
      } catch (error) {
        wrapWriteError(config, error);
      }
      // wrapWriteError returns `never`, so reaching here means the insert
      // succeeded and `row` is set. afterChange runs outside the try so its
      // side-effect errors aren't mis-reported as write failures.
      const doc = toNestedDoc(row as AnyRecord);
      await reindexOrDefer(db, config, doc as AnyRecord, deferReindex);
      await runAfterChange(config, doc as Record<string, unknown>, "create");
      return doc as InferSelectModel<TTable>;
    },

    async update(context, id, input) {
      await checkAccess(config, "update", context);
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      const flatData = toFlatDoc(data);
      rejectUnknownFields(config, flatData);
      // Validate only the fields this partial update actually carries—a
      // partial update must not fail an absent field's rules (it isn't
      // changing it). `unique` excludes this row by id.
      await assertValid(config, data as Record<string, unknown>, {
        operation: "update",
        id,
        onlyFields: new Set(Object.keys(flatData)),
        db,
        table,
        registry,
      });
      let row: InferSelectModel<TTable> | undefined;
      try {
        const [updated] = await db
          .update(table)
          // oxlint-disable-next-line typescript/no-explicit-any -- see create() above
          .set(flatData as any)
          .where(eq(idColumn, id))
          .returning();
        if (!updated) notFound(config, id);
        row = updated as InferSelectModel<TTable>;
      } catch (error) {
        wrapWriteError(config, error);
      }
      const doc = toNestedDoc(row as AnyRecord);
      await reindexOrDefer(db, config, doc as AnyRecord, deferReindex);
      await runAfterChange(config, doc as Record<string, unknown>, "update");
      return doc as InferSelectModel<TTable>;
    },

    async deleteByID(context, id) {
      await checkAccess(config, "delete", context);
      await runBeforeDelete(config, id);
      const [rawRow] = await db.delete(table).where(eq(idColumn, id)).returning();
      if (!rawRow) notFound(config, id);
      const row = toNestedDoc(rawRow as Record<string, unknown>);
      await removeOrDefer(db, config, id, deferReindex);
      await runAfterDelete(config, id);
      return row as InferSelectModel<TTable>;
    },
  };
}

function notFoundVersion(config: CollectionConfig, id: number): never {
  throw new LouiseContentError(`No "${config.slug}" version found with id ${id}`);
}

/**
 * Extends {@link LocalApi} with draft/publish operations for a collection
 * that opted in via `CollectionConfig.versions.drafts` (see codegen.ts's
 * `collectionVersionsTable`). A separate interface (not a wider
 * `LocalApi`) so non-versioned collections' types don't grow these methods;
 * TypeScript can't conditionally widen `createLocalApi`'s return type
 * off a runtime config value, so this is `createVersionedLocalApi`'s own
 * factory rather than a branch inside `createLocalApi`.
 *
 * Scope, deliberately: a document is always created via the inherited
 * `create()` first (existing behavior, unaffected by versioning)—these
 * methods operate against an *existing* row. `saveDraft` never validates
 * required fields (an incomplete draft is valid); `publish` runs the same
 * full validation `create`/`update` do, since publishing is what makes a
 * version the public-facing document. Plain `find`/`findByID` are
 * unchanged by any of this—they always return the main table's current
 * row regardless of `publishedVersionId`; filtering reads to
 * published-only content is not this phase's concern.
 */
export interface VersionedLocalApi<
  TTable extends AnyTable,
  TVersionsTable extends AnyTable,
  TContext = unknown,
> extends LocalApi<TTable, TContext> {
  findVersions(context: TContext, parentId: PageId): Promise<InferSelectModel<TVersionsTable>[]>;
  /**
   * The checks and transforms every draft write runs, without writing: the
   * `update` access check, the collection's `beforeChange` hooks (where a site
   * sanitizes rich text), and the unknown-field check. Returns the snapshot a
   * saved draft would hold. For a caller that keeps a draft somewhere other
   * than the versions table, such as the editor's KV auto-save buffer, so that
   * copy never skips what {@link saveDraft} enforces.
   */
  prepareDraft(
    context: TContext,
    input: Partial<InferInsertModel<TTable>>,
  ): Promise<Record<string, unknown>>;
  /** Inserts a new version row holding `input` as a draft snapshot. */
  saveDraft(
    context: TContext,
    id: PageId,
    input: Partial<InferInsertModel<TTable>>,
  ): Promise<InferSelectModel<TVersionsTable>>;
  /**
   * Like {@link saveDraft}, but stamps the draft with a `scheduledAt` time so
   * {@link publishScheduled} promotes it once that time arrives.
   */
  scheduleDraft(
    context: TContext,
    id: PageId,
    input: Partial<InferInsertModel<TTable>>,
    scheduledAt: Date,
  ): Promise<InferSelectModel<TVersionsTable>>;
  /**
   * Copies a version's snapshot onto the main row it belongs to, points
   * `publishedVersionId` at it, marks the version promoted, and makes the row
   * live (`status = 'published'`, when the table has a `status` column), all in
   * one batch (ADR 0021). The version's own `parentId` names that row, so when
   * `versionId` comes from a request about a particular page, check that the
   * version belongs to that page first, as `versionsRoute` does.
   */
  publish(context: TContext, versionId: VersionId): Promise<InferSelectModel<TTable>>;
  /**
   * Publishes every still-draft version whose `scheduledAt` is at or before
   * `now` (default: the current time), oldest first. Returns the published main
   * rows. Intended to be driven by a scheduled worker (for example, a Cloudflare cron
   * trigger). A single access check (`publish`) covers the whole batch. A due
   * draft that a later publish superseded is skipped (ADR 0021), so a schedule
   * can't put older content back over newer.
   */
  publishScheduled(context: TContext, now?: Date): Promise<InferSelectModel<TTable>[]>;
  /**
   * Hides the main row from visitors (`status = 'draft'`). The row's data and
   * its `publishedVersionId` stay, so publishing again restores the same
   * content (ADR 0021). Throws {@link LouiseContentError} when the table has no
   * `status` column, since there's then no visibility to change.
   */
  unpublish(context: TContext, id: PageId): Promise<InferSelectModel<TTable>>;
  /**
   * Makes a hidden row live again as it stands (`status = 'published'`),
   * without copying a snapshot over it, so an edit made to the row while it
   * was hidden stays. Throws {@link LouiseContentError} when the row has never
   * been published (publish a version instead) or the table has no `status`
   * column.
   */
  republish(context: TContext, id: PageId): Promise<InferSelectModel<TTable>>;
  /**
   * Delete a single version row from the history (for example, discarding a draft).
   * Refuses to delete the current version, whose snapshot backs the row even
   * while it's hidden, throwing {@link LouiseContentError}; publish another
   * version first if that's intended.
   * Access: `update` (same gate as saving a draft).
   */
  discardVersion(context: TContext, versionId: VersionId): Promise<void>;
  /**
   * Field-level diff (issue #14) between two version snapshots' `versionData`:
   * the per-field added/removed/changed list a version-history UI renders.
   * Both versions must belong to the same parent. Bookkeeping keys
   * (`id`/`createdAt`/`status`/`publishedVersionId`) are ignored.
   */
  diffVersions(
    context: TContext,
    fromVersionId: VersionId,
    toVersionId: VersionId,
  ): Promise<FieldChange[]>;
}

/** A driver that exposes D1/libsql's atomic `batch([...])`. The generic
 *  `BaseSQLiteDatabase` type doesn't declare it (it's driver-specific), so the
 *  publish path and the search sync feature-detect it: batch atomically where
 *  available, fall back to sequential writes on any driver that lacks it. */
interface BatchableDb {
  batch(statements: readonly unknown[]): Promise<unknown[]>;
}
function canBatch(db: unknown): db is BatchableDb {
  return typeof (db as Partial<BatchableDb>).batch === "function";
}

export function createVersionedLocalApi<
  TTable extends AnyTable,
  TVersionsTable extends AnyTable,
  TContext = unknown,
>(
  db: BaseSQLiteDatabase<"async", unknown>,
  table: TTable,
  versionsTable: TVersionsTable,
  config: CollectionConfig,
  registry?: ContentRegistry,
  options?: LocalApiOptions,
): VersionedLocalApi<TTable, TVersionsTable, TContext> {
  const base = createLocalApi<TTable, TContext>(db, table, config, registry, options);
  const deferReindex = options?.deferReindex;
  // `createLocalApi` above already threw if the table has no `id` column.
  const idColumn = table.id;
  const versionsIdColumn = versionsTable.id;
  const versionsParentIdColumn = versionsTable.parentId;
  const versionsStatusColumn = versionsTable.status;
  const versionsScheduledAtColumn = versionsTable.scheduledAt;
  // The visibility column (ADR 0021). A collection's table may not have one; then
  // publish only promotes, and unpublish has nothing to hide.
  const hasStatus = (table as unknown as Record<string, unknown>).status !== undefined;

  // The highest version of `parentId` ever promoted: a draft at or below it is
  // superseded, however the pointer has moved since.
  async function promotedHighWaterFor(parentId: number): Promise<number | null> {
    const [row] = await db
      .select({ high: max(versionsIdColumn) })
      .from(versionsTable)
      .where(and(eq(versionsParentIdColumn, parentId), eq(versionsStatusColumn, "published")));
    const high = (row as { high?: unknown } | undefined)?.high;
    return typeof high === "number" ? high : null;
  }

  // Core publish path, shared by publish() and publishScheduled(). Access is
  // checked by the public methods, not here.
  async function doPublish(versionId: VersionId): Promise<InferSelectModel<TTable>> {
    const [version] = await db.select().from(versionsTable).where(eq(versionsIdColumn, versionId));
    if (!version) notFoundVersion(config, versionId);
    const versionRecord = version as Record<string, unknown>;
    const data = await runBeforeChange(
      config,
      versionRecord.versionData as Record<string, unknown>,
    );
    validateRequiredFields(config, data);
    rejectUnknownFields(config, data);
    const parentId = versionRecord.parentId as number;
    // Publishing writes the whole version snapshot to the live row, so
    // validate every field (not a partial). `unique` excludes the parent
    // row by its own id.
    await assertValid(config, data, {
      operation: "update",
      id: parentId,
      db,
      table,
      registry,
    });
    // Guard the parent row's existence BEFORE writing. Publish flips the version
    // to "published" and promotes its snapshot onto the live row; when those two
    // writes batch atomically (below), a blind batch against a missing parent
    // would still mark the version published against a row that isn't there—so
    // check first, outside the batch.
    const [existing] = await db.select({ id: idColumn }).from(table).where(eq(idColumn, parentId));
    if (!existing) notFound(config, parentId);

    // The two writes that make a publish: promote the snapshot onto the live row
    // (+ point `publishedVersionId` at this version, and make the row live), and
    // mark the version row promoted. Built as (unexecuted) statements so they can
    // either batch or run sequentially.
    const promoteLiveRow = db
      .update(table)
      .set({
        ...data,
        publishedVersionId: versionId,
        ...(hasStatus ? { status: "published" } : {}),
        // oxlint-disable-next-line typescript/no-explicit-any -- see createLocalApi.update's .set() cast
      } as any)
      .where(eq(idColumn, parentId))
      .returning();
    const markVersionPublished = db
      .update(versionsTable)
      // oxlint-disable-next-line typescript/no-explicit-any -- status is a fixed enum column; scheduledAt is cleared so a re-scheduled republish needs a fresh draft
      .set({ status: "published", scheduledAt: null } as any)
      .where(eq(versionsIdColumn, versionId));

    let doc: InferSelectModel<TTable> | undefined;
    try {
      let row: unknown;
      if (canBatch(db)) {
        // Atomic on D1/libsql: both writes commit as one implicit transaction, so
        // a mid-write failure can never leave the row published while its version
        // still reads "draft" (or vice versa).
        const results = await db.batch([promoteLiveRow, markVersionPublished]);
        row = (results[0] as unknown[])[0];
      } else {
        // Fallback for a driver without `batch`: the prior sequential behavior.
        row = ((await promoteLiveRow) as unknown[])[0];
        await markVersionPublished;
      }
      if (!row) notFound(config, parentId);
      doc = row as InferSelectModel<TTable>;
    } catch (error) {
      wrapWriteError(config, error);
    }
    // The publish has committed, so from here a failure mustn't be reported as
    // a failed publish: the page is live whatever the caller hears. A reindex
    // (or a deferred follow-up, such as starting a Workflow) that throws is
    // reported as a degrade instead, and the search entry catches up on the
    // next write or `reindexDoc`.
    try {
      await reindexOrDefer(db, config, doc as AnyRecord, deferReindex, { versionId });
    } catch (err) {
      reportDegraded("content.publish.reindex", err, {
        collection: config.slug,
        id: parentId,
        versionId,
      });
    }
    // publish() writes to an already-existing row, never a new one—counts
    // as "update" the same way createLocalApi.update() does.
    await runAfterChange(config, doc as Record<string, unknown>, "update");
    return doc as InferSelectModel<TTable>;
  }

  return {
    ...base,

    async findVersions(context, parentId) {
      await checkAccess(config, "read", context);
      const rows = await db
        .select()
        .from(versionsTable)
        .where(eq(versionsParentIdColumn, parentId))
        .orderBy(desc(versionsIdColumn));
      return rows as InferSelectModel<TVersionsTable>[];
    },

    async prepareDraft(context, input) {
      await checkAccess(config, "update", context);
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      rejectUnknownFields(config, data);
      return data;
    },

    async saveDraft(context, id, input) {
      await checkAccess(config, "update", context);
      const [parent] = await db.select().from(table).where(eq(idColumn, id));
      if (!parent) notFound(config, id);
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      rejectUnknownFields(config, data);
      const insertValues = {
        parentId: id,
        versionData: data,
        status: "draft",
        // oxlint-disable-next-line typescript/no-explicit-any -- TVersionsTable is abstract here, same rationale as createLocalApi.create's .values() cast
      } as any;
      const [row] = await db.insert(versionsTable).values(insertValues).returning();
      return row as InferSelectModel<TVersionsTable>;
    },

    async scheduleDraft(context, id, input, scheduledAt) {
      await checkAccess(config, "update", context);
      const [parent] = await db.select().from(table).where(eq(idColumn, id));
      if (!parent) notFound(config, id);
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      rejectUnknownFields(config, data);
      const insertValues = {
        parentId: id,
        versionData: data,
        status: "draft",
        scheduledAt,
        // oxlint-disable-next-line typescript/no-explicit-any -- TVersionsTable is abstract here, same rationale as saveDraft above
      } as any;
      const [row] = await db.insert(versionsTable).values(insertValues).returning();
      return row as InferSelectModel<TVersionsTable>;
    },

    async publish(context, versionId) {
      await checkAccess(config, "publish", context);
      return doPublish(versionId);
    },

    async publishScheduled(context, now = new Date()) {
      await checkAccess(config, "publish", context);
      const due = await db
        .select()
        .from(versionsTable)
        .where(
          and(
            eq(versionsStatusColumn, "draft"),
            isNotNull(versionsScheduledAtColumn),
            lte(versionsScheduledAtColumn, now),
          ),
        )
        .orderBy(asc(versionsIdColumn));
      const published: InferSelectModel<TTable>[] = [];
      for (const version of due) {
        const record = version as Record<string, unknown>;
        // Read per draft, not once: an earlier draft in this batch may have just
        // raised its page's high-water mark.
        const highWater = await promotedHighWaterFor(record.parentId as number);
        if (highWater !== null && (record.id as number) <= highWater) continue;
        published.push(await doPublish(record.id as VersionId));
      }
      return published;
    },

    async unpublish(context, id) {
      await checkAccess(config, "publish", context);
      if (!hasStatus) {
        throw new LouiseContentError(
          `"${config.slug}" has no status column, so it can't be hidden; add one to unpublish`,
        );
      }
      const [row] = await db
        .update(table)
        // oxlint-disable-next-line typescript/no-explicit-any -- status is the visibility column (ADR 0021), not part of InferInsertModel<TTable> for every table
        .set({ status: "draft" } as any)
        .where(eq(idColumn, id))
        .returning();
      if (!row) notFound(config, id);
      return row as InferSelectModel<TTable>;
    },

    async republish(context, id) {
      await checkAccess(config, "publish", context);
      if (!hasStatus) {
        throw new LouiseContentError(
          `"${config.slug}" has no status column, so it's always live once published`,
        );
      }
      const [current] = await db.select().from(table).where(eq(idColumn, id));
      if (!current) notFound(config, id);
      if ((current as Record<string, unknown>).publishedVersionId == null) {
        throw new LouiseContentError(
          `"${config.slug}" ${id} has never been published; publish a version instead`,
        );
      }
      const [row] = await db
        .update(table)
        // oxlint-disable-next-line typescript/no-explicit-any -- status is the visibility column (ADR 0021), not part of InferInsertModel<TTable> for every table
        .set({ status: "published" } as any)
        .where(eq(idColumn, id))
        .returning();
      if (!row) notFound(config, id);
      return row as InferSelectModel<TTable>;
    },

    async discardVersion(context, versionId) {
      await checkAccess(config, "update", context);
      const [version] = await db
        .select()
        .from(versionsTable)
        .where(eq(versionsIdColumn, versionId));
      if (!version) notFoundVersion(config, versionId);
      const parentId = (version as Record<string, unknown>).parentId as number;
      const [parent] = await db.select().from(table).where(eq(idColumn, parentId));
      // The row holds the current version's snapshot, live or hidden, so deleting
      // it would orphan the pointer. Unpublishing keeps the pointer (ADR 0021),
      // so the only way past this is publishing another version.
      if (parent && (parent as Record<string, unknown>).publishedVersionId === versionId) {
        throw new LouiseContentError(
          `Cannot discard the current "${config.slug}" version ${versionId}; publish another version first`,
        );
      }
      await db.delete(versionsTable).where(eq(versionsIdColumn, versionId));
    },

    async diffVersions(context, fromVersionId, toVersionId) {
      await checkAccess(config, "read", context);
      const rows = await db
        .select()
        .from(versionsTable)
        .where(inArray(versionsIdColumn, [fromVersionId, toVersionId]));
      const byId = new Map(
        rows.map((r) => [
          (r as Record<string, unknown>).id as number,
          (r as Record<string, unknown>).versionData as Record<string, JsonValue>,
        ]),
      );
      const before = byId.get(fromVersionId);
      const after = byId.get(toVersionId);
      if (!before) notFoundVersion(config, fromVersionId);
      if (!after) notFoundVersion(config, toVersionId);
      // Ignore bookkeeping columns—only real content fields are of interest
      // in a version-history view.
      return diffDocuments(before, after, {
        ignore: ["id", "createdAt", "status", "publishedVersionId"],
      });
    },
  };
}
