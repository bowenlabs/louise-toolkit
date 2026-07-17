---
"louise-toolkit": minor
---

Add the site-health detail panel (#106 Phase 2) — the drill-in behind the Home dashboard's Health card, so the owner can see *what* is wrong, not just a count.

- **`HealthPanel`** (`client/settings/dashboard/health-panel.tsx`) — reads the full persisted `HealthSummary` from `/api/louise/health` and lists the broken links (URL · status · the page they're on, capped with an "…and N more"), plus alt/SEO gap counts each with a jump to the surface that fixes them (Media for image descriptions, Pages for SEO). Handles the not-yet-scanned and all-clear states. It's a **hidden framework panel**: reachable from the Health card's "Review" action, not a top-strip button.
- **`healthRoute`** (`core/editor/health.ts`) — `GET /api/louise/health` (editor-only), config-driven `read(env)`; returns `{ summary }` with `summary: null` (a 200, not a 404) until the first scan runs, so the panel shows a "not checked yet" state.
- The dashboard **Health card's "Review"** now opens the health drill-in (`open({ panel: "health" })`); new `dashboard.healthEndpoint` config overrides the endpoint.

Wired on louisetoolkit.com: `worker.ts` mounts `healthRoute` reading the persisted summary (`readHealthSummary(env.RL)`). Exported `HealthPanel` from `louise-toolkit/client/settings`.

Still to come (Phase 2b): one-click AI fixes — generating alt text (`generateAltText`) and SEO meta (`suggestSeo`) in place — which need per-item detail in the summary + fix endpoints, and optional CWV/RUM.
