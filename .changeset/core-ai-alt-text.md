---
"louise-toolkit": minor
---

Add `louise-toolkit/ai` — optional Workers AI editorial assists (#75), starting with AI alt text on image upload. A new, catalog-agnostic `AiRunner` contract (`run(model, inputs)` — `env.AI` satisfies it directly, no cast) plus best-effort helpers that **degrade gracefully**: with no binding, or on any model error, they return `null` and never throw, so a save/upload/publish is never blocked by AI.

- `runAi(runner, model, inputs)` — run a model best-effort (null when absent or on error).
- `generateAltText(runner, imageBytes, opts)` — concise alt text for an image, tidied (whitespace-collapsed, "an image of…" lead-ins stripped, sentence-cased, length-capped).

The media route gains an opt-in `altText` accessor that fills each upload's `alt` from the image — off by default (no upload latency or cost unless wired), mirroring the `deferReindex`/`bufferKv` pattern:

```ts
mediaRoute({
  table: media,
  resolveEditor,
  altText: (env) => env.AI, // opt in; needs the `ai` binding in wrangler.jsonc
});
```

The model id is passed as a string (not pinned to a workers-types model catalog), leaving room to route `run` through AI Gateway later (#87). This is the foundation for the rest of #75 (rewrite toolbar, SEO suggestions) and the AI cluster (#86/#106/#107).
