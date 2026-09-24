---
"louise-toolkit": patch
---

**New subpath: `louise-toolkit/forms/turnstile`.** It holds Turnstile's browser and server halves (`renderTurnstile`, `loadTurnstile`, `turnstileCsp`, `TURNSTILE_SCRIPT_SRC`, `verifyTurnstileToken`) and needs no other package.

`louise-toolkit/forms` also carries the form-table builder, which imports the optional `drizzle-orm` peer. Importing Turnstile from there made a sign-in page or a CSP builder install drizzle-orm, or fail with `Cannot find package 'drizzle-orm'`. `louise-toolkit/forms` still exports the same functions, so nothing has to change. Switch to the new subpath where you don't otherwise need drizzle-orm.

The export-map check now follows the built import graph of every entry that exists to avoid a dependency (`content/define`, `content/sections`, `forms/turnstile`), so a chunk that pulls the dependency back in fails the build.
