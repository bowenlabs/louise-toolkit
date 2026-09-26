---
"louise-toolkit": minor
---

The AI helpers now refuse an answer that the output token cap cut off, and the rewrite route refuses a selection too long to rewrite. Before this, a cut-off answer was treated as complete: alt text could be stored as half a sentence, and a rewrite could replace a whole passage with its first half.

- **`runAiText(runner, model, inputs, options?)`** (`louise-toolkit/ai`) runs a text-generating model like `runAi` does, and returns `{ output, text, truncated, finishReason, usage }`, or `null` on the same failures. An answer counts as `truncated` when the model reports a finish reason of `length` or `max_tokens`, or when it generated at least the `max_tokens` requested. Workers AI doesn't always report a finish reason, so the token count covers that case. A truncated answer is logged with the model ID. The new `AiTextResult` and `AiUsage` types describe the result.
- **`generateAltText`, `rewriteText`, and `suggestSeo` return `null` for a truncated answer**, the same as for a model error. An upload keeps its empty alt, the rewrite route answers `502` and the selection keeps its text, and the SEO fix skips the page.
- **`POST /api/louise/ai/rewrite` answers `413` for `text` longer than `REWRITE_MAX_CHARS` (1,536 characters)**, before it calls the model. The limit is sized from the rewrite's output cap, the new `REWRITE_MAX_TOKENS` (512, unchanged). The `413` body's `error` tells the editor to select a shorter passage.
- **The editor toolbar shows why a rewrite failed.** The sparkle menu stays open with a message: the route's own words for a `413`, and "Couldn't rewrite that. Your text is unchanged." for anything else. Before this, every failure closed the menu silently.

**What to do:** nothing is required. If you call `runAi` yourself for text generation, consider `runAiText` and check `truncated` before you store the text. If your own client calls the rewrite route, handle a `413` and show its `error`, and keep selections within `REWRITE_MAX_CHARS`. `runAi`'s return is unchanged.
