---
"louise-toolkit": minor
---

Add the one-click AI fix to the site-health co-pilot (#106 Phase 2b) — generate missing image alt text with Workers AI, straight from the Health panel.

- **`POST /api/louise/media/generate-alt`** — a new action on `mediaRoute` that backfills `alt` for images missing it: it selects the missing-alt rows (optionally a single `{ key }`), fetches each object from R2, runs `generateAltText`, and writes the result. Capped per call at `DEFAULT_ALT_FIX_BATCH` (12, override with `MediaRouteConfig.altFixBatch`) so a large library can't exhaust the Worker's subrequest/AI budget — the client re-runs until the count is zero. Editor-guarded mutation; **503** when no `altText` runner is wired (the client hides the assist). Reuses the same `altText` / `altTextOptions` config the upload path already uses, so a site that enabled AI alt on upload gets the backfill for free.
- **`HealthPanel`** — the "Image descriptions" row now offers **"Fix with AI"** (busy → "Fixing…") beside "Review in Media". On success it refreshes the health, overview, and media queries so counts update live; a 503 swaps the button for a "not set up — add them by hand" note.

Non-image assets, registry rows whose R2 object is gone, and empty model output are skipped (left for a manual fix), never failing the batch. SEO auto-fix (`suggestSeo` in place) and CWV/RUM remain future work.
