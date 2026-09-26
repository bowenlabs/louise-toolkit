---
"louise-toolkit": minor
---

You can now hold HTML a model wrote to a stricter allowlist than HTML a person typed. A prompt injection in the content a model reads can steer what it writes, so its output shouldn't get the same trust as an editor's.

- **`sanitizeModelHtml(html)`** (`louise-toolkit/security`) keeps text structure only: paragraphs, line breaks, `h1` through `h4`, lists, block quotes, bold, italic, code, and links. It drops `img`, `iframe` and other embeds, every `style` and `class`, and every attribute except `href` on `<a>`. A link must be absolute `http(s)` or `mailto` and always gets `rel="noopener noreferrer nofollow"`. A link with any other `href` is unwrapped to its text. Wrappers that `sanitizeRichHtml` allows, such as `div` and `span`, are unwrapped rather than dropped, so a model's paragraph isn't lost to the `<div>` around it.
- **`MODEL_ALLOWED_TAGS`**, **`MODEL_ATTR_ALLOW`**, and **`MODEL_LINK_REL`** are exported beside `ALLOWED_TAGS` and `ATTR_ALLOW`. The model sets are a subset of the human ones, and a test fails the build if they ever widen past them.

**What to do:** nothing is required, and no toolkit path changes behavior. None of the toolkit's paths stores model-written HTML today: `rewriteText`, `suggestSeo`, and `generateAltText` return plain text, the editor inserts a rewrite as text, and the MCP write tools aren't built yet. If your own code stores HTML from a model through `sanitizeRichHtml`, switch that call to `sanitizeModelHtml`. That's a behavior change for new writes: images, styled spans, classes, relative links, and `#` links no longer survive. Content you already stored isn't rewritten, so re-run old model output through the new preset if you want it held to the same bar.
