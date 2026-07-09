// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// `louisecms/client/drawer` — the Louise editor drawer: a registry-driven
// SolidJS shell with a fixed top strip of framework panels (Pages/Media/
// Settings) and a bottom group of site-registered collection tabs. Sites call
// `mountDrawer(config)` in edit mode and register their own collections;
// everything shares one TanStack Query cache (the data layer below).

// Data layer — the shared QueryClient, query keys, and typed fetch helpers.
export {
  apiGet,
  apiSend,
  createDrawerQueryClient,
  louiseQueryKey,
  louiseQueryKeys,
} from "./query.js";

// Shell + registry API.
export {
  type CollectionTab,
  Drawer,
  type DrawerConfig,
  mountDrawer,
  OPEN_DRAWER_EVENT,
} from "./shell.jsx";

// Framework panels (top strip) + the default Inquiries panel (a bottom tab).
export { MediaPanel, type MediaItem } from "./media-panel.jsx";
export {
  type BuiltInPageRef,
  type PageRow,
  type PageTemplate,
  PagesPanel,
} from "./pages-panel.jsx";
export { SETTINGS_BASE_GROUPS, SettingsPanel, type SettingsPanelProps } from "./settings-panel.jsx";
export { InquiriesPanel, type InquiriesPanelProps, type InquiryRow } from "./inquiries-panel.jsx";

// Shared form primitives + the declarative settings-field types, so sites can
// build extension groups and reuse the same field editors.
export {
  ImageField,
  LinkListEditor,
  type LinkRow,
  MediaUrlPicker,
  Section,
  SettingsField,
  type SettingsFieldDef,
  type SettingsFieldGroup,
  type SettingsFieldType,
} from "./fields.jsx";
