---
"astroidjs": minor
"create-astroid": minor
---

Wire Workers AI, so the editor assists that already ship actually work.

`aiRoute` (rewrite / expand / shorten a selection, suggest SEO), `seoFixRoute` (one-click SEO backfill for published pages missing a title or description), and `mediaRoute`'s `altText` all existed in the toolkit and all shipped as buttons in the editor drawer. None of them was reachable: the generated `wrangler.jsonc` declared no `ai` binding and the route plan mounted neither route, so every one of those buttons answered 404 or 503 and the client dutifully hid it. They were invisible, not broken, which is why nobody noticed.

The binding is declared unconditionally rather than behind a module flag. `louise-toolkit/ai` degrades by contract — a missing binding or a model error yields null, never a throw — and each route answers 503 when the runner is undefined, so mounting them on a project that never touches AI costs nothing. Every call is editor-gated, so a visitor can't spend your AI budget.

**`seoFixRoute` is mounted before `pagesRoute`, and that ordering is load-bearing.** It lives at `/api/louise/pages/generate-seo`, and `pagesRoute` claims *every* path under `/api/louise/pages/` as an item id — so mounted after, it would be unreachable and the request would 400 on the non-integer id `generate-seo`. That is the same collision the existing `versions`/`search` ordering exists to prevent, and it fails silently until someone clicks the button, so there's now a test asserting the general rule: any route under `/api/louise/pages/<word>` precedes `pagesRoute`.

The alt-text model (`@cf/llava-hf/llava-1.5-7b-hf`) was checked against Cloudflare's current catalog before wiring — it is live and was not in the May 2026 deprecation batch. A retired Workers AI model surfaces as a generic 502 with nothing in `wrangler tail`, so this is worth re-checking whenever the default moves.
