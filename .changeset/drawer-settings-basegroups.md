---
"louisecms": minor
---

`mountDrawer` / `DrawerConfig` now thread a `settingsBaseGroups` option to the
framework `SettingsPanel`. 0.4.0 added `baseGroups` to `SettingsPanel` but the
drawer shell only forwarded `settingsExtension` / `settingsExtras`, so a site
whose settings don't map to `siteSettingsColumns` (and keeps its own storage)
still couldn't hide the empty framework base fields. Pass `settingsBaseGroups: []`
(or a curated subset) so the Settings panel renders only the fields a site uses,
with its own config in `settingsExtension`.
