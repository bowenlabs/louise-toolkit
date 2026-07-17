// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/settings` — the Louise editor Settings: a registry-driven
// SolidJS shell with a fixed top strip of framework panels (Pages/Media/
// Settings) and a bottom group of site-registered collection tabs. Sites call
// `mountSettings(config)` in edit mode and register their own collections;
// everything shares one TanStack Query cache (the data layer below).

// Data layer — the shared QueryClient, query keys, and typed fetch helpers.
export {
  apiGet,
  apiSend,
  createSettingsQueryClient,
  louiseQueryKey,
  louiseQueryKeys,
} from "./query.js";

// Shell + registry API.
export {
  type CollectionTab,
  Settings,
  type SettingsConfig,
  mountSettings,
  OPEN_SETTINGS_EVENT,
} from "./shell.jsx";

// Drawer action footer — the active panel/editor pushes its save/cancel/publish
// actions here; site-registered tab panels use `usePanelActions` too.
export {
  type ActionKind,
  DrawerFooter,
  type PanelAction,
  PanelActionsProvider,
  type PanelActionsApi,
  type SaveStatus,
  usePanelActions,
} from "./panel-actions.jsx";

// Owner Home dashboard (#108) — the card registry + built-ins, so a site can
// register its own cards (`dashboard.cards`) with the same shape.
export { Card } from "./dashboard/Card.jsx";
export { BUILTIN_CARDS } from "./dashboard/cards.jsx";
export { HomePanel } from "./dashboard/home-panel.jsx";
export type {
  CardStatus,
  DashboardApi,
  DashboardCard,
  DashboardPanelTarget,
  OverviewData,
} from "./dashboard/types.js";

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
export { type EditorRow, UsersPanel, type UsersPanelProps } from "./users-panel.jsx";

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
