// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { ContentConfig, CollectionConfig } from "./types.js";

export interface CollectionMeta {
  slug: string;
  fields: CollectionConfig["fields"];
  /** Whether `LocalApi.search()` is usable for this collection — see `CollectionConfig.search`. */
  searchable: boolean;
}

// Serializable introspection contract the Louise Editor (or any other
// consumer) uses to render generic UI without importing CollectionConfig
// or ContentConfig directly. CollectionConfig is already plain, serializable
// data — this is a stable, narrow public surface over it, not a
// transformation.
export function getCollectionsMeta(config: ContentConfig): CollectionMeta[] {
  return config.collections.map((collection) => ({
    slug: collection.slug,
    fields: collection.fields,
    searchable: Boolean(collection.search?.fields.length),
  }));
}
