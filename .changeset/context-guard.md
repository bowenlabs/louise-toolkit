---
"louise-toolkit": patch
---

auth: `requireEditorFromContext` infers `mutation` from the method, and a new `safeNextPath` (#458)

Every site wrapped the editor guard in its own `lib/guard.ts` to adapt a framework
context, but the toolkit has shipped that bridge, `requireEditorFromContext`, since
July. It was never documented, so nobody used it. It's documented now: pass an Astro
`APIContext` (or anything shaped `{ request, locals: { editor } }`) straight through.

**Behaviour change:** when you leave out the second argument, `requireEditorFromContext`
now reads it from the request's method. A write (anything but `GET`/`HEAD`/`OPTIONS`)
gets the same-origin check, and a read doesn't. Previously every call defaulted to
checking, so a same-origin `fetch` GET, which usually sends no `Origin` header, could be
refused. The sites passed `false` by hand on 17 of 53 guarded calls to avoid that. If you
call this on a `GET` that has side effects, pass `true`. `requireEditor` itself is
unchanged.

**`safeNextPath(raw, fallback)`** reduces a post-sign-in `?next=` to a same-origin path or
returns `fallback`. Passing `next` to a redirect or `location.assign` unchecked is an open
redirect, and in a browser `?next=javascript:…` runs script. A regex over the raw string
isn't enough: browsers strip tabs and newlines and read `\` as `/`, so `/%09/evil.example`
becomes `//evil.example`. This resolves with the WHATWG URL parser, the same algorithm the
browser applies. **If you sanitize `next` yourself, switch to this.**
