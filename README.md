<div align="center">

# Louise Toolkit

**A V8-native toolkit for building editable sites on Cloudflare Workers.**

No separate admin app. No JSON forms for prose. Log in, and the live site
becomes editable in place — text where the text is, structured sections through
your own components, and back-office work in Louise Settings.

[Documentation](https://louisetoolkit.com/docs) ·
[Getting started](https://louisetoolkit.com/docs/guide/getting-started) ·
[`louise-toolkit`](packages/louise)

</div>

---

Louise is a standalone toolkit for Cloudflare Workers: framework-agnostic core
primitives — content, db, media, forms, commerce, email, queues, auth — a SolidJS +
ProseKit inline-edit client, and the editor theme. Everything you need to make a live
site editable in place, published as one package.

## Why Louise

- **V8-native.** No Node runtime, no React. Everything runs in workerd / Cloudflare
  Workers and deploys to the edge.
- **Edit in place.** Editable regions carry a `data-louise-field` marker; in edit mode
  the client makes each one editable where it lives. Rich text is a real ProseKit editor.
- **Bring your own everything.** Bindings (D1, R2, Queues, Email) are passed in — Louise
  has no opinion about your schema, your auth, or your framework.
- **Tree-shakeable.** One ESM package with granular subpath exports; import only the
  primitive you need.

## Repository layout

This is a [pnpm](https://pnpm.io) workspace driven by the
[Vite+](https://viteplus.dev) (`vp`) toolchain.

```
packages/
  louise/          # louise-toolkit — the published library
    src/core/      # content, db, media, forms, auth, security, worker, editor, commerce, email, queues, browser, errors
    src/client/    # the inline edit client + ProseKit editor + Louise Settings (registry-driven settings surface)
    src/theme/     # the "louise" daisyUI editor theme (fonts, CSS)
workers/
  site/            # louisetoolkit.com — Astro on Cloudflare Workers: the marketing site, itself built with Louise Toolkit
  docs/            # docs.louisetoolkit.com — standalone Starlight; served by the same worker by Host
```

## Develop

Louise uses [Vite+](https://viteplus.dev) — install it once:

```sh
curl -fsSL https://vite.plus | bash
```

Then, from the repo root:

```sh
vp install          # install the workspace
pnpm build          # pack the library (vp pack) + build the site (astro build)
pnpm test           # run the library's Vitest suite
pnpm check          # Oxlint + Oxfmt over the library's TypeScript
pnpm lint:astro     # Biome lint over .astro files
pnpm lint:solid     # oxlint + eslint-plugin-solid over the SolidJS client
pnpm typecheck      # tsc over the library
pnpm dev            # run louisetoolkit.com locally (marketing + Starlight docs)
```

The library is packaged with `vp pack` (tsdown/Rolldown under the hood: multi-entry
`.d.ts` generation, tree-shaking). See [`packages/louise`](packages/louise) for the package
readme and [louisetoolkit.com/docs](https://louisetoolkit.com/docs) for the full guide and API
reference.

## License

[MIT](LICENSE) © BowenLabs
