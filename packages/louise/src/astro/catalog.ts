// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise/astro` — `defineCatalogLoader`: the shared plumbing for a commerce
// catalog served as an Astro Live Content Collection. Live collections fetch at
// request time, so a price/stock edit shows on the next render with no rebuild.
//
// Every catalog loader repeats the same boilerplate — map items to keyed entries,
// stamp a `cacheHint` (a tag for future webhook-driven purges, plus the snapshot
// age as `lastModified`), and wrap a read failure as a loader error instead of a
// 500. That lives here ONCE. A site injects only what's domain-specific: how to
// read its (cached) catalog, how to resolve one item, and each item's slug — so
// a Fourthwall site and a Square site share one loader definition and only their
// `lib/<provider>` reads differ.
//
// `astro` is an OPTIONAL peer (see the entry note); only the `LiveLoader` *type*
// is imported, and only by sites that pull in this subpath.

import type { LiveLoader } from "astro/loaders";

// Astro's own `LiveLoader` constrains its data/filter generics to
// `Record<string, any>` — crucially, that (unlike `Record<string, unknown>`)
// admits a plain `interface`, which has no implicit index signature. Mirror it
// exactly so any site's product/filter interface slots straight in.
// oxlint-disable-next-line typescript/no-explicit-any -- matches astro's LiveLoader generic constraint
type AnyRecord = Record<string, any>;

/**
 * What a site provides to build a catalog live loader. `Data` is the entry shape
 * (e.g. a display product); `Filter` is the collection query shape.
 */
export interface CatalogLoaderConfig<
  Data extends AnyRecord,
  Filter extends AnyRecord = Record<string, never>,
> {
  /** Loader name (Astro convention: the npm package or a stable id). Also the
   *  default `cacheHint` tag. */
  name: string;
  /**
   * Load the (cached) catalog for a collection query, already narrowed to what
   * the query asks for (the site owns its own filtering — category trees, etc.).
   * `fetchedAt` (epoch ms) becomes the `cacheHint.lastModified` so the hint
   * reflects the snapshot's age, not the render time.
   */
  loadCatalog: (
    filter: Filter | undefined,
  ) => Promise<{ items: Data[]; fetchedAt?: number | null }>;
  /** Resolve a single item by its entry id (slug). `null` → not found (Astro
   *  raises `LiveEntryNotFoundError`, which the page can turn into a redirect). */
  loadItem: (id: string) => Promise<Data | null>;
  /** The entry id (slug) for an item — keys the collection and resolves
   *  `getLiveEntry("catalog", slug)`. */
  idOf: (item: Data) => string;
  /** `cacheHint` tag for tag-based purges. Default: `name`. */
  tag?: string;
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/**
 * Build an Astro {@link LiveLoader} for a commerce catalog from a site's cached
 * reads. Register the result in `src/live.config.ts`:
 *
 * ```ts
 * import { defineLiveCollection } from "astro:content";
 * import { catalogLoader } from "./loaders/catalog";
 * export const collections = { catalog: defineLiveCollection({ loader: catalogLoader }) };
 * ```
 *
 * then consume with `getLiveCollection("catalog")` / `getLiveEntry("catalog", slug)`.
 */
export function defineCatalogLoader<
  Data extends AnyRecord,
  Filter extends AnyRecord = Record<string, never>,
>(config: CatalogLoaderConfig<Data, Filter>): LiveLoader<Data, { id: string }, Filter> {
  const tag = config.tag ?? config.name;
  const cacheHint = (fetchedAt?: number | null) => ({
    tags: [tag],
    ...(fetchedAt ? { lastModified: new Date(fetchedAt) } : {}),
  });

  return {
    name: config.name,

    async loadCollection({ filter }) {
      try {
        const { items, fetchedAt } = await config.loadCatalog(filter);
        const hint = cacheHint(fetchedAt);
        return {
          entries: items.map((item) => ({ id: config.idOf(item), data: item, cacheHint: hint })),
          cacheHint: hint,
        };
      } catch (error) {
        return { error: toError(error, `${config.name} catalog load failed`) };
      }
    },

    async loadEntry({ filter }) {
      try {
        const item = await config.loadItem(filter.id);
        if (!item) return undefined;
        return { id: config.idOf(item), data: item, cacheHint: cacheHint(null) };
      } catch (error) {
        return { error: toError(error, `${config.name} entry load failed`) };
      }
    },
  };
}
