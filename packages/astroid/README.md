# astroidjs

**Astroid** — an opinionated meta-framework over [Louise Toolkit](../louise) and
Astro for building editable, multi-editor sites on Cloudflare Workers.

> **Status: experimental / pre-release.** The API will change. Nothing is
> published yet — the package exists so its opinions can co-evolve with Louise in
> one workspace.

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

## CLI

The `astroid` command turns the config into the Louise wiring and keeps it in
sync. It loads your `astroid.config.ts` with Node's native TypeScript stripping,
so there is no separate config-compile step.

```
astroid generate   regenerate src/schema.ts, src/worker.ts, src/middleware.ts from the config
astroid doctor     validate the config, the wrangler bindings, and generated-file freshness
astroid dev        regenerate, then run `astro dev`
astroid build      regenerate, then run `astro build`
astroid deploy     provision + deploy (coming soon)
```

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
4. `<Section>` / `<Editable>` / `<Collection>` component primitives.
5. **CLI** — `astroid generate / doctor / dev / build` ✅; `create-astroid` scaffold
   ✅ (`npm create astroid`); `astroid deploy` provisioning next.

## License

[MIT](../../LICENSE) © BowenLabs
