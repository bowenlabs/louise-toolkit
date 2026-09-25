---
"louise-toolkit": patch
---

`settingsRoute` takes two optional hooks, `sanitize` and `read`, so a site can clamp and normalize what editors save.

**What's new.** `sanitize` maps a settings key to a function that returns the value to store. It runs on every patch before the link-scheme and media-URL checks, so a sanitizer can't let an unsafe `href` or an external image through. `read` transforms the merged settings on GET, for example to fill keys an older row lacks from the site's defaults. `applySettingsPatch` accepts `sanitize` too, so a host that mounts its own settings endpoint gets the same write path. `blobSettingsRoute` already offered both; now the structured route does as well.

The two hooks are also exported on their own as `SettingsRouteHooks`, with `SettingsSanitize` for one sanitizer and the pure `sanitizeSettingsPatch` for testing one.

**What you have to do.** Nothing. A route without the hooks behaves exactly as before. The allowlist still decides what's written: a sanitizer for a key outside `columns` and `customKeys` never runs on anything that gets stored.
