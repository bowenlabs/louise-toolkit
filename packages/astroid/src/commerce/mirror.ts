// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The catalog mirror: an external provider is the source of truth, D1 is the
// editable overlay on top of it.
//
// Every consuming site landed on the same split — a set of fields PULLED from
// the provider and overwritten on every sync, and a disjoint set the owner edits
// which must survive every sync. Get that boundary wrong in either direction and
// you either clobber the owner's copy on the next cron tick, or serve a price
// the provider no longer honours.
//
// What the sites did NOT agree on is how much to store, and it turns out to be
// one primitive with two settings rather than two designs:
//
//   mirror   — pulled + owned columns both live in D1 (themidwestartist.com).
//              Reads are one local query. The catalog can be stale between syncs.
//   overlay  — only the owned columns live in D1, keyed by the provider's id
//              (coracle.coffee's `product_display_meta`). The catalog is read
//              live from the provider and joined at read time: never stale,
//              but every read costs a provider round-trip (cache accordingly).
//
// `overlay` is just `mirror` with an empty pulled set, so one generator serves
// both and a project can switch by changing one word.

import type { AstroidConfig } from "../config.js";

/** A column the OWNER edits. Preserved verbatim across every sync. */
export interface OwnedColumn {
  type: "text" | "integer" | "real" | "boolean" | "json";
  /** Restrict a text column to a fixed set (emits a Drizzle `enum`). */
  values?: string[];
  /** Default for new rows. Strings are quoted; others are emitted as literals. */
  default?: string | number | boolean;
  /** Doc comment on the generated column. */
  note?: string;
}

export interface CatalogMirrorConfig {
  /**
   * `mirror` keeps the provider's catalog fields in D1 (fast reads, briefly
   * stale); `overlay` keeps only the owner's fields and reads the catalog live.
   * Default `mirror`.
   */
  mode?: "mirror" | "overlay";
  /** Table name. Default `products`. */
  table?: string;
  /** The owner-editable columns, on top of the built-ins below. */
  owned?: Record<string, OwnedColumn>;
}

/**
 * Columns Astroid always PULLS, overwriting each sync. Fixed rather than
 * configurable because they're the intersection of what every provider returns —
 * a project that wants a provider-specific field puts it in `owned` and fills it
 * itself, which also stops the sync from clobbering it.
 */
export const PULLED_COLUMNS = [
  "name",
  "price",
  "images",
  "variants",
  "externalSlug",
  "syncedAt",
] as const;

/**
 * Owner columns every catalog needs, whatever the site. `slug` is deliberately
 * owned, not pulled: it's the public URL, so a provider renaming a product must
 * not silently break links and SEO.
 */
export const BUILT_IN_OWNED: Record<string, OwnedColumn> = {
  slug: {
    type: "text",
    note: "Public URL segment. Owner-owned so a provider rename can't break links.",
  },
  status: {
    type: "text",
    values: ["draft", "published"],
    default: "draft",
    note: "New remote items land as draft — nothing goes live until someone says so.",
  },
  sortOrder: { type: "real", default: 0 },
  featured: { type: "boolean", default: false },
};

/** The mirror config for a project, with defaults applied. Null when the project
 *  has no storefront to mirror. */
export function astroidCatalogMirror(
  config: AstroidConfig,
): Required<Pick<CatalogMirrorConfig, "mode" | "table">> & { owned: Record<string, OwnedColumn> } {
  const mirror = config.commerce?.catalog ?? {};
  return {
    mode: mirror.mode ?? "mirror",
    table: mirror.table ?? "products",
    // Built-ins first so a project can override one (e.g. widen `status`)
    // without restating the rest.
    owned: { ...BUILT_IN_OWNED, ...mirror.owned },
  };
}

const SQL_NAME = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Drizzle source for one owned column. */
function ownedColumnSource(key: string, col: OwnedColumn): string {
  const name = JSON.stringify(SQL_NAME(key));
  const lit = (v: string | number | boolean) =>
    typeof v === "string" ? JSON.stringify(v) : `${v}`;

  let expr: string;
  switch (col.type) {
    case "boolean":
      expr = `integer(${name}, { mode: "boolean" })`;
      break;
    case "json":
      expr = `text(${name}, { mode: "json" }).$type<JsonValue>()`;
      break;
    case "text":
      expr = col.values?.length
        ? `text(${name}, { enum: ${JSON.stringify(col.values)} })`
        : `text(${name})`;
      break;
    default:
      expr = `${col.type}(${name})`;
  }
  if (col.default !== undefined) expr += `.notNull().default(${lit(col.default)})`;
  return `  ${key}: ${expr},`;
}

/**
 * Drizzle source for the catalog table.
 *
 * `externalId` is unique — it's the sync's idempotency key, so a webhook and the
 * cron re-sync racing on the same product can only ever collide into one row.
 */
