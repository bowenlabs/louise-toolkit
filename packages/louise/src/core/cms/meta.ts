// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { CmsConfig, CollectionConfig } from "./types.js";

export interface CollectionMeta {
  slug: string;
  fields: CollectionConfig["fields"];
  /** Whether `LocalApi.search()` is usable for this collection — see `CollectionConfig.search`. */
  searchable: boolean;
}

// Serializable introspection contract a CMS admin (or any other
// consumer) uses to render generic UI without importing CollectionConfig
// or CmsConfig directly. CollectionConfig is already plain, serializable
// data — this is a stable, narrow public surface over it, not a
// transformation.
export function getCollectionsMeta(config: CmsConfig): CollectionMeta[] {
  return config.collections.map((collection) => ({
    slug: collection.slug,
    fields: collection.fields,
    searchable: Boolean(collection.search?.fields.length),
  }));
}
