// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/editor — framework-generic `api/louise/*` route handlers (issue
// #10, Tier 2 slice 3). Each factory returns a `WorkerRoute` for
// `composeWorker` (louisecms/worker); a site wires the ones it needs, passing
// its own Drizzle tables + a `resolveEditor` that bridges its auth, and keeps
// bespoke resource routes (products/artworks/…) per-site.

export {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  matchPath,
  type ResolveEditor,
  runEditorRoute,
  tableMeta,
} from "./shared.js";
export { inquiriesRoute, type InquiriesRouteConfig } from "./inquiries.js";
export {
  partitionSettingsPatch,
  type SettingsPartition,
  type SettingsRouteConfig,
  settingsRoute,
  validateSettingsImages,
} from "./settings.js";
export {
  type BlobSanitize,
  blobSettingsRoute,
  type BlobSettingsRouteConfig,
  mergeBlobPatch,
} from "./settings-blob.js";
export {
  type ResolvedField,
  resolveFieldValue,
  type SaveCollectionConfig,
  type SaveRouteConfig,
  saveRoute,
} from "./save.js";
export { DEFAULT_PAGE_FIELDS, type PagesRouteConfig, pagesRoute, pickFields } from "./pages.js";
export { type SearchRouteConfig, searchRoute } from "./search.js";
export { type VersionsRouteConfig, versionsRoute } from "./versions.js";
export { type MediaRouteConfig, type MediaRouteEnv, mediaRoute } from "./media.js";
export { type ListMediaRouteConfig, listMediaRoute } from "./media-list.js";
export { type SeedRouteConfig, seedRoute } from "./seed.js";
