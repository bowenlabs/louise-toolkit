---
"louise-toolkit": minor
"astroidjs": patch
---

Add a drizzle-free `louise-toolkit/content/sections` entry, and split the content validator so importing the structured-sections validators no longer drags in `drizzle-orm`.

`content/validation.ts` imported `drizzle-orm` (`and`/`eq`/`ne`) as real values for its uniqueness/reference query path. Because ESM is eager, anything importing it pulled drizzle in — and `content/sections.ts` (`validateSections`/`assertValidSections`/`sanitizeSectionsRichText`) imported `validateValue` from it, so the section validators couldn't be used without the optional `drizzle-orm` peer installed. That's the same class of bug `content/define` was carved out to fix.

The pure Rule engine (the `Rule` builder, `validateValue`, and the synchronous check evaluation) now lives in a new drizzle-free `content/rule.ts`; `validation.ts` keeps only the document-level `validateDocument`/`assertValid` and the two DB-backed checks, injecting them into the shared evaluator, and re-exports the pure API so `louise-toolkit/content` is unchanged. `content/sections.ts` imports the pure engine directly and is exposed at the new `louise-toolkit/content/sections` subpath, so a consumer can validate a page's `sections` without installing drizzle.

With that entry in place, Astroid's `pages` collection (`astroidPagesCollection`) now imports `assertValidSections`/`sanitizeSectionsRichText` **statically** from `louise-toolkit/content/sections` in its `beforeChange` hook, replacing the dynamic `import("louise-toolkit/content")` it needed to keep create-astroid's schema-generation graph off the optional `drizzle-orm` peer — the seam that entry was built to remove.
