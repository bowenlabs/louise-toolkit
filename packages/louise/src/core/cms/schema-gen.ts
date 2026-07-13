// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import { LouiseCmsError } from "../errors.js";
import { type CmsConfig, type CollectionConfig, type FieldConfig, flattenFields } from "./types.js";

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

// Mirrors codegen.ts's fieldToColumn switch, emitting drizzle-orm
// source text instead of building a runtime column. Kept as its own
// switch (not shared code) since the two have different outputs
// (Column vs. string) — codegen.test.ts's schema-parity assertions are
// what keep this in sync with codegen.ts's actual runtime behavior.
function fieldToColumnSource(key: string, field: FieldConfig, usedBuilders: Set<string>): string {
  const columnName = field.name ?? toSnakeCase(key);

  switch (field.type) {
    case "text":
    case "upload": {
      usedBuilders.add("text");
      let source = `text(${quote(columnName)})`;
      if (field.required) source += ".notNull()";
      if (field.unique) source += ".unique()";
      if (field.defaultValue !== undefined) {
        source += `.default(${quote(field.defaultValue)})`;
      }
      return source;
    }
    case "richText":
    case "array":
    case "json": {
      usedBuilders.add("text");
      // `.$type<JsonValue>()` mirrors codegen.ts's fieldToColumn — see
      // types.ts's JsonValue doc comment for why drizzle's inferred
      // `unknown` needs overriding here. `group` fields never reach here —
      // see flattenFields below.
      let source = `text(${quote(columnName)}, { mode: "json" }).$type<JsonValue>()`;
      if (field.required) source += ".notNull()";
      if (field.defaultValue !== undefined) {
        source += `.default(${JSON.stringify(field.defaultValue)})`;
      }
      return source;
    }
    case "relationship": {
      // hasMany relationship fields never reach here — collectionToTableSource
      // filters them out (see its own comment).
      usedBuilders.add("integer");
      let source = `integer(${quote(columnName)})`;
      if (field.required) source += ".notNull()";
      return source;
    }
    case "select": {
      usedBuilders.add("text");
      const options = field.options.map(quote).join(", ");
      let source = `text(${quote(columnName)}, { enum: [${options}] })`;
      if (field.required) source += ".notNull()";
      if (field.defaultValue !== undefined) {
        source += `.default(${quote(field.defaultValue)})`;
      }
      return source;
    }
    case "number": {
      if (field.autoIncrement) {
        usedBuilders.add("integer");
        return `integer(${quote(columnName)}).primaryKey({ autoIncrement: true })`;
      }
      usedBuilders.add("real");
      let source = `real(${quote(columnName)})`;
      if (field.required) source += ".notNull()";
      if (field.defaultValue !== undefined) {
        source += `.default(${field.defaultValue})`;
      }
      return source;
    }
    case "date": {
      usedBuilders.add("integer");
      const mode = field.mode === "timestamp_ms" ? "timestamp_ms" : "timestamp";
      let source = `integer(${quote(columnName)}, { mode: ${quote(mode)} })`;
      if (field.required) source += ".notNull()";
      if (field.defaultValue === "now") {
        source += ".$defaultFn(() => new Date())";
      } else if (field.defaultValue instanceof Date) {
        source += `.$defaultFn(() => new Date(${field.defaultValue.getTime()}))`;
      }
      if (field.onUpdate === "now") {
        source += ".$onUpdateFn(() => new Date())";
      }
      return source;
    }
    default:
      throw new LouiseCmsError(
        `Field type "${(field as FieldConfig).type}" is not yet supported by louise/cms schema-gen`,
      );
  }
}

function collectionToTableSource(config: CollectionConfig, usedBuilders: Set<string>): string {
  const fieldLines = Object.entries(flattenFields(config.fields))
    // hasMany relationships have no column on this table — emitted as a
    // separate join table instead (see relationshipJoinTableSource).
    .filter(([, field]) => !(field.type === "relationship" && field.hasMany))
    .map(([key, field]) => `  ${key}: ${fieldToColumnSource(key, field, usedBuilders)},`);
  // Mirrors codegen.ts's collectionToTable: a bookkeeping column, not a
  // content field, present only when this collection opts into versioning.
  if (config.versions?.drafts) {
    usedBuilders.add("integer");
    fieldLines.push('  publishedVersionId: integer("published_version_id"),');
  }
  return `export const ${config.slug} = sqliteTable(${quote(config.slug)}, {\n${fieldLines.join("\n")}\n});`;
}

