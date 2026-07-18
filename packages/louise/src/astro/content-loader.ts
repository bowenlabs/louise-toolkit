// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/astro` — `louiseLoader`: an Astro Content Layer loader that
// exposes a Louise D1 collection through the native `getCollection()` /
// `getEntry()` pipeline, with a Zod schema derived from the collection's own
// `defineCollection` fields (so entry data is typed the same way the editor
// models it).
//
// Content Layer loaders run at BUILD time (in Node, during `astro build`), where
// Cloudflare bindings don't exist — so, like `defineCatalogLoader`, the *read*
// is injected: a site supplies `read()` (typically the D1 REST API at build, or
// a snapshot) and this owns the rest — schema mapping, store population, content
// digests for incremental builds, and fail-safe error handling. The result is a
// build-time snapshot of published content; rebuild on publish (e.g. a webhook)
// to refresh it. For request-time freshness, read D1 directly in an SSR page (or
// use the Live-collection `defineCatalogLoader`).
//
// `astro` is an OPTIONAL peer (see the entry note): `Loader`/`DataStore` types
// come from `astro/loaders` and the Zod builder from `astro/zod`, pulled in only
// by sites that import this subpath.

import type { Loader } from "astro/loaders";
import { z } from "astro/zod";
import type { CollectionConfig, FieldConfig } from "../core/content/types.js";

/** A published row as read from D1 — a document in the collection's field shape. */
export type LouiseRow = Record<string, unknown>;

/**
 * Map one Louise field to its Zod type. The budget is deliberately permissive on
 * read: D1 is the source of truth and the values were already validated on write
 * (the Local API), so this describes shape for `getCollection`'s types rather
 * than re-litigating validity.
 */
function fieldToZod(field: FieldConfig): z.ZodType {
  switch (field.type) {
    case "text":
    case "upload":
      return z.string();
    case "select":
      return field.options.length > 0
        ? z.enum([...field.options] as [string, ...string[]])
        : z.string();
    case "number":
    // A `hasMany: false` relationship is a plain integer column (the related
    // row's id); `hasMany: true` has no column and is dropped in `mapFields`.
    case "relationship":
      return z.number();
    case "checkbox":
      // D1 stores booleans as 0/1 — accept either and normalize to boolean.
      return z.union([z.boolean(), z.number().transform((n) => n !== 0)]);
    case "date":
      // D1 stores dates as integer epochs; a REST/JSON read may hand back a
      // number or an ISO string. `coerce` accepts all three.
      return z.coerce.date();
    case "group":
      // A group flattens to real columns in D1, but the Local API re-nests it on
      // read — so mirror the config's nested object shape.
      return z.object(mapFields(field.fields));
    // JSON-backed columns (rich text, builder arrays, freeform json) pass through
    // untouched — their inner shape is the site's concern, not the loader's.
    case "richText":
    case "array":
    case "json":
      return z.unknown();
    default:
      return z.unknown();
  }
}

/** Build the `{ key: ZodType }` shape for a set of fields, honoring required. */
function mapFields(fields: Record<string, FieldConfig>): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    // A hasMany relationship lives in a join table — no column on this row.
    if (field.type === "relationship" && field.hasMany) continue;
    const base = fieldToZod(field);
    // Non-required columns are nullable in D1 and may be absent from a row.
    shape[key] = field.required ? base : base.nullable().optional();
  }
  return shape;
}

/**
 * Build an Astro (Zod) schema from a collection's `defineCollection` fields.
 * Unknown/bookkeeping columns (`id`, `status`, timestamps) are dropped — the
 * schema captures exactly the declared fields, so `getCollection` entry data
 * matches the editor's model.
 */
export function collectionToAstroSchema(collection: CollectionConfig): z.ZodType {
  return z.object(mapFields(collection.fields));
}

export interface LouiseLoaderConfig {
  /** The collection definition (from `defineCollection`) — drives the schema. */
  collection: CollectionConfig;
  /**
   * Read the published rows to expose, each a document in the collection's field
   * shape. The site owns D1 access (the loader runs at build time, off any
   * binding) — typically the D1 REST API, or a cached snapshot. Only published
   * rows should be returned; drafts never reach `getCollection`.
   */
  read: () => Promise<LouiseRow[]>;
  /**
   * The entry id (unique key) for a row. Default: `row.slug ?? row.id`, matching
   * how Louise pages are addressed.
   */
  idOf?: (row: LouiseRow) => string | number;
  /** Loader name (Astro convention). Default `louise:<slug>`. */
  name?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A Content Layer loader over a Louise D1 collection. Register it with Astro's
 * `defineCollection`:
 *
 * ```ts
 * // src/content.config.ts
 * import { defineCollection } from "astro:content";
 * import { louiseLoader } from "louise-toolkit/astro";
 * import { pagesCollection } from "./pages-collection";
 * import { readPublishedPages } from "./lib/louise/published-pages";
 *
 * export const collections = {
 *   pages: defineCollection({
 *     loader: louiseLoader({ collection: pagesCollection, read: readPublishedPages }),
 *   }),
 * };
 * ```
 *
 * then read with `getCollection("pages")` / `getEntry("pages", slug)` — typed
 * from the collection's own fields, no hand-written schema.
 */
export function louiseLoader(config: LouiseLoaderConfig): Loader {
  const slug = config.collection.slug;
  const name = config.name ?? `louise:${slug}`;
  const idOf = config.idOf ?? ((row: LouiseRow) => (row.slug ?? row.id) as string | number);

  return {
    name,
    schema: collectionToAstroSchema(config.collection),
    async load(context) {
      // `parseData`/`generateDigest` are called on `context` rather than
      // destructured: pulling them out unbinds them from the loader context
      // (`typescript/unbound-method`); Astro binds them, but the bound call keeps
      // the intent explicit.
      const { store, logger } = context;
      let rows: LouiseRow[];
      try {
        rows = await config.read();
      } catch (error) {
        // Fail safe: leave the last good store in place rather than wiping the
        // collection to empty on a transient read failure. `logger` is already
        // scoped to the loader name by Astro, so don't re-prefix it.
        logger.error(`read failed, keeping existing entries: ${errorMessage(error)}`);
        return;
      }

      store.clear();
      for (const row of rows) {
        const id = String(idOf(row));
        const data = await context.parseData({ id, data: row });
        store.set({ id, data, digest: context.generateDigest(data) });
      }
      logger.info(`loaded ${rows.length} published ${rows.length === 1 ? "entry" : "entries"}`);
    },
  };
}
