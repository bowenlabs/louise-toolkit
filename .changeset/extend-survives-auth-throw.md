---
"louise-toolkit": patch
---

**`extend` now survives an auth failure — and vice versa.**

`createLouiseMiddleware` wrapped editor-session resolution and the `extend`
hook in one `try/catch`. When `resolveEditor` threw — which it does on every
request while `SESSION_SECRET` is still the `DUMMY_REPLACE_ME` sentinel, i.e.
the dormant-until-provisioned state every module is supposed to survive —
`extend` was silently skipped along with it. Everything `extend` feeds died
too: `locals.tenant` was never written, so astroid's host dispatch quietly
served the ordinary site on every tenant subdomain, with no error anywhere.

The two now get separate catches. An unprovisioned editor secret degrades to
"signed out"; a broken tenant lookup degrades to "no tenant"; neither cancels
the other. Found live on themidwestartist.com's Wave 4 storefront work, where
the symptom — merchant hosts rendering the marketing homepage — pointed at
everything except the auth secret.
