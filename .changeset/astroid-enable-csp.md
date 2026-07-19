---
"create-astroid": minor
"astroidjs": minor
---

Scaffolded sites now ship a real Content-Security-Policy. `astro.config.mjs`
enables Astro's `security.csp`, so every on-demand (SSR) page — all of ours —
gets a hash-based `content-security-policy` response header. The generated
`src/middleware.ts` (`createLouiseMiddleware`, `cspStyleSrc: "'self' 'unsafe-inline'"`)
then rewrites `style-src` to permit Louise's data-driven `style=""` carriers and
the editor's runtime-injected `<style>`, and auto-allows the inlined `data:` brand
font — leaving Astro's script hashes verbatim. Previously the CSP machinery
shipped dormant (the middleware only rewrote a CSP header, and nothing emitted one).

To keep that policy strict-by-default, the template's two inline scripts are now
CSP-hashable (Astro hashes processed scripts but **not** `is:inline` / `define:vars`,
whose per-request content can't be hashed):

- **`login.astro`** — the magic-link submit handler drops `is:inline`, so Astro
  processes and hashes it into `script-src` (rewritten to stay type-safe under
  `astro check`).
- **`LouiseEdit.astro`** — the editor boot no longer uses `define:vars`. The
  per-render `userName` / `versionedPageId` ride as `data-*` on a marker element
  that the now-static (hashable) boot script reads; edit-mode gating and the
  `astro:page-load` re-boot are preserved.

A site that loads **Square Web Payments** must allow its SDK host in `script-src`
— `security: { csp: { scriptDirective: { resources: ["'self'", "https://web.squarecdn.com"] } } }`
— documented in the scaffolded `astro.config.mjs` rather than allowed by default.
