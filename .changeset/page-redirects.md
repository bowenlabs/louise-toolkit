---
"louise-toolkit": minor
---

A renamed page keeps its old URL working (#574). A slug is a page's public URL, and renaming a page from the Pages panel is how it gets its address, so every inbound link, bookmark, and search result for the old one used to turn into a 404.

- `louise-toolkit/db` adds a `pageRedirects` table (`page_redirects`: `from_path`, `to_path`, `code`) and `resolvePageRedirect(db, table, path)`, which returns `{ location, status }` or `null`, following a chain of renames.
- `pagesRoute({ redirects: pageRedirects })` records `/old → /new` in the same batch as a slug change. A new page on an old path, or a rename onto one, clears the redirect away from it, so a redirect never shadows a page. Earlier redirects to the old path move to the new one, so a chain stays one hop.
- `versionsRoute({ redirects: pageRedirects })` records the rename when a publish changes the slug. It's written right after the publish; if that write fails, the publish stands and the failure is reported as `editor.redirects`.

What to know when you upgrade: it's opt-in. Add `pageRedirects` to the schema drizzle-kit reads and generate the migration, pass the table to both routes, and give the Astro middleware `redirectFor`.
