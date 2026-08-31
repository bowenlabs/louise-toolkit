---
"louise-toolkit": minor
---

editor: `applyFieldSave`, `applySettingsPatch` and `SettingsPatchConfig` are public

The route-free cores of a field write and a settings write. `applySaveDraft` was
already exported; these were the gap.

They matter to any host that mounts its own endpoint rather than using
`saveRoute` / `settingsRoute` — an Astro Action, say — and until now the only way
to reach them was `louise-toolkit/src/core/editor/...`, which resolves inside this
workspace and breaks the moment the package is consumed as a published tarball.

Found while extracting the Astro adapter (#327): three of the symbols it imports
were reachable from `src/` and from nowhere a consumer could see.

Also adds `scripts/ci/checks/export-map.mjs`, run in CI after the build. It
asserts every subpath in `exports` was actually emitted, and that the symbols a
first-party consumer needs are reachable from a public entry point. **The test
suite is structurally blind to this class of bug**, because vitest aliases
`louise-toolkit/*` to source — the only thing currently exercising the real export
map is astroid typechecking against the built library, and that gate leaves with
astroid when it moves to its own repo.
