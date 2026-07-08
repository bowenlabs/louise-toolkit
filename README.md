<div align="center">

# Louise CMS

**A V8-native, inline "edit-on-the-live-page" CMS for Cloudflare Workers.**

No separate admin app. No JSON forms for prose. Log in, and the live site
becomes editable in place — text where the text is, structured work in a drawer.

[Documentation](https://louisecms.com/docs) ·
[Getting started](https://louisecms.com/docs/guide/getting-started) ·
[`louisecms`](packages/louise)

</div>

---

Louise is a standalone CMS engine for Cloudflare Workers: framework-agnostic core
primitives, a SolidJS + ProseKit inline-edit client, and the editor theme — everything
you need to make a live site editable in place, published as one package.

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
  louise/          # louisecms — the published library
    src/core/      # cms, db, media, auth, security, worker, editor, commerce, email, queues, browser, errors
    src/client/    # the inline edit client + ProseKit editor + the registry-driven editor drawer
    src/theme/     # the "louise" daisyUI editor theme (fonts, CSS)
workers/
  site/            # louisecms.com — Astro on Cloudflare Workers: marketing (/) + Starlight docs (/docs)
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
pnpm check          # Oxlint + Oxfmt over the library
pnpm typecheck      # tsc over the library
pnpm dev            # run louisecms.com locally (marketing + Starlight docs)
```

The library is packaged with `vp pack` (tsdown/Rolldown under the hood: multi-entry
`.d.ts` generation, tree-shaking). See [`packages/louise`](packages/louise) for the package
readme and [louisecms.com/docs](https://louisecms.com/docs) for the full guide and API
reference.

## License

[MIT](LICENSE) © BowenLabs
