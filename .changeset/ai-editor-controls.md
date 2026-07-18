---
"louise-toolkit": minor
---

Wire the Workers AI editorial assists (#75) into the editor UI (#166) — the interactive half of the inline assists, completing #75.

- **Rich-text toolbar "rewrite" control** (`client/RichText.tsx`): a sparkle menu (Tighten / Rephrase / Simplify / Fix) that POSTs the current selection to `/api/louise/ai/rewrite` and swaps in the result. Enabled only over a real selection; a model hiccup (502) leaves the original text untouched.
- **SEO "Suggest" button in the Pages panel** (`client/settings/pages-panel.tsx`): POSTs the page's title + body text to `/api/louise/ai/seo` and pre-fills the SEO title/description for review — set as dirty edits, never auto-committed, so the owner still presses Save.
- New `sparkle` icon (the four-point AI affordance).

Both controls are opt-in and degrade gracefully: the moment a call returns 503 (the `AI` binding isn't provisioned) the control retires itself, consistent with the `core/ai` ethos. The server helpers + `aiRoute` already shipped (#150/#151/#154); a host mounts `aiRoute` to enable them.
