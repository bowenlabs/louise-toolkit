// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import {
  integer,
  real,
  type SQLiteColumnBuilderBase,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { LouiseCmsError } from "../errors.js";
import {
  type CmsConfig,
  type CollectionConfig,
  type FieldConfig,
  flattenFields,
  type JsonValue,
} from "./types.js";

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// relationship fields with hasMany never reach fieldToColumn — they're
// filtered out in collectionToTable and represented by a join table
// instead (see relationshipJoinTables below). hasMany:false relationship
// fields below store the related row's id as a plain integer, with no
// SQL .references() FK constraint — building real cross-collection FK
// wiring would require a whole-schema pass, not a per-field switch; with
// no real relationship field to validate that design against yet, it's
// deferred rather than half-built.
function fieldToColumn(key: string, field: FieldConfig): SQLiteColumnBuilderBase {
  const columnName = field.name ?? toSnakeCase(key);

  switch (field.type) {
    case "text":
    case "upload": {
      let column = text(columnName);
      if (field.required) column = column.notNull();
      if (field.unique) column = column.unique();
      if (field.defaultValue !== undefined) {
        column = column.default(field.defaultValue);
      }
      return column;
    }
    case "richText":
    case "array":
    case "json": {
      // TipTap JSON / array-group content / freeform json blobs — all a
      // single JSON column. The nested `fields` on an array config
      // describe the JSON shape for introspection only; not enforced at
      // write time in this step. `group` fields never reach here — they're
      // expanded into their flattened equivalents by `flattenFields`
      // before `collectionToTable` builds columns.
      // `.$type<JsonValue>()` overrides drizzle's inferred `unknown` —
      // see types.ts's JsonValue doc comment for why that matters.
      let column = text(columnName, { mode: "json" }).$type<JsonValue>();
      if (field.required) column = column.notNull();
      if (field.defaultValue !== undefined) {
        // BaseFieldConfig types `defaultValue` as `unknown` (it's shared
        // across every field type); a richText/array default is always
        // JSON-shaped data by construction, so this is a narrowing cast,
        // not an escape hatch.
        column = column.default(field.defaultValue as JsonValue);
      }
      return column;
    }
    case "relationship": {
      let column = integer(columnName);
      if (field.required) column = column.notNull();
      return column;
    }
    case "select": {
      let column = text(columnName, {
        enum: field.options as [string, ...string[]],
      });
      if (field.required) column = column.notNull();
      if (field.defaultValue !== undefined) {
        column = column.default(field.defaultValue);
      }
      return column;
    }
    case "number": {
      // autoIncrement marks the table's PK — SQLite's "INTEGER PRIMARY
      // KEY AUTOINCREMENT" rowid-alias behavior requires the literal
      // column type INTEGER, so this case never uses `real`, regardless
      // of the general number-field mapping below.
      if (field.autoIncrement) {
        return integer(columnName).primaryKey({ autoIncrement: true });
      }
      let column = real(columnName);
      if (field.required) column = column.notNull();
      if (field.defaultValue !== undefined) {
        column = column.default(field.defaultValue);
      }
      return column;
    }
    case "date": {
      let column =
        field.mode === "timestamp_ms"
          ? integer(columnName, { mode: "timestamp_ms" })
          : integer(columnName, { mode: "timestamp" });
      if (field.required) column = column.notNull();
      if (field.defaultValue === "now") {
        column = column.$defaultFn(() => new Date());
      } else if (field.defaultValue instanceof Date) {
        const defaultDate = field.defaultValue;
        column = column.$defaultFn(() => defaultDate);
      }
      if (field.onUpdate === "now") {
        column = column.$onUpdateFn(() => new Date());
      }
      return column;
    }
    case "checkbox": {
      // Same SQLite-integer-as-boolean mapping as the hand-written
      // boolean columns in app/core/db/schema.ts (darkMode, etc.) — kept
      // consistent rather than inventing a second boolean convention.
      let column = integer(columnName, { mode: "boolean" });
      if (field.required) column = column.notNull();
      if (field.defaultValue !== undefined) {
        column = column.default(field.defaultValue);
      }
      return column;
    }
    default:
      throw new LouiseCmsError(
        `Field type "${(field as FieldConfig).type}" is not yet supported by louise/cms codegen`,
      );
  }
}

export function collectionToTable(config: CollectionConfig) {
  const columns: Record<string, SQLiteColumnBuilderBase> = {};
  // `group` fields are expanded into `<key>_<subKey>` flattened columns
  // here, before fieldToColumn ever sees them — see types.ts's
  // `flattenFields` doc comment for why this is the one canonicalization
  // step every consumer (codegen, schema-gen, Local API validation) shares.
  for (const [key, field] of Object.entries(flattenFields(config.fields))) {
    // hasMany relationships have no column on this table — they're
    // represented by a join table (see relationshipJoinTables).
    if (field.type === "relationship" && field.hasMany) continue;
    columns[key] = fieldToColumn(key, field);
  }
  // Bookkeeping column, not a content field — absent from config.fields so
  // admin-UI introspection (meta.ts) never sees it. Null until the first
  // publish; createVersionedLocalApi.publish() sets it, .unpublish() clears
  // it. See collectionVersionsTable below for the table it points into.
  if (config.versions?.drafts) {
    columns.publishedVersionId = integer("published_version_id");
  }
  return sqliteTable(config.slug, columns);
}

