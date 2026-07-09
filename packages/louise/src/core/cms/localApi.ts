// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

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
  type SQL,
  sql,
} from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { LouiseAccessDeniedError, LouiseCmsError } from "../errors.js";
import { collectionSearchTableName, extractSearchText } from "./codegen.js";
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
 * Louise doesn't standardize its shape — Louise types it as `{ session }`,
 * other consumers may type it differently. `context` is a required first
 * argument on every method (not optional) so a call site can't forget it.
 */
export interface LocalApi<TTable extends AnyTable, TContext = unknown> {
  /**
   * `depth: 0` (default) returns relationship fields as bare ids; `depth: 1`
   * batch-resolves `hasMany: false` relationship fields into the related
   * row, gated by that collection's own `read` access fn — see
   * `resolveRelationships` below. Requires `createLocalApi`'s `registry`
   * param; throws LouiseCmsError if `depth: 1` is requested without one.
   */
  find(
    context: TContext,
    options?: {
      where?: SQL;
      depth?: RelationshipDepth;
      /** Row cap, applied after `where` — for paginated list views. */
      limit?: number;
      /** Rows to skip, applied after `where` — pairs with `limit`. */
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
   * Total row count for `where` (ignoring `limit`/`offset`) — pairs with
   * `find` to compute page counts/next-page availability without fetching
   * every row. Gated by the same `read` access check as `find`.
   */
  count(context: TContext, options?: { where?: SQL }): Promise<number>;
  /**
   * Full-text search over this collection's `search.fields`-configured
   * companion FTS5 table — see types.ts's `CollectionConfig.search` and
   * codegen.ts's `collectionSearchTableSQL`. Gated by `read` access, same
   * as `find`/`findByID`. Throws `LouiseCmsError` if the collection has no
   * `search` config.
   */
  search(
    context: TContext,
    query: string,
    options?: { limit?: number },
  ): Promise<InferSelectModel<TTable>[]>;
  /**
   * Rebuild the FTS5 index from the current main-table rows — clears the index
   * and re-inserts every row's search text. For backfilling after the FTS table
   * is first created (an empty `search.fields`-configured migration) or after a
   * bulk import that bypassed the Local API. Gated by `read` access; returns the
   * number of rows indexed. A no-op (returns 0) when the collection has no
   * `search` config.
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
// `<key>_<subKey>`) — both callers in create()/update() flatten via
// flattenDoc before reaching these, so flattening config.fields too means
// every key in input lines up with a key in this flattened field map.
function validateRequiredFields(config: CollectionConfig, input: Record<string, unknown>): void {
  for (const [key, field] of Object.entries(flattenFields(config.fields))) {
    const hasDefault = field.defaultValue !== undefined;
    if (field.required && !hasDefault && input[key] === undefined) {
      throw new LouiseCmsError(`Missing required field "${key}" for collection "${config.slug}"`);
    }
  }
}

function rejectUnknownFields(config: CollectionConfig, input: Record<string, unknown>): void {
  const flatFields = flattenFields(config.fields);
  for (const key of Object.keys(input)) {
    if (!(key in flatFields)) {
      throw new LouiseCmsError(`Unknown field "${key}" for collection "${config.slug}"`);
    }
  }
}

// The driver-level "UNIQUE constraint failed: …" text we classify on isn't
// always on the top-level error's `message`: drizzle-orm's D1 driver wraps the
// underlying D1/SQLite error, surfacing `message = "Failed query: …"` and
// stashing the real SQLite text on `error.cause` (sometimes a level deeper).
// Classifying off `message` alone therefore misses every unique violation
// against D1 — they fall through to the generic "Write failed", and callers
// that branch on the unique message (e.g. the ecommerce plugin's webhook dedup
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
  if (error instanceof LouiseCmsError) throw error;
  const message = errorChainMessage(error);
  if (message.includes("UNIQUE constraint failed")) {
    throw new LouiseCmsError(`Unique constraint violated for collection "${config.slug}"`, error);
  }
  throw new LouiseCmsError(`Write failed for collection "${config.slug}"`, error);
}

function notFound(config: CollectionConfig, id: number): never {
  throw new LouiseCmsError(`No "${config.slug}" document found with id ${id}`);
}

/**
 * Lets `createLocalApi` resolve `depth: 1` relationship fields without
 * importing every other collection's Local API (which would be a circular
 * dependency the moment two collections relate to each other). The
 * registry is just the raw ingredients — a table and a config per
 * collection slug — built once by the app (e.g. from `cmsConfig.collections`)
 * and passed to every `createLocalApi` call that has relationship fields.
 *
 * `apis` is a second, optional registry on the same object, for a
 * different problem: a *hook* (not `createLocalApi` itself) on one
 * collection that needs to write to *another* collection's Local API —
 * e.g. a CRM upsert hook on a lead-capture collection that creates/updates
 * `contacts`/`activities` rows. `tables`/`configs` can't serve this, since
 * a hook needs a real `LocalApi` (with its own access/hooks/search wiring
 * already applied), not raw ingredients to rebuild one from.
 *
 * The chicken-and-egg problem this solves: building collection A's
 * `LocalApi` might need to reference collection B's `LocalApi` (for a
 * hook), but collection B's `LocalApi` doesn't exist yet at the point A's
 * is constructed — and vice versa if B also has a hook referencing A.
 * The fix is **late binding**: build one `CmsRegistry` object, pass the
 * *same reference* into every `createLocalApi` call (so every collection's
 * hooks close over the same mutable object), construct every `LocalApi`,
 * then fill in `registry.apis` afterwards:
 *
 * ```ts
 * const registry: CmsRegistry = { tables, configs, apis: {} };
 * const contactsApi = createLocalApi(db, contactsTable, contactsCollection, registry);
 * const inquiriesApi = createLocalApi(db, inquiriesTable, inquiriesCollection, registry);
 * // populate *after* every createLocalApi call returns — any hook that
 * // reads registry.apis lazily (inside its returned function body, not
 * // at hook-factory-call time) sees the fully-populated map, since hooks
 * // only ever run once real requests start landing.
 * Object.assign(registry.apis!, { contacts: contactsApi, inquiries: inquiriesApi });
 * ```
 *
 * See `getRegisteredApi` for the accessor a hook factory should use to
 * read from this map, rather than indexing `registry.apis` directly.
 */
export interface CmsRegistry {
  tables: Record<string, AnyTable>;
  configs: Record<string, CollectionConfig>;
  // oxlint-disable-next-line typescript/no-explicit-any -- collections in the same registry can have different TContext shapes — same `any` escape hatch hono/cms.ts's CmsRoutesOptions already uses for the same reason
  apis?: Record<string, LocalApi<AnyTable, any>>;
}

/**
 * Reads collection `slug`'s `LocalApi` out of `registry.apis` — the
 * accessor hook factories should use (see `CmsRegistry`'s doc comment for
 * the late-binding pattern this assumes) instead of indexing
 * `registry.apis` directly, so every caller gets the same clear error if
 * the registry wasn't built/populated correctly. `TContext` is a type-only
 * parameter (the registry itself is stored with `never` to stay variance-
 * safe across collections with different context shapes) — callers assert
 * the context type they expect, the same way `resolveRelationships`'s own
 * registry lookups do.
 */
export function getRegisteredApi<TContext>(
  registry: CmsRegistry | undefined,
  slug: string,
): LocalApi<AnyTable, TContext> {
  const api = registry?.apis?.[slug];
  if (!api) {
    throw new LouiseCmsError(
      `No LocalApi registered for collection "${slug}" — pass a CmsRegistry whose "apis" map has been populated with every collection a hook needs to reach (see CmsRegistry's doc comment for the late-binding build order)`,
    );
  }
  return api;
}

/**
 * Batch-resolves this collection's `hasMany: false` relationship fields
 * for an already-fetched page of `rows`, one query per relationship field
 * (not one query per row — the N+1 the `depth: 1` design note in types.ts
 * calls out avoiding). The related collection's `read` access fn is run
 * once per field against `context`, not once per row: there's a single
 * yes/no for "can this context read collection X", not a row-by-row
 * filter. When it rejects, the field is left as the bare id rather than
 * throwing — a denied relationship is an omission, not a failed request.
 * `hasMany: true` relationship fields are untouched (no column on this
 * table to resolve from — they live in a join table, out of scope here).
 */
async function resolveRelationships<TContext>(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  rows: AnyRecord[],
  context: TContext,
  registry: CmsRegistry | undefined,
): Promise<AnyRecord[]> {
  const relationshipFields = Object.entries(config.fields).filter(
    ([, field]) => field.type === "relationship" && !field.hasMany,
  );
  if (relationshipFields.length === 0) return rows;
  if (!registry) {
    throw new LouiseCmsError(
      `Collection "${config.slug}" requested depth: 1 but createLocalApi was not given a registry to resolve relationship fields against`,
    );
  }

  let result = rows;
  for (const [key, field] of relationshipFields) {
    const relationTo = (field as { relationTo: string }).relationTo;
    const relatedConfig = registry.configs[relationTo];
    const relatedTable = registry.tables[relationTo];
    if (!relatedConfig || !relatedTable) {
      throw new LouiseCmsError(
        `Collection "${config.slug}" field "${key}" relates to unknown collection "${relationTo}" — not present in the registry`,
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

    const relatedRows = await db.select().from(relatedTable).where(inArray(relatedTable.id, ids));
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
// an operation means that operation is unconditionally allowed — matches
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
// collectionSearchTableSQL) in sync on every create/update — issue #29's
// "populated via an afterChange hook" wording, but wired in here rather
// than exposed on `CollectionHooks.afterChange` since it's derived
// entirely from `config.search` (no operator-authored hook function),
// the same precedent as the `versions` companion table being built into
// createVersionedLocalApi rather than a user-facing hook. FTS5 has no
// native UPSERT; a plain DELETE-then-INSERT keyed by rowid (== the main
// table's `id`) is the standard pattern for keeping an external,
// non-content FTS5 table in sync with its source row.
async function syncSearchIndex(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  doc: AnyRecord,
): Promise<void> {
  const fields = config.search?.fields;
  if (!fields?.length) return;
  const id = doc.id;
  if (typeof id !== "number") return;
  const fts = sql.identifier(collectionSearchTableName(config));
  const columnList = sql.join(
    fields.map((key) => sql.identifier(key)),
    sql.raw(", "),
  );
  const values = extractSearchText(config, doc);
  const valueList = sql.join(
    values.map((value) => sql`${value}`),
    sql.raw(", "),
  );
  await db.run(sql`DELETE FROM ${fts} WHERE rowid = ${id}`);
  await db.run(sql`INSERT INTO ${fts} (rowid, ${columnList}) VALUES (${id}, ${valueList})`);
}

async function removeFromSearchIndex(
  db: BaseSQLiteDatabase<"async", unknown>,
  config: CollectionConfig,
  id: number,
): Promise<void> {
  if (!config.search?.fields.length) return;
  const fts = sql.identifier(collectionSearchTableName(config));
  await db.run(sql`DELETE FROM ${fts} WHERE rowid = ${id}`);
}

export function createLocalApi<TTable extends AnyTable, TContext = unknown>(
  db: BaseSQLiteDatabase<"async", unknown>,
  table: TTable,
  config: CollectionConfig,
  registry?: CmsRegistry,
): LocalApi<TTable, TContext> {
  const idColumn = table.id;
  // Group fields are the only reason a document's shape (nested) ever
  // differs from its row's shape (flat columns) — skip the flatten/nest
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
        throw new LouiseCmsError(
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
        throw new LouiseCmsError(
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
        throw new LouiseCmsError(
          `Collection "${config.slug}" has no "search" config — cannot run search()`,
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
      const fts = sql.identifier(collectionSearchTableName(config));
      await db.run(sql`DELETE FROM ${fts}`);
      const rows = await db.select().from(table);
      for (const row of rows) {
        await syncSearchIndex(db, config, toNestedDoc(row as Record<string, unknown>) as AnyRecord);
      }
      return rows.length;
    },

    async create(context, input) {
      await checkAccess(config, "create", context);
      // beforeChange runs before validation so a hook may supply or default
      // a required field (e.g. the SEO plugin defaulting metaTitle). Hooks
      // always see/return the nested document shape — flattening for the
      // DB write happens after, never inside a hook.
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      const flatData = toFlatDoc(data);
      validateRequiredFields(config, flatData);
      rejectUnknownFields(config, flatData);
      // Chainable field rules (#16) — required-flag and unknown-field checks
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
          // oxlint-disable-next-line typescript/no-explicit-any -- TTable is an abstract generic here, so drizzle's column-mapped insert types can't narrow against it — InferInsertModel<TTable> already gives callers the real, concrete typing.
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
      await syncSearchIndex(db, config, doc as AnyRecord);
      await runAfterChange(config, doc as Record<string, unknown>, "create");
      return doc as InferSelectModel<TTable>;
    },

    async update(context, id, input) {
      await checkAccess(config, "update", context);
      const data = await runBeforeChange(config, input as Record<string, unknown>);
      const flatData = toFlatDoc(data);
      rejectUnknownFields(config, flatData);
      // Validate only the fields this partial update actually carries — a
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
      await syncSearchIndex(db, config, doc as AnyRecord);
      await runAfterChange(config, doc as Record<string, unknown>, "update");
      return doc as InferSelectModel<TTable>;
    },

    async deleteByID(context, id) {
      await checkAccess(config, "delete", context);
      await runBeforeDelete(config, id);
      const [rawRow] = await db.delete(table).where(eq(idColumn, id)).returning();
      if (!rawRow) notFound(config, id);
      const row = toNestedDoc(rawRow as Record<string, unknown>);
      await removeFromSearchIndex(db, config, id);
      await runAfterDelete(config, id);
      return row as InferSelectModel<TTable>;
    },
  };
}

function notFoundVersion(config: CollectionConfig, id: number): never {
  throw new LouiseCmsError(`No "${config.slug}" version found with id ${id}`);
}

/**
 * Extends {@link LocalApi} with draft/publish operations for a collection
 * that opted in via `CollectionConfig.versions.drafts` (see codegen.ts's
 * `collectionVersionsTable`). A separate interface (not a wider
 * `LocalApi`) so non-versioned collections' types don't grow these methods
 * — TypeScript can't conditionally widen `createLocalApi`'s return type
 * off a runtime config value, so this is `createVersionedLocalApi`'s own
 * factory rather than a branch inside `createLocalApi`.
 *
 * Scope, deliberately: a document is always created via the inherited
 * `create()` first (existing behavior, unaffected by versioning) — these
 * methods operate against an *existing* row. `saveDraft` never validates
 * required fields (an incomplete draft is valid); `publish` runs the same
 * full validation `create`/`update` do, since publishing is what makes a
 * version the public-facing document. Plain `find`/`findByID` are
 * unchanged by any of this — they always return the main table's current
 * row regardless of `publishedVersionId`; filtering reads to
 * published-only content is not this phase's concern.
 */
export interface VersionedLocalApi<
  TTable extends AnyTable,
  TVersionsTable extends AnyTable,
  TContext = unknown,
> extends LocalApi<TTable, TContext> {
  findVersions(context: TContext, parentId: number): Promise<InferSelectModel<TVersionsTable>[]>;
  /** Inserts a new version row holding `input` as a draft snapshot. */
  saveDraft(
    context: TContext,
    id: number,
    input: Partial<InferInsertModel<TTable>>,
  ): Promise<InferSelectModel<TVersionsTable>>;
  /**
   * Like {@link saveDraft}, but stamps the draft with a `scheduledAt` time so
   * {@link publishScheduled} promotes it once that time arrives.
   */
  scheduleDraft(
    context: TContext,
    id: number,
    input: Partial<InferInsertModel<TTable>>,
    scheduledAt: Date,
  ): Promise<InferSelectModel<TVersionsTable>>;
  /** Copies a version's snapshot onto the main row and marks it published. */
  publish(context: TContext, versionId: number): Promise<InferSelectModel<TTable>>;
  /**
   * Publishes every still-draft version whose `scheduledAt` is at or before
   * `now` (default: the current time), oldest first. Returns the published main
   * rows. Intended to be driven by a scheduled worker (e.g. a Cloudflare cron
   * trigger). A single access check (`publish`) covers the whole batch.
   */
  publishScheduled(context: TContext, now?: Date): Promise<InferSelectModel<TTable>[]>;
  /** Clears the main row's published pointer; the row's data is untouched. */
  unpublish(context: TContext, id: number): Promise<InferSelectModel<TTable>>;
  /**
   * Field-level diff (issue #14) between two version snapshots' `versionData`
   * — the per-field added/removed/changed list a version-history UI renders.
   * Both versions must belong to the same parent. Bookkeeping keys
   * (`id`/`createdAt`/`status`/`publishedVersionId`) are ignored.
   */
  diffVersions(
    context: TContext,
    fromVersionId: number,
    toVersionId: number,
  ): Promise<FieldChange[]>;
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
  registry?: CmsRegistry,
): VersionedLocalApi<TTable, TVersionsTable, TContext> {
  const base = createLocalApi<TTable, TContext>(db, table, config, registry);
  const idColumn = table.id;
  const versionsIdColumn = versionsTable.id;
  const versionsParentIdColumn = versionsTable.parentId;
  const versionsStatusColumn = versionsTable.status;
  const versionsScheduledAtColumn = versionsTable.scheduledAt;

  // Core publish path, shared by publish() and publishScheduled(). Access is
  // checked by the public methods, not here.
  async function doPublish(versionId: number): Promise<InferSelectModel<TTable>> {
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
    let doc: InferSelectModel<TTable> | undefined;
    try {
      const [row] = await db
        .update(table)
        // oxlint-disable-next-line typescript/no-explicit-any -- see createLocalApi.update's .set() cast
        .set({ ...data, publishedVersionId: versionId } as any)
        .where(eq(idColumn, parentId))
        .returning();
      if (!row) notFound(config, parentId);
      doc = row as InferSelectModel<TTable>;
    } catch (error) {
      wrapWriteError(config, error);
    }
    await db
      .update(versionsTable)
      // oxlint-disable-next-line typescript/no-explicit-any -- status is a fixed enum column; scheduledAt is cleared so a re-scheduled republish needs a fresh draft
      .set({ status: "published", scheduledAt: null } as any)
      .where(eq(versionsIdColumn, versionId));
    await syncSearchIndex(db, config, doc as AnyRecord);
    // publish() writes to an already-existing row, never a new one —
    // counts as "update" the same way createLocalApi.update() does.
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
        const versionId = (version as Record<string, unknown>).id as number;
        published.push(await doPublish(versionId));
      }
      return published;
    },

    async unpublish(context, id) {
      await checkAccess(config, "publish", context);
      const [row] = await db
        .update(table)
        // oxlint-disable-next-line typescript/no-explicit-any -- publishedVersionId is a bookkeeping column generated by codegen, not part of InferInsertModel<TTable>
        .set({ publishedVersionId: null } as any)
        .where(eq(idColumn, id))
        .returning();
      if (!row) notFound(config, id);
      return row as InferSelectModel<TTable>;
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
      // Ignore bookkeeping columns — only real content fields are of interest
      // in a version-history view.
      return diffDocuments(before, after, {
        ignore: ["id", "createdAt", "status", "publishedVersionId"],
      });
    },
  };
}
