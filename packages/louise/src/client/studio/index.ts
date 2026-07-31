// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/studio` — the Louise editor as a full-page admin app.
//
// Its own subpath rather than an export of `client/settings`, because the two
// are alternative presentations and a site loads exactly one: a marketing page
// that only ever opens the drawer should not pull the studio into its bundle,
// and a studio route should not pull the drawer's scrim and focus trap into its.
//
// The panels themselves are shared — see `client/settings/surface`.

export {
  mountStudio,
  Studio,
  type StudioConfig,
  type StudioMountOptions,
} from "../settings/studio.jsx";

// The pieces a studio host needs alongside the shell: its own tabs are
// `CollectionTab`s, and a bespoke panel reuses the same query layer.
export type { CollectionTab, FrameworkPanel, SurfaceConfig } from "../settings/surface.jsx";
export {
  apiGet,
  apiSend,
  createSettingsQueryClient,
  isApiStatus,
  LouiseApiError,
  louiseQueryKey,
  louiseQueryKeys,
} from "../settings/query.js";