// Mirrors codegen.ts's collectionVersionsTable.
function versionsTableSource(config: CollectionConfig, usedBuilders: Set<string>): string {
  usedBuilders.add("integer");
  usedBuilders.add("text");
  const tableName = `${config.slug}_versions`;
  return (
    `export const ${tableName} = sqliteTable(${quote(tableName)}, {\n` +
    '  id: integer("id").primaryKey({ autoIncrement: true }),\n' +
    '  parentId: integer("parent_id").notNull(),\n' +
    '  versionData: text("version_data", { mode: "json" }).$type<JsonValue>().notNull(),\n' +
    '  status: text("status", { enum: ["draft", "published"] }).notNull(),\n' +
    '  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),\n' +
    '  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),\n' +
    "});"
  );
}

// Mirrors codegen.ts's relationshipJoinTables, emitting one
// sqliteTable() source block per hasMany relationship field.
function relationshipJoinTableSources(
  config: CollectionConfig,
  usedBuilders: Set<string>,
): string[] {
  const blocks: string[] = [];
  for (const [key, field] of Object.entries(config.fields)) {
    if (field.type !== "relationship" || !field.hasMany) continue;
    usedBuilders.add("integer");
    const tableName = `${config.slug}_${key}`;
    const ownColumn = `${config.slug}_id`;
    const relatedColumn = `${field.relationTo}_id`;
    blocks.push(
      `export const ${tableName} = sqliteTable(${quote(tableName)}, {\n` +
        `  ${ownColumn}: integer(${quote(ownColumn)}).notNull(),\n` +
        `  ${relatedColumn}: integer(${quote(relatedColumn)}).notNull(),\n` +
        "});",
    );
  }
  return blocks;
}

// Generates the full TS source for a consuming app's generated Drizzle
// schema file from a CmsConfig. Pure string generation — the caller (a
// script run via tsx) is responsible for writing the result to disk
// (and formatting it). Louise has no opinion on what the app names its
// config file or where it lives — that's app-specific, never hardcoded here.
/** Options for {@link generateSchemaSource}. */
export interface GenerateSchemaOptions {
  /**
   * Collection slugs to omit from the emitted schema — e.g. a consuming site
   * excludes plugin-owned collections here so drizzle-kit diffs only its own
   * tables, letting plugins ship their own migrations.
   */
  exclude?: readonly string[];
}

export function generateSchemaSource(
  config: CmsConfig,
  options: GenerateSchemaOptions = {},
): string {
  const exclude = new Set(options.exclude ?? []);
  const usedBuilders = new Set<string>(["sqliteTable"]);
  const blocks = config.collections
    .filter((collection) => !exclude.has(collection.slug))
    .flatMap((collection) => [
      collectionToTableSource(collection, usedBuilders),
      ...relationshipJoinTableSources(collection, usedBuilders),
      ...(collection.versions?.drafts ? [versionsTableSource(collection, usedBuilders)] : []),
    ]);
  const importList = [...usedBuilders].sort().join(", ");
  // Every JSON column emitted above carries a `.$type<JsonValue>()` call —
  // detected by string search rather than threading a second tracking set
  // through every *Source function, since this is the one place that
  // needs to know about it.
  const needsJsonValue = blocks.some((block) => block.includes(".$type<JsonValue>()"));
  return [
    "// Generated by louise/cms — do not hand-edit.",
    "// Source: this app's CmsConfig (see defineCmsConfig).",
    // Import-sorting formatters (Oxfmt, Biome, Prettier, run over consuming
    // apps, not this generated file directly) order "louise/cms"
    // before "drizzle-orm/sqlite-core" alphabetically — matching that order
    // here means a consumer formatting their repo never sees this generated
    // file flagged as needing a fix.
    ...(needsJsonValue ? ['import type { JsonValue } from "louise/cms";'] : []),
    `import { ${importList} } from "drizzle-orm/sqlite-core";`,
    "",
    blocks.join("\n\n"),
    "",
  ].join("\n");
}