export function generateCatalogTable(config: AstroidConfig): string | null {
  if (!config.commerce) return null;
  const { mode, table, owned } = astroidCatalogMirror(config);

  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p(`// The catalog ${mode}. The provider is the source of truth; these rows are`);
  p(
    mode === "mirror"
      ? "// a local copy plus the owner's edits. Pulled columns are overwritten every"
      : "// the owner's edits only — catalog fields are read live from the provider.",
  );
  p("// sync; owned columns are preserved. See astroidCatalogUpsert.");
  p(`export const ${camel(table)} = sqliteTable(${JSON.stringify(table)}, {`);
  p('  id: integer("id").primaryKey({ autoIncrement: true }),');
  p("  // The provider's id for this item — the sync's idempotency key.");
  p('  externalId: text("external_id").notNull().unique(),');

  if (mode === "mirror") {
    p("  // --- PULLED: overwritten on every sync, never hand-edit ---");
    p('  name: text("name").notNull(),');
    p('  price: real("price").notNull().default(0),');
    p('  images: text("images", { mode: "json" }).$type<JsonValue>(),');
    p('  variants: text("variants", { mode: "json" }).$type<JsonValue>(),');
    p('  externalSlug: text("external_slug"),');
  }
  p('  syncedAt: integer("synced_at", { mode: "timestamp" }),');
  p("  // --- OWNED: preserved across every sync ---");
  for (const [key, col] of Object.entries(owned)) {
    if (col.note) p(`  /** ${col.note} */`);
    p(ownedColumnSource(key, col));
  }
  p('  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),');
  p("});");
  p();
  return lines.join("\n");
}

/** `product_display_meta` → `productDisplayMeta`. */
function camel(name: string): string {
  return name.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}

/** SQL column type + constraints for one owned column, matching
 *  {@link ownedColumnSource}'s Drizzle output. */
function ownedColumnSql(key: string, col: OwnedColumn): string {
  const name = SQL_NAME(key);
  // Drizzle stores booleans and timestamps as INTEGER, json as TEXT.
  const type = col.type === "boolean" ? "integer" : col.type === "json" ? "text" : col.type;
  let sql = `  \`${name}\` ${type}`;
  if (col.default !== undefined) {
    const lit =
      typeof col.default === "string"
        ? `'${col.default.replace(/'/g, "''")}'`
        : typeof col.default === "boolean"
          ? col.default
            ? "1"
            : "0"
          : `${col.default}`;
    sql += ` NOT NULL DEFAULT ${lit}`;
  }
  return sql;
}

/**
 * The `CREATE TABLE` for the catalog mirror, as a D1 migration.
 *
 * Derived from the SAME `astroidCatalogMirror(config)` declaration as
 * {@link generateCatalogTable}, so the Drizzle schema and the table that
 * actually exists cannot describe different shapes.
 *
 * It has to exist at all because nothing else creates this table. `--commerce`
 * put `products` in `src/schema.ts` and the queue seam told you to sync into it,
 * but no migration anywhere in the toolkit created it — so the first catalog
 * sync hit a missing table, and (because `astroidCatalogSync` swallows per-item
 * errors) reported success while writing nothing. The documented fallback,
 * `drizzle-kit generate`, could not help: the template ships a hand-authored
 * `0000_content.sql` with no drizzle journal, so drizzle-kit has no baseline and
 * emits a duplicate `0000_` full-CREATE that collides on the next apply.
 *
 * Returns null when the project has no commerce.
 */
export function generateCatalogMigrationSql(config: AstroidConfig): string | null {
  if (!config.commerce) return null;
  const { mode, table, owned } = astroidCatalogMirror(config);

  const cols: string[] = [
    "  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL",
    "  `external_id` text NOT NULL",
  ];
  if (mode === "mirror") {
    cols.push(
      "  `name` text NOT NULL",
      "  `price` real NOT NULL DEFAULT 0",
      "  `images` text",
      "  `variants` text",
      "  `external_slug` text",
    );
  }
  cols.push("  `synced_at` integer");
  for (const [key, col] of Object.entries(owned)) cols.push(ownedColumnSql(key, col));
  cols.push("  `created_at` integer");

  return [
    `-- The catalog ${mode} (${table}). Generated from your Astroid commerce config;`,
    "-- keep it in step with src/schema.ts, which is generated from the same declaration.",
    `CREATE TABLE IF NOT EXISTS \`${table}\` (`,
    cols.join(",\n"),
    ");",
    "",
    "-- The sync's idempotency key: a webhook and the cron re-sync racing on the same",
    "-- product can then only ever collide into one row.",
    `CREATE UNIQUE INDEX IF NOT EXISTS \`${table}_external_id_unique\` ON \`${table}\` (\`external_id\`);`,
    "",
  ].join("\n");
}
