// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The catalog read, and the Live Content Collection loader over it.
//
// `defineCatalogLoader` (louise-toolkit/astro) already owns the Astro-facing
// plumbing. What each site then hand-wrote was the layer underneath — "read my
// catalog out of D1" — and because that layer was per-site, so was the drift.
// It doesn't need to be: once the mirror table's shape is fixed (see mirror.ts),
// reading it is the same query whatever provider filled it in.
//
// That's what makes one loader definition serve a Square site and a Fourthwall
// site: the loader never learns which provider it is. The sync normalized that
// away before the row was written.

import type { CatalogItem } from "./sync.js";

/** A product as the site renders it: the mirror row, decoded. */
export interface CatalogProduct extends CatalogItem {
  /** Public URL segment — owner-owned, stable across provider renames. */
  slug: string;
  status: "draft" | "published";
  sortOrder: number;
  featured: boolean;
  /** Owned columns this project added, passed through untyped. */
  [key: string]: unknown;
}

/** The D1 surface the read needs. Structural, so a real `D1Database` fits. */
export interface CatalogDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  };
}

export interface CatalogReadOptions {
  db: CatalogDatabase;
  table: string;
  /**
   * Include `draft` rows. Off by default: new remote items land as draft
   * precisely so they don't appear until someone approves them, and a read that
   * ignored that would undo the point of the status column. Turn it on for the
   * editor's own views.
   */
  includeDrafts?: boolean;
}

/** JSON column → value, tolerating both a decoded object and a raw string. */
function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Mirror row → `CatalogProduct`. */
function toProduct(row: Record<string, unknown>): CatalogProduct {
  const { images, variants, external_id, external_slug, sort_order, synced_at, ...rest } = row;
  return {
    ...rest,
    externalId: String(external_id ?? ""),
    externalSlug: typeof external_slug === "string" ? external_slug : undefined,
    slug: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    price: Number(row.price ?? 0),
    images: (decodeJson(images) as string[] | null) ?? [],
    variants: decodeJson(variants),
    status: row.status === "published" ? "published" : "draft",
    sortOrder: Number(sort_order ?? 0),
    featured: Boolean(row.featured),
  };
}

/**
 * Read the catalog. Ordered by `sortOrder` then name, so an owner's manual
 * ordering wins and everything they haven't ordered stays stable rather than
 * shuffling per query.
 */
export async function readCatalog(options: CatalogReadOptions): Promise<CatalogProduct[]> {
  const where = options.includeDrafts ? "" : " WHERE status = 'published'";
  const { results } = await options.db
    .prepare(`SELECT * FROM ${options.table}${where} ORDER BY sort_order ASC, name ASC`)
    .all<Record<string, unknown>>();
  return (results ?? []).map(toProduct);
}

/** Read one product by its public slug. Null when absent or still a draft. */
export async function readCatalogItem(
  slug: string,
  options: CatalogReadOptions,
): Promise<CatalogProduct | null> {
  const where = options.includeDrafts ? "" : " AND status = 'published'";
  const row = await options.db
    .prepare(`SELECT * FROM ${options.table} WHERE slug = ?${where}`)
    .bind(slug)
    .first<Record<string, unknown>>();
  return row ? toProduct(row) : null;
}

/**
 * The config to hand `defineCatalogLoader`, wired to the mirror.
 *
 * ```ts
 * // src/loaders/catalog.ts
 * import { defineCatalogLoader } from "louise-toolkit/astro";
 * import { astroidCatalogLoaderConfig } from "astroidjs";
 *
 * export const catalogLoader = defineCatalogLoader(
 *   astroidCatalogLoaderConfig({ db: env.DB, table: "products" }),
 * );
 * ```
 *
 * Identical for every provider — which is the whole point.
 */
export function astroidCatalogLoaderConfig(options: CatalogReadOptions & { name?: string }) {
  return {
    name: options.name ?? "astroid-catalog",
    loadCatalog: async (filter?: { featured?: boolean }) => {
      const items = await readCatalog(options);
      return {
        items: filter?.featured ? items.filter((i) => i.featured) : items,
      };
    },
    loadItem: (id: string) => readCatalogItem(id, options),
    idOf: (item: CatalogProduct) => item.slug,
  };
}
