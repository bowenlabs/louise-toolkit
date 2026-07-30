---
"louise-toolkit": minor
"astroidjs": patch
---

**One flag turns AI generation off, separately from the binding.**

AI was gated by binding presence and nothing else: if `env.AI` was provisioned the
assists were live, and the only way to turn them off was to unprovision it. That
is a real switch, and for "this site never uses AI" arguably the right one. It
stops working the moment you want to keep the binding and still disable
*generation* — an embeddings-backed search that must keep running while alt-text
and SEO suggestions go quiet, a client whose contract forbids generated copy, or a
temporary kill after a bad model swap.

`LOUISE_AI=off` in `vars`, plus `aiRunner(env)` in place of `(env) => env.AI`:

```ts
aiRoute({ resolveEditor, ai: aiRunner })
```

**One exported definition, not four.** Every consumer reached the runner through
its own accessor, so a flag written at each call site would be four chances to
drift — and a kill switch you don't trust is worse than none. Astroid's generated
worker and `workers/site` both wire it now.

**Two decisions the issue left open, resolved:**

**Scope — generation only.** Embeddings power site search and generate nothing, so
gating them would mean disabling "AI content" silently breaks search: a
consequence nobody predicts from the flag's name, surfacing as "search returns
nothing" long after the flag was flipped. `vector.ai` deliberately stays on the
binding. Unprovisioning `AI` still turns off everything.

**"Off by choice" vs "not configured" — distinguished now, not later.** Both
answer `503` and both hide the control, which is correct for an unprovisioned
binding but wrong for a deliberate opt-out, where the honest answer is "AI assists
are turned off for this site". The 503 body carries `reason: "disabled" |
"unconfigured"`. Shipped together because a kill switch whose state is invisible
is exactly what the flag is trying to fix.

`LOUISE_AI` **cannot turn AI on** — with no binding there is nothing to enable, so
the var stays a ceiling rather than a second source of truth. `off`, `false`, `0`,
`no`, and `disabled` all mean off, case-insensitively; every other value means on,
so no typo can accidentally disable AI, only spell "off" more than one way.
