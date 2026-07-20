---
"louise-toolkit": patch
"astroidjs": patch
"create-astroid": patch
---

Enforce the section catalog on every `pages` write path, and answer a rejected write with a 422 instead of a 500.

Two write paths reach a page's `sections`, and only one of them validated. `versionsRoute` takes the collection `config` and runs its `beforeChange` hook — sanitize, then validate against the catalog. `pagesRoute` takes no config and runs no hook, so a direct `POST` / `PATCH /api/louise/pages/:id` — the path the on-canvas *structural* edits go through — persisted an unknown section `_type`, a `_settings` token outside its declared options, or unsanitized section rich text. `<Sections>` then skipped the bad `_type` at render time, so the section silently vanished with no error anywhere; the rich text (`faq.items[].answer` is `richText`, rendered with `set:html`) reached the public page with CSP as the only remaining defence. The generated worker even carried a comment claiming "every route below inherits" the validation — it didn't.

Astroid now derives the same sanitize + validate from the collection config and wires it into `pagesRoute`'s `sanitize` / `transform` / `validate` seams via a new `astroidPagesWriteHooks(config)`, spread into the generated route. Both write paths now enforce one contract, from one source — the collection's `beforeChange` hook is refactored to share the exact primitives (`sanitizeAstroidPageSections`, `assertAstroidPageSections`), so they cannot drift.

Separately, `versionsRoute` returned a raw **500** when the collection hook rejected a draft: `applySaveDraft` only translated a `LouiseValidationError` thrown by its own `validate` option into a 422, while the identical error thrown from inside `api.saveDraft`'s hook escaped uncaught. It leaked at two call sites — the `POST /:id/versions` save, and the buffer flush at the start of `POST /:id/publish` (a coalesced auto-save that the KV write-buffer answered 200 without validating is validated for the first time there). Both now catch a `LouiseValidationError` from the hook and return the same 422 with per-field violations; a non-validation throw (a real DB fault) still propagates as a 500, honestly. The invalid content was always kept off the live page — this is about giving the editor the violations instead of a 500.

Found by serving a scaffolded site on `wrangler dev` and exercising the routes over HTTP — none of it was visible to the unit suites, `astro check`, or `astroid doctor`. The four behaviours are asserted served in CI's scaffold live-smoke leg, and the `pagesRoute` wiring + the shared sanitize/validate are unit-tested in `astroidjs`.
