---
"louise-toolkit": minor
---

A site can give rewrites and SEO suggestions its voice, audience, and locale (#553). Only alt text took a site's prompt before; rewrite and SEO used a fixed one.

- `RewriteOptions` and `SeoOptions` take `instructions`, appended to the fixed prompt. `RewriteOptions` also takes `examples`, up to two before-and-after pairs sent as example turns.
- `aiRoute` takes `rewrite: { instructions, examples }` and `seo: { instructions }`. `seoFixRoute`'s existing `seoOptions` carries `instructions` to the backfill.

There's no default voice: voice and locale are site facts, so without these options the prompts are unchanged. Each site that uses the assists should pass its own.
