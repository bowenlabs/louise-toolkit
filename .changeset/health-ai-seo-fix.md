---
"louise-toolkit": minor
---

Add the one-click AI **SEO** fix to the site-health co-pilot (#106 Phase 2c) — generate an SEO title/description for published pages missing them, from the Health panel. Completes the "one-click fix where AI can" pair (alt + SEO).

- **`seoFixRoute`** (`core/editor/seo-fix.ts`) — `POST /api/louise/pages/generate-seo` (editor-only). Selects published pages with an SEO gap (or a single `{ id }`), feeds each page's HTML-stripped content to `suggestSeo`, and writes back — **only the missing field(s)**, never overwriting an existing title or description. Capped per call at `DEFAULT_SEO_FIX_BATCH` (8; `batch` overrides); **503** when no AI runner is wired; a page with empty content or no model output is skipped, not failed. Mount before `pagesRoute` (like `searchRoute`) so its `/:id` matcher doesn't claim `/generate-seo`.
- **`HealthPanel`** — the alt and SEO rows now share one `AiFixSection` + `createFixer`: each shows **"Fix with AI"** (busy → "Fixing…") beside a manual "Review in …" link, refreshes the affected counts on success, and hides the assist on a 503.
- Wired on louisetoolkit.com: `worker.ts` mounts `seoFixRoute({ table: pages, resolveEditor, ai: (env) => env.AI })`.

SEO generation itself is deploy-verified (Workers AI is server-only). Optional CWV/RUM remains the last, non-blocking thread of #106.
