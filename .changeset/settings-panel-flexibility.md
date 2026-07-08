---
"louisecms": minor
---

Make the drawer `SettingsPanel` flexible enough for sites whose settings diverge
from the framework `siteSettingsColumns` (so a site isn't forced to show empty
base fields or move everything into `settingsExtras`):

- **`baseGroups` prop** — override which framework base groups render. Omit for
  all of the defaults (unchanged behavior); pass a subset (or reordered/edited
  copy) so only the framework fields a site actually uses appear.
- **`SETTINGS_BASE_GROUPS` export** — the default framework groups, so a site can
  cherry-pick from them when composing its own `baseGroups`.
- **`SettingsFieldDef.render`** — a custom field-UI escape hatch (a label/value
  row list, a microcopy grid, a per-page SEO editor, …) that persists to its
  `key` through the same load/save flow as a typed field. Overrides `type`;
  called once with the loaded value, so its internal state survives keystrokes.

Backward compatible: omitting `baseGroups` and `render` keeps the previous fixed
base groups + declarative extension behavior.
