---
"astroidjs": minor
"create-astroid": minor
---

Bake the two stack-wide security concerns every consuming site was re-deriving by hand into Astroid (#253).

**Rate-limit rules as data.** The limiter mechanism was already in `louise-toolkit/security` and deliberately unopinionated — which routes, which budgets, is policy. But the policy turned out not to vary: all three sites independently wrote the same rule set, same surfaces, same 10-minute windows, budgets within a factor of one of each other, differing only where a site had a surface the others didn't. So `astroidRateRules(config)` now derives the whole set — the editor magic-link always (the email-bombing target, tightest budget), the portal's credential surfaces when `portal.enabled`, checkout when `commerce` is configured. The generated middleware *calls* it rather than embedding literals, so a `match` predicate survives and enabling a portal needs no regeneration. `security.rateRules` in the config are matched first, which makes them an override seam and not just an append. The session-gated editor API stays out on purpose: a limiter that can lock the owner out of their own studio is worse than the abuse it stops.

**CSP composition**, via a new `astroidjs/astro` build-time subpath (kept off the main entry — it reaches for `node:crypto` and `solid-js/web`, neither of which belongs in the Worker bundle). `astroidSecurity(config)` supplies `astro.config.mjs`'s `security` block, and the split it encodes is the non-obvious part:

- **Astro owns `script-src`.** It hashes every script it processes, so the policy carries no `'unsafe-inline'`. What it does *not* hash is Solid's hydration bootstrap, which `@astrojs/solid-js` injects on every page with an island — without that hash the bootstrap is blocked and islands silently fail to hydrate. Astroid computes it from `generateHydrationScript()`, the same call the renderer makes, so it follows solid-js upgrades instead of going stale as a copy-pasted literal.
- **The middleware owns `style-src`.** Louise's data-driven `style=""` carriers need `'unsafe-inline'`, and per spec a single hash in `style-src` *voids* `'unsafe-inline'` — the two cannot coexist in one directive, so it's rewritten per response instead of declared at build time.

Enabled modules contribute origins (a commerce provider's SDK/iframe/tokenization hosts, the Turnstile frame), and `security.cspOrigins` adds whatever Astroid can't see. `ASTROID_VITE_BUILD` carries `assetsInlineLimit: 0` — an inlined asset is inline, therefore unhashed, therefore blocked.

Also fixes a real bug in the generated `src/worker.ts`: it imported `./astroid.config.js`, but the config lives at the project root, so the specifier had to be `../astroid.config.js`. Verified end to end by scaffolding a project and building it — the composed policy, including the Solid hash, lands in the built output.
