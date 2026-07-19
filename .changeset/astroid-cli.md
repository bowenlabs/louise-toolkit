---
"astroidjs": minor
---

Add the `astroid` CLI and the project-generation engine behind it (#104). New
commands: `astroid generate` (regenerate the `src/schema.ts` / `src/worker.ts` /
`src/middleware.ts` trio from `astroid.config.ts`), `astroid doctor` (validate the
config, check the wrangler bindings + generated-file freshness, flag unresolved
binding placeholders), and thin `astroid dev` / `astroid build` wrappers that
regenerate before handing off to Astro. `astroid deploy` prints a "coming soon"
notice — live provisioning is a later slice.

The engine is exported for reuse by the forthcoming `create-astroid` scaffold:
`generateAstroidProject(config)` returns the regenerated, "do not hand-edit" trio,
and `generateAstroidWrangler(config)` emits a floor `wrangler.jsonc` (D1/R2/KV/
Images bindings, custom-domain routes from `hosts`, placeholder ids). The two are
deliberately separate — `generate` never rewrites the scaffold-once wrangler, so
provisioned ids are safe. astroidjs now builds to `dist/` (tsgo) and ships an
`astroid` bin, so the CLI loads a project's TypeScript config via Node's native
type stripping.
