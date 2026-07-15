# astroidjs

**Astroid** — an opinionated meta-framework over [Louise Toolkit](../louise) and
Astro for building editable, multi-brand sites on Cloudflare Workers.

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

The whole shape of a project — which brands it serves, each brand's theme +
editable home, its commerce backend and optional modules — collapses into one
typed config. The vocabulary is drawn from the real sites Astroid targets: a
storefront (coracle.coffee), a wholesale front (ghostfire.coffee), and an artist
portfolio (themidwestartist.com), over one stack.

```ts
import { defineAstroid } from "astroidjs";

export default defineAstroid({
  brands: [
    {
      key: "coracle",
      archetype: "storefront",
      theme: { name: "Coracle Coffee", colors: { brand: "#1f6f78" } },
      sections: ["hero", "marquee", "featured", "productGrid", "visit"],
    },
    {
      key: "ghostfire",
      archetype: "wholesale",
      theme: { name: "Ghostfire Coffee", colors: { brand: "#c0392b" } },
      sections: ["hero", "featureGrid", "story"],
      modules: ["orderTracking"],
    },
    {
      key: "megbowen",
      archetype: "portfolio",
      theme: { name: "Meg Bowen Studio", colors: { brand: "#2b2b2b" } },
      portal: { enabled: true, gated: true },
    },
  ],
  commerce: { provider: "square", sharedCatalog: true },
  deploy: { platform: "cloudflare" },
});
```

## Roadmap

1. **Config surface** (`defineAstroid`) — _this slice._
2. Config → generated Drizzle schema + migrations.
3. Config → generated `worker.ts` + middleware (no hand-wired route ordering).
4. `<Section>` / `<Editable>` / `<Collection>` component primitives.
5. `create-astroid` scaffold + `astroid dev / build / deploy`.

## License

[MIT](../../LICENSE) © BowenLabs
