---
"astroidjs": minor
---

**`PwaConfig.offlineFallback` and `PwaConfig.emitDir`** — the two gaps blocking a
PWA scoped to something other than the site root.

**`offlineFallback`.** The generated service worker's navigate catch fell back to
`caches.match(SCOPE)` — the *dynamic app shell*. On an auth-gated app that is
precisely the wrong thing to precache: the response carries `Cache-Control:
no-store`, so either nothing is cached and the offline fallback is empty, or a
signed-in shell is stored and later served to whoever opens the app next. Point
this at a prerendered page instead; it is precached with the shell, since a
fallback fetched on demand is a fallback that isn't there when the network is.

**`emitDir`.** `sw.js` and the manifest were written to `public/` unconditionally.
A PWA served from its own subdomain that rewrites to a path prefix
(`studio.example.com/` → `/studio/`) has the browser fetch `/sw.js` at *its* origin
root, which rewrites to `/studio/sw.js` — so a worker at the public root is a 404
with nothing to explain it.

```ts
pwa: { scope: "/studio", emitDir: "studio", offlineFallback: "/offline" },
```

The `_headers` stanza moves with the files (its `no-cache` rule is what stops a
bad worker sticking around, and a stanza pointing at a path nothing serves sets
headers on nothing), while `_headers` itself stays at the public root, where
Cloudflare reads it. Its append-once marker moves too, so switching `emitDir` on
rewrites the stanza rather than appending a second one.

With `scope` equal to the serving path, no `Service-Worker-Allowed` header is
needed — a worker may always control its own directory and below.
