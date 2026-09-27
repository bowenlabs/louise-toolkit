---
"louise-toolkit": minor
---

The editor's font is recorded once, as Roboto Flex, and the stale Hepta Slab token is gone (#601).

- **One home for the font tokens:** `louise-toolkit/theme/fonts.css` now defines `--louise-font-head` and `--louise-font-body` on `:root`, and `.louise-type` reads them. The chrome's injected CSS and `louise.css` no longer carry their own copies, so an override on `:root` reaches the chrome and `.louise-type` alike.
- **`--louise-font` is removed from `louise.css`.** It named Hepta Slab, a face nothing loads, so anything that read it rendered in Iowan Old Style or Georgia.
- **`packages/louise/preview/` is deleted.** It loaded Hepta Slab from Google Fonts and hand-copied both palettes, and the package never shipped it.

**Upgrading:** replace any `var(--louise-font)` with `var(--louise-font-head)`, and import `louise-toolkit/theme/fonts.css` wherever you read the font tokens outside the editor, since `louise.css` no longer defines `--louise-font-body`.
