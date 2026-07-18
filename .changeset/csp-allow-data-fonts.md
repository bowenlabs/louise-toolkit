---
"louise-toolkit": minor
---

`createLouiseMiddleware` now auto-allows `data:` fonts in the response CSP, so
the bundled brand font (an inlined `data:` `@font-face`) works under a strict
`font-src` with **no consumer change** — resolving the migration note from the
font-bundling change. It adds `data:` to an existing `font-src` (idempotent), or
derives one from `default-src` when none is set; it's a no-op without a CSP
header or when `data:` fonts are already allowed.

Also exported as `allowCspDataFonts(response)` from `louise-toolkit/security`
for sites that assemble their own middleware.
