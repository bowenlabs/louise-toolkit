---
"louise-toolkit": patch
---

Make `suggestSeo` robust to the model — the SEO assist was still 502ing after the model bump because it parsed the model's freeform text as JSON, and the new model returns structured output differently. It now requests Workers AI **JSON mode** (`response_format` json_schema) so `{title, description}` comes back as guaranteed-valid JSON, and reads it via a new `extractJsonObject` that tolerates a parsed object under `response` (JSON mode), a JSON string, or salvaged freeform text. Also: `runAi` now `console.error`s a swallowed model failure instead of dropping it silently — the bare catch hid two real prod failures (a retired model, an unmet schema), so a dead/misbehaving model is now visible in `wrangler tail` without changing the best-effort null-on-failure contract.
