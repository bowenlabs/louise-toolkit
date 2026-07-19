---
"astroidjs": minor
---

Add the `<Editable>` component primitive (ADR 0003, checklist item 1) —
`astroidjs/components/Editable.astro`. It owns the `data-louise-*` inline-edit
marker contract so sites stop hand-stamping it: a typed, polymorphic prop surface
(`as` + typed `...rest`, `collection`/`key`/`field`/`type`) that emits the markers
the Louise client turns into in-place editors — but only in edit mode, so public
HTML stays clean. astroidjs now ships `.astro` source components (exported via
`astroidjs/components/*`) alongside its built TS generators.

Also: `astroidPagesCollection` now sanitizes the `body` field on every write. The
body is edited in place as rich HTML and staged as a draft, so it's sanitized
(scripts dropped, off-origin image hotlinks removed) before storage — closing the
stored-HTML gap the inline editor would otherwise open.
