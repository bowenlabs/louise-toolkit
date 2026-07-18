---
"louise-toolkit": minor
---

Bundle the brand font instead of fetching it from Google Fonts. Roboto Flex (the
`wght` axis, latin subset) is now base64-inlined into `theme/fonts.css` and baked
into the editor chrome bundle (`client/styles.ts` pulls it in with `?raw`, like
the Phosphor icons) — so Louise surfaces make **no third-party font request** and
work offline / under strict CSP.

The `@import url("https://fonts.googleapis.com/…")` in `theme/fonts.css` and the
runtime Google Fonts `<link>` + `preconnect`s in `injectStyles()` are gone.

**Migration:** if you set a strict `font-src` in your CSP, allow `data:` (the
inlined `@font-face` uses a `data:` URL). You no longer need `https://fonts.googleapis.com`
in `style-src` or `https://fonts.gstatic.com` in `font-src` for the brand type.
