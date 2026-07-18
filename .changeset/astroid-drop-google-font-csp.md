---
"astroidjs": patch
---

The generated middleware's CSP `style-src` no longer allows
`https://fonts.googleapis.com` — Louise's brand font is bundled + base64-inlined,
so scaffolds make no Google Fonts request. A strict `font-src` should permit
`data:` for the inlined `@font-face`.
