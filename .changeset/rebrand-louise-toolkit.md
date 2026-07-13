---
"louise": major
---

Rebrand: **Louise CMS → Louise Toolkit**. The project is now positioned as a
V8-native toolkit for building editable sites on Cloudflare Workers, not just a CMS.

Breaking changes:

- **Package renamed** `louisecms` → `louise`. Update every import specifier
  (`louisecms/client` → `louise/client`, etc.) and your dependency entry.
- **Editing terminology standardized.** The back-office surface formerly called the
  "studio" / "drawer" is now **Louise Settings**; the authoring experience is
  **Louise Editor**.
  - Subpath `louise/client/drawer` → `louise/client/settings`.
  - `mountDrawer` → `mountSettings`, `Drawer` → `Settings`, `DrawerConfig` →
    `SettingsConfig`, `OPEN_DRAWER_EVENT` → `OPEN_SETTINGS_EVENT`
    (`"louise:open-drawer"` → `"louise:open-settings"`), `onOpenDrawer` →
    `onOpenSettings`, `createDrawerQueryClient` → `createSettingsQueryClient`.
  - `buildStudioStructure` → `buildEditorStructure`, `StudioStructureItem` →
    `EditorStructureItem`, `StudioStructureGroup` → `EditorStructureGroup`,
    `BuildStudioStructureOptions` → `BuildEditorStructureOptions`,
    `DEFAULT_STUDIO_GROUP` → `DEFAULT_EDITOR_GROUP`.

Internal `louise-drawer-*` CSS class names and the `#louise-drawer-root` id are
unchanged (implementation detail). `LouiseCmsError` and the `louise/cms` subpath are
unchanged — "cms" there names the content subsystem, not the product.
