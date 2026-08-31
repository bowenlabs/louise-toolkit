---
"louise-toolkit": minor
---

worker/email: the cacheability signal and the dev flag come from the host

Two more places where the "framework-agnostic" library knew about one specific
framework (#327 Phase 1).

**`withEdgeCache` takes a `signalHeader`.** Which response header a route uses to
say "cache me" is the host's convention, not this layer's. The default is
unchanged — `cloudflare-cdn-cache-control`, what a Cloudflare-targeting SSR
adapter emits — so no site needs to do anything. What changed is that the header
is now configurable and the surrounding prose no longer claims it comes from
`Astro.cache.set(...)`. Worth noting the header itself was never Astro's; it is
Cloudflare's, and only the explanation was framework-bound.

**`sendEmail` takes a `dev` flag.** It used to read `import.meta.env.DEV` first —
a value a bundler defines at build time, which made a library claiming
independence depend on being built by one, and which is absent on a plain Worker
anyway. The host knows the answer.

The important part is that this is **not** a behaviour regression for the path
that mattered. `getLouiseAuth` already computes `isDev` from the request's own
hostname, and now passes it: with no EMAIL binding on localhost the magic link is
still printed to the console, which is the only way to sign in locally. That
signal is strictly better than the old one, because it reflects *this request*
rather than how the bundle was built.

For a direct `sendEmail` caller the fallback is now `NODE_ENV` alone, which reads
absent-as-production. Forgetting `dev` is therefore safe but pessimistic: an
unconfigured send throws instead of simulating, and a sign-in link is withheld
from the log. Pass `dev` if you want the dev behaviour.

Astroid keeps its own `import.meta.env` read, which is correct — it *is* the
Vite/Astro layer, and the dependency only runs astroid → louise.
