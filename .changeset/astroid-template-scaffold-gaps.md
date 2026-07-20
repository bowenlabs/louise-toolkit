---
"create-astroid": patch
---

Fix three scaffold gaps found by building and serving a fresh site: the section colorway/alignment tokens never rendered, the contact links were dead, and the SESSION_SECRET guidance was wrong for a local `wrangler dev` preview.

- **The `_settings` token contract was a silent no-op.** Astroid's section components ship as source inside `node_modules`, and Tailwind v4 doesn't scan `node_modules` — so `bg-primary`, `text-primary-content`, `items-center`, and every other colorway/alignment utility was absent from the built CSS. A section set to `colorway: "brand"` rendered on the default background; only `btn-primary` looked right, because daisyUI ships that as component CSS. `src/styles/site.css` now `@source`s the astroidjs components so those utilities are generated.
- **A dead `/contact` link out of the box.** The `contact` section (and the default hero/cta) link to `/contact`, but no such page was scaffolded. The template now ships `src/pages/contact.astro` — a progressively-enhanced form that posts to the generated `formRoute` (honeypot + min-time + rate limit + validation), with submissions landing in the editor's Inquiries tab.
- **`.env.example` said "empty SESSION_SECRET is fine on localhost"** — true under `pnpm dev` (astro dev serves on localhost), but a local `wrangler dev` preview of the built worker routes the request through the `hosts` domain, so the dev fallback never fires and every editor route 500s. The comment and README now call out that case.

Also documents two behaviours that surprised the first run: a raw-SQL-seeded page isn't in the full-text index until a publish or `POST /api/louise/pages/reindex`, and `seo_title` is run through the config's title template (so set the page part only, not `"Page | Brand"`).
