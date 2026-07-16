---
"louise-toolkit": minor
---

Add `louiseSettingsAction` — the editor `settings` mutation (#72) as an Astro Action, mirroring `louiseSaveAction`: a site drops `defineAction(louiseSettingsAction({ ...settingsConfig, ActionError }))` into `src/actions/index.ts` and calls `actions.louise.settings(patch)` with a typed, Zod-validated patch object.

The store path is shared with the raw `settingsRoute` via a new pure `applySettingsPatch` (media-strictness on image keys, base-column vs `custom` partition, singleton write) — so a patch is validated once per adapter and merged/written in exactly one place. The handler returns the `ignored` (non-allowlisted) keys, and the shared editor-Action plumbing (`EditorActionDeps`, injected `ActionError`, `locals.editor` auth guard, injected `getEnv` binding resolution) is now factored so further editor Actions follow the same shape. The raw `/api/louise/settings` route is unchanged.
