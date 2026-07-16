---
"louise-toolkit": minor
---

Extend `louise-toolkit/ai` with text assists and expose them over HTTP via a new `aiRoute` (#75). The editor client can't call `env.AI` directly (server-only binding), so rewrite/SEO round-trip through the Worker.

- **`rewriteText(runner, text, { mode })`** — tighten / rephrase / simplify / fix a passage. Best-effort (null on absent binding, blank input, or model error), with model preamble/quotes stripped from the result.
- **`suggestSeo(runner, content)`** — an SEO title (≤60) + meta description (≤155) parsed from the model's JSON reply (tolerant of prose/code-fence wrapping), length-capped, missing fields → null.
- **`aiRoute({ resolveEditor, ai })`** — editor-guarded route:
  - `POST /api/louise/ai/rewrite` `{ text, mode? }` → `{ text }`
  - `POST /api/louise/ai/seo` `{ content }` → `{ title, description }`
  - Opt-in + degrade: `ai: (env) => env.AI`; when it returns `undefined` the route answers `503` so the client can hide the assist. Each call is a same-origin, session-guarded mutation (it spends AI budget).

This is the tested server foundation both remaining #75 consumers call — the ProseKit rewrite toolbar and the settings SEO panel — which land as follow-up client PRs.