// One row per saved version (draft or published) of a document, keyed by
// `parentId` (the main table's row id — no SQL FK constraint, same
// deferred-FK precedent as relationship fields above). `versionData` is
// the full document snapshot as JSON, independent of the main table's
// columns — so a draft can hold an incomplete/invalid-for-publish shape
// without touching the main row at all.
export function collectionVersionsTable(config: CollectionConfig) {
  return sqliteTable(`${config.slug}_versions`, {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").notNull(),
    versionData: text("version_data", { mode: "json" }).$type<JsonValue>().notNull(),
    status: text("status", { enum: ["draft", "published"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    // When set on a draft, createVersionedLocalApi.publishScheduled() promotes
    // it once the time arrives. Null = not scheduled. Cleared once published.
    scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  });
}

// For each hasMany relationship field in a collection, builds a join
// table named `${collectionSlug}_${fieldKey}` with two plain integer
// columns. No composite primary key in this step — see codegen.ts's
// module comment on deferred FK enforcement. Known limitation: a
// self-referential relationship (relationTo === the collection's own
// slug) would collide both column names into one — not handled, since
// no collection needs a self-relation yet.
export function relationshipJoinTables(
  config: CollectionConfig,
): Record<string, ReturnType<typeof sqliteTable>> {
  const joinTables: Record<string, ReturnType<typeof sqliteTable>> = {};
  for (const [key, field] of Object.entries(config.fields)) {
    if (field.type !== "relationship" || !field.hasMany) continue;
    const tableName = `${config.slug}_${key}`;
    const ownColumn = `${config.slug}_id`;
    const relatedColumn = `${field.relationTo}_id`;
    const columns: Record<string, SQLiteColumnBuilderBase> = {};
    columns[ownColumn] = integer(ownColumn).notNull();
    columns[relatedColumn] = integer(relatedColumn).notNull();
    joinTables[tableName] = sqliteTable(tableName, columns);
  }
  return joinTables;
}

// FTS5 virtual tables aren't representable as a drizzle-orm sqliteTable —
// drizzle has no virtual-table column builder, so unlike collectionToTable/
// collectionVersionsTable above this emits raw SQL text rather than a
// runtime table object. The migration itself is hand-authored (drizzle-kit
// can't diff a TS schema it was never given), this function just keeps that
// migration's SQL in one place, generated from the same config that drives
// the rest of codegen — see app/core/db/migrations/0006_pages_search_fts.sql.
export function collectionSearchTableName(config: CollectionConfig): string {
  return `${config.slug}_fts`;
}

export function collectionSearchTableSQL(config: CollectionConfig): string {
  const fields = config.search?.fields ?? [];
  if (fields.length === 0) return "";
  const columns = fields.map((key) => `"${key}"`).join(", ");
  return `CREATE VIRTUAL TABLE IF NOT EXISTS "${collectionSearchTableName(config)}" USING fts5(${columns});`;
}

// Flattens a richText field's TipTap JSON into plain text for FTS5
// indexing — walks every node's `text` leaves (TipTap's own shape for a
// run of plain text) and joins them with spaces, ignoring marks/attrs
// entirely since FTS5 only ever sees plain text. Anything that isn't
// TipTap JSON (a bare string, a non-object) is coerced to its own string
// form rather than throwing — search indexing is best-effort, not a
// validation pass.
function flattenRichText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return value.map(flattenRichText).filter(Boolean).join(" ");
  }
  const node = value as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof node.text === "string") parts.push(node.text);
  if (Array.isArray(node.content)) parts.push(flattenRichText(node.content));
  return parts.filter(Boolean).join(" ");
}

// Flattens any JSON value (an `array`/block field, or a freeform `json` blob —
// e.g. the structured "sections" array) into plain text for FTS5 by collecting
// every string leaf, keys included, joined with spaces. Marks/attrs/numbers are
// ignored; indexing is best-effort, so a non-object is coerced to its string
// form rather than throwing.
function flattenJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  const parts = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return parts.map(flattenJson).filter(Boolean).join(" ");
}

// Builds the row inserted into a collection's FTS5 table from a freshly
// written document — one column per `search.fields` entry, in that order,
// matching collectionSearchTableSQL's column list. `text`/`upload` fields
// are indexed as-is; `richText` fields go through flattenRichText, and
// `json` fields through flattenJson.
export function extractSearchText(
  config: CollectionConfig,
  doc: Record<string, unknown>,
): string[] {
  const fields = config.search?.fields ?? [];
  return fields.map((key) => {
    const field = config.fields[key];
    const raw = doc[key];
    if (field?.type === "richText") return flattenRichText(raw);
    if (field?.type === "json") return flattenJson(raw);
    return typeof raw === "string" ? raw : "";
  });
}

export function cmsConfigToSchema(
  config: CmsConfig,
): Record<
  string,
  ReturnType<typeof collectionToTable> | ReturnType<typeof collectionVersionsTable>
> {
  const schema: Record<
    string,
    ReturnType<typeof collectionToTable> | ReturnType<typeof collectionVersionsTable>
  > = {};
  for (const collection of config.collections) {
    schema[collection.slug] = collectionToTable(collection);
    Object.assign(schema, relationshipJoinTables(collection));
    if (collection.versions?.drafts) {
      schema[`${collection.slug}_versions`] = collectionVersionsTable(collection);
    }
  }
  return schema;
}
