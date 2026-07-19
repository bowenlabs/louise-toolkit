# astroidjs

**Astroid** — an opinionated meta-framework over
[Louise Toolkit](https://github.com/bowenlabs/louise-toolkit/tree/main/packages/louise)
and Astro for building editable, multi-editor sites on Cloudflare Workers.

> **Status: pre-1.0, experimental.** The API will change between minor versions —
> pin an exact version if you depend on it. Astroid lives in the same workspace as
> Louise so its opinions co-evolve with the toolkit.

## What it is

Louise is the unopinionated toolkit — primitives you assemble by hand. Astroid is
the opinionated preset on top: a theme system, a section library, and a single
config that generates the Louise wiring (worker routes, middleware, schema,
theme) a site would otherwise hand-write per repo.

```
Astro        →  renderer / router / build
  Louise     →  unopinionated primitives + framework glue   (louise-toolkit)
    Astroid  →  opinions: theme, sections, config, scaffold  (astroidjs)
```

## Design rule

Dependencies flow one way: **`astroidjs` → `louise-toolkit`, never the reverse.**
Louise must never import Astroid, and nothing opinionated is allowed into Louise's
exports. This keeps the toolkit neutral while Astroid holds the opinions.

## Configure

The whole shape of a project — its brand + theme + editable home, its commerce
backend and optional modules — collapses into one typed config. **One brand per
project:** every site Astroid targets serves a single brand from a single deploy,
so the config describes one brand, not an array. What actually multiplexes is
*editors* (Louise's org plugin) and *audiences* (a gated portal beside the public
site) — both options on the one brand. The vocabulary is drawn from the real
sites Astroid targets: a storefront (coracle.coffee), a wholesale front
(ghostfire.coffee), an artist portfolio (themidwestartist.com), and a plain
marketing baseline (louise-web).

```ts
import { defineAstroid } from "astroidjs";

export default defineAstroid({
  key: "coracle",
  archetype: "storefront",
  theme: { name: "Coracle Coffee", colors: { brand: "#1f6f78" } },
  sections: ["hero", "marquee", "featured", "productGrid", "visit"],
  commerce: { provider: "square" },
  deploy: { platform: "cloudflare" },
});
```

A portfolio with a gated client area, for contrast:

```ts
export default defineAstroid({
  key: "megbowen",
  archetype: "portfolio",
  theme: { name: "Meg Bowen Studio", colors: { brand: "#2b2b2b" } },
  sections: ["hero", "gallery", "story", "contact"],
  portal: { enabled: true, gated: true },
  deploy: { platform: "cloudflare" },
});
```

## Security defaults

Two stack-wide concerns every site was re-deriving by hand, moved into the
framework.

**Rate-limit rules are data, derived from the config.** The generated middleware
calls `astroidRateRules(config)`: the editor magic-link always (the
email-bombing target, so the tightest budget in the set), the portal's
credential surfaces when `portal.enabled`, checkout when `commerce` is set. The
session-gated editor API stays out on purpose — a limiter that can lock the
owner out of their own studio is worse than the abuse it stops. Add or override
via `security.rateRules`, which is matched *before* the defaults, so you replace
one budget rather than the whole set.

**The CSP is composed, and it's split for a reason.** `astroidSecurity(config)`
gives `astro.config.mjs` its `security` block. Astro owns `script-src` — it
hashes every script it processes, so the policy needs no `'unsafe-inline'` — and
Astroid adds the one hash Astro can't produce itself: Solid's hydration
bootstrap, injected by `@astrojs/solid-js` on every page with an island.
Computing it from `generateHydrationScript()` means it tracks solid-js upgrades
instead of going stale as a copy-pasted literal. Meanwhile the generated
middleware rewrites *only* `style-src`, because Louise's data-driven `style=""`
carriers need `'unsafe-inline'` and a single hash in that directive would void
it per spec — the two cannot share one directive.

```js
// astro.config.mjs
import { ASTROID_VITE_BUILD, astroidSecurity } from "astroidjs/astro";
import astroidConfig from "./astroid.config.ts";

export default defineConfig({
  security: astroidSecurity(astroidConfig),
  vite: { build: { ...ASTROID_VITE_BUILD } },  // assetsInlineLimit: 0 — an
});                                            // inlined asset can't be hashed
```

Enabled modules contribute their own origins (a commerce provider's SDK hosts,
the captcha frame); `security.cspOrigins` adds anything Astroid can't see.

## Modules are dormant, not broken

Astroid's optional modules are opt-in at the *config* level, never at the
*account* level: switching commerce on must not require a Square account before
`pnpm dev` will boot. So a module whose secrets aren't provisioned is **dormant**
— it renders, it serves, it says out loud that it's simulated, and it never calls
upstream with a dummy credential. A fresh clone runs with zero external accounts.

`create-astroid` seeds every module secret with one loud sentinel,
`DUMMY_REPLACE_ME`, so a scaffold has a complete and valid binding set and no
real credentials. Reading a secret back that still holds the sentinel — or that
is absent, empty, or bound to an unprovisioned store — yields `null`:

```ts
import { resolveModuleSecrets, describeModuleStatus } from "astroidjs";

const secrets = await resolveModuleSecrets({
  SQUARE_ACCESS_TOKEN: env.SQUARE_ACCESS_TOKEN,
  SQUARE_WEBHOOK_SECRET: env.SQUARE_WEBHOOK_SECRET,
});

if (!secrets.configured) {
  console.warn(describeModuleStatus("commerce", secrets));
  // → commerce: dormant (simulated) — unprovisioned secret(s): SQUARE_WEBHOOK_SECRET
  return simulatedCheckout();
}
```

Partial provisioning counts as dormant. A half-configured integration fails
mid-checkout rather than at boot, which is precisely the failure this convention
exists to prevent. The scaffold ships one worked example: Turnstile captcha,
seeded with the sentinel secret plus Cloudflare's always-passing test site key,
enforcing only once **both** halves are real — so provisioning one of them can't
lock you out of your own sign-in.

## CLI

The `astroid` command turns the config into the Louise wiring and keeps it in
sync. It loads your `astroid.config.ts` with Node's native TypeScript stripping,
so there is no separate config-compile step.

```
astroid generate   regenerate src/schema.ts, src/worker.ts, src/middleware.ts from the config
astroid doctor     validate the config, the wrangler bindings, and generated-file freshness
astroid dev        regenerate, then run `astro dev`
astroid build      regenerate, then run `astro build`
astroid deploy     provision bindings + migrate + secrets + deploy (--dry-run / --yes)
```

`deploy` is plan-first: it prints exactly what it will run and refuses to
provision non-interactively without `--yes` (use `--dry-run` to preview).

The generated trio carries a "do not hand-edit" banner — `generate` (and
`dev`/`build`) rewrite them on every run, and `doctor` diffs them against your
config to catch drift. Your `wrangler.jsonc` is scaffolded once and then yours to
edit (real binding ids, secrets); `generate` never touches it.

New projects come from the `create-astroid` scaffold (`npm create astroid`), which
writes the floor — config, the generated trio, `wrangler.jsonc`, and the baseline
Astro app — in one step.

## Roadmap

1. ✅ **Config surface** (`defineAstroid`) — single brand per project.
2. ✅ Config → generated Drizzle schema.
3. ✅ Config → generated `worker.ts` + middleware (no hand-wired route ordering).
4. ✅ `<Section>` / `<Editable>` / `<Collection>` component primitives.
5. ✅ **CLI** — `astroid generate / doctor / dev / build / deploy`; `create-astroid`
   scaffold (`npm create astroid`).

## License

[MIT](https://github.com/bowenlabs/louise-toolkit/blob/main/LICENSE) © BowenLabs
