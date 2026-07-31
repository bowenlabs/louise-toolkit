---
"astroidjs": minor
---

**`TenancyConfig.unknown: "404"` — an unknown tenant host can now refuse instead
of falling through.**

`resolveTenant` returning `null` has always fallen through to the ordinary
site, and the scaffold told you to "refuse it in the middleware's guard" if
that was wrong for your project — but the middleware is generated, so there was
no site-owned place to put that refusal. The moment tenant hosts are commercial
surfaces, fallthrough is the wrong answer: a stranger who points a CNAME at
your zone gets your homepage under their name.

`unknown: "404"` emits a guard that refuses any syntactically-valid tenant host
whose lookup resolved to nothing. It composes with the portal guard into ONE
guard function (a second `guard:` key would silently shadow the first), runs
after `extend` (so it reads the `locals.tenant` the lookup wrote) and before
`rewrite`, per the #307 ordering guarantees. Reserved labels, app labels, the
apex, and off-pattern hosts are never affected — `tenantLabel` returns `null`
for all of them, so they are not tenant candidates.

The default stays `"fallthrough"`, unchanged. The split of responsibilities is
deliberate: `resolveTenant` decides *what exists*; the config decides what
not-existing *means* — visible in `astroid.config.ts` rather than buried in a
seam.
