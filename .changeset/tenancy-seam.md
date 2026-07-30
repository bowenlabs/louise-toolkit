---
"louise-toolkit": minor
"astroidjs": minor
---

**Wildcard host dispatch: a `rewrite` hook, and the `tenancy` config that uses it.**

Serving `*.example.com` from one Worker — scoped views of one brand's data, a
per-merchant storefront — had no seam. `AstroidConfig.hosts` is consumed only by
the wrangler generator, which emits `{ pattern, custom_domain: true }`; a wildcard
needs `{ pattern, zone_name }` and explicitly **not** `custom_domain`, so `hosts`
cannot express it. And there was nowhere to put the dispatch: `src/middleware.ts`
is generated, Astro permits exactly one middleware file, `extend` returns `void`
and `guard` returns only a `Response` — so **neither existing hook could rewrite**.

**`createLouiseMiddleware` gains `rewrite?: (context) => string | undefined`**
(louise-toolkit), called before `next()` and **after `guard`** — so route policy
stays written against the URL a visitor actually asked for rather than an internal
one. It sits outside the `extend` try/catch for the same reason `guard` does: a
rewrite that throws must not degrade into rendering the *unrewritten* path, which
under host dispatch is another tenant's page.

**`AstroidConfig.tenancy`** (astroidjs) wires it up: the wrangler generator emits
the wildcard zone route alongside the apex custom domain, the generated middleware
resolves a label and rewrites, and a scaffold-once `src/tenancy.ts` holds the
lookup.

```ts
tenancy: { hostPattern: "*.example.com", reserved: ["www", "studio"] },
hosts: ["example.com"],
```

**The site keeps every decision.** What a label maps to, whether the lookup is
cached, and what an unknown host means all live in `src/tenancy.ts` — with the
last stated as a decision rather than defaulted quietly, since falling through to
the ordinary site means a stranger's CNAME renders your homepage.

**Two config-time refusals.** A non-wildcard `hostPattern` (that is a custom
domain — put it in `hosts`), and an apex missing from `hosts`: a wildcard route
does not match its own apex, so `example.com` would 404 the moment tenancy was
switched on, with a symptom that reads as unrelated to the feature that caused it.

`tenantLabel(host, tenancy)` is exported and pure so a site can unit-test its own
reserved list. It returns `null` for the apex, off-pattern hosts, reserved labels,
and dotted labels — Cloudflare's wildcard matches one level, and a dotted slug
would put a `/` in the rewrite path.

This does not weaken the one-brand-per-project rule; that note in `config.ts` is
clarified rather than contradicted.
