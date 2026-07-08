---
"louisecms": minor
---

`louisecms/client/drawer` now ships the editor drawer **shell**, not just the
data layer (#10 slice 2). `mountDrawer(config)` renders a registry-driven
SolidJS overlay with a two-group layout whose split is first-class in the config
type, so a site can't collapse it:

- **Top strip — fixed framework panels:** `PagesPanel`, `MediaPanel`,
  `SettingsPanel`. Settings is extensible in-panel via declarative
  `settingsExtension` field groups (persisted to the `site_settings.custom`
  JSON) plus a `settingsExtras` escape-hatch slot.
- **Bottom tabs — site-registered `CollectionTab`s:** a site's own collections
  plus Inquiries. The package ships a default `InquiriesPanel` a site registers
  and customizes via `renderRow`.

The framework panels talk to the `louisecms/editor` endpoints. Also exports the
shared field primitives (`Section`, `LinkListEditor`, `ImageField`,
`MediaUrlPicker`, `SettingsField`) and the declarative `SettingsFieldGroup` /
`SettingsFieldDef` types so sites build extension groups with the same editors.
The `./client/drawer` data layer (`createDrawerQueryClient`, `apiGet`/`apiSend`,
query keys) is unchanged and re-exported from the barrel.
