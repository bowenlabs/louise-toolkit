---
"@louise-toolkit/astro": minor
---

`seoHead(Astro, input)` prints a page's head tags from `louise-toolkit/seo`'s `pageHead`, with the origin and path taken from the request (#582). The origin is `input.origin`, then the `site` in `astro.config`, then the request's own origin, so set `site` to keep a preview host out of the canonical URL. Print the result inside `<head>` with `<Fragment set:html={…} />`. It needs the `louise-toolkit` release that adds `louise-toolkit/seo`.
