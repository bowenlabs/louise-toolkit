// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — framework-generic `api/louise/*` route handlers (issue
// #10, Tier 2 slice 3). Each factory returns a `WorkerRoute` for
// `composeWorker` (louise-toolkit/worker); a site wires the ones it needs, passing
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
export { type EditorsRouteConfig, editorsRoute } from "./editors.js";
export { type FormRouteConfig, type FormRouteEnv, formRoute } from "./form.js";
export { type HealthRouteConfig, healthRoute } from "./health.js";
export { inquiriesRoute, type InquiriesRouteConfig } from "./inquiries.js";
export { type SubmissionsRouteConfig, submissionsRoute } from "./submissions.js";
export {
  // `applySettingsPatch` + its config are the route-free core of a settings write.
  // Public because a host that mounts its own endpoint — an Astro Action rather
  // than `settingsRoute`'s WorkerRoute — needs the same write path, and reaching
  // into `louise-toolkit/src/...` for it breaks on a published tarball (#327).
  applySettingsPatch,
  partitionSettingsPatch,
  type SettingsPartition,
  type SettingsPatchConfig,
  type SettingsRouteConfig,
  settingsRoute,
  validateSettingsImages,
  validateSettingsLinks,
} from "./settings.js";
export {
  type BlobSanitize,
  blobSettingsRoute,
  type BlobSettingsRouteConfig,
  mergeBlobPatch,
} from "./settings-blob.js";
export {
  // Same reasoning: the route-free field write, so a host can mount it on its own
  // transport. `applySaveDraft` was already public; these two were the gap.
  applyFieldSave,
  type ResolvedField,
  resolveFieldValue,
  type SaveCollectionConfig,
  type SaveRouteConfig,
  saveRoute,
} from "./save.js";
export {
  type OverviewContent,
  type OverviewData,
  type OverviewHealth,
  type OverviewInbox,
  type OverviewRouteConfig,
  overviewRoute,
} from "./overview.js";
export { DEFAULT_PAGE_FIELDS, type PagesRouteConfig, pagesRoute, pickFields } from "./pages.js";
export { type SearchRouteConfig, type SearchVectorConfig, searchRoute } from "./search.js";
export { DEFAULT_SEO_FIX_BATCH, type SeoFixRouteConfig, seoFixRoute } from "./seo-fix.js";
export { type AiRouteConfig, aiRoute } from "./ai.js";
export {
  applySaveDraft,
  latestPendingDraft,
  type SaveDraftDeps,
  type SaveDraftResult,
  type VersionsRouteConfig,
  versionsRoute,
} from "./versions.js";
export {
  type BufferedDraft,
  clearDraftBuffer,
  DEFAULT_FLUSH_MS,
  DRAFT_BUFFER_TTL_SECONDS,
  type DraftBufferKV,
  draftBufferKey,
  readDraftBuffer,
  shouldFlushBuffer,
  writeDraftBuffer,
} from "./draft-buffer.js";
export { type MediaRouteConfig, type MediaRouteEnv, mediaRoute } from "./media.js";
export { type ListMediaRouteConfig, listMediaRoute } from "./media-list.js";
export { type SeedRouteConfig, seedRoute } from "./seed.js";
