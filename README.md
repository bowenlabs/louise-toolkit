<div align="center">

# Louise Toolkit

**Everything you need to build editable sites on Astro + Cloudflare Workers —
content, commerce, media, forms, auth, and AI, as composable V8-native primitives.**

Editing is the headline: no separate admin app, no JSON forms for prose. Log in
and the live site becomes editable in place — text where the text is, structured
sections through your own components, and back-office work in Louise Settings.

[Documentation](https://docs.louisetoolkit.com) ·
[Quickstart](https://docs.louisetoolkit.com/guide/quickstart) ·
[Is Louise for you?](https://docs.louisetoolkit.com/guide/comparison) ·
[`louise-toolkit`](packages/louise)

</div>

---

Louise is a toolkit for building sites on **Astro + Cloudflare Workers** — the whole
surface, not just content. Dependency-injected primitives — content, db, media, forms,
commerce, email, queues, auth, AI, analytics, realtime, workflows — plus a SolidJS +
ProseKit inline-edit client and the editor theme, published as one tree-shakeable
package. The core primitives are framework-agnostic (they run in any Worker or a unit
test); the batteries — the client, the theme, and the opinionated **Astroid** framework
([coming](#roadmap)) — target Astro on Cloudflare.

## Why Louise

- **A whole toolkit, not a plugin.** Commerce, forms, media, auth, AI, queues, email,
  realtime, and workflows are first-party primitives — not third-party add-ons. Editable
  content is one of them.
- **V8-native.** No Node runtime, no React on the server. Everything runs in workerd /
  Cloudflare Workers and deploys to the edge; published pages ship no editor JS.
- **Edit in place.** Editable regions carry a `data-louise-field` marker; in edit mode
  the client makes each one editable where it lives. Rich text is a real ProseKit editor.
- **Bring your own bindings.** D1, R2, Queues, Email are passed in — Louise has no
  opinion about your schema or your auth, and never dictates your markup.
- **Tree-shakeable.** One ESM package with granular subpath exports; import only the
  primitive you need, and pull peers only for what you use.

## Repository layout

This is a [pnpm](https://pnpm.io) workspace driven by the
[Vite+](https://viteplus.dev) (`vp`) toolchain.

```
packages/
  louise/          # louise-toolkit — the published library
    src/core/      # content, db, media, forms, auth, commerce, email, queues, ai, analytics, realtime, workflows, browser, security, health, worker, editor, errors
    src/client/    # the inline edit client + ProseKit editor + Louise Settings (registry-driven settings surface)
    src/theme/     # the "louise" daisyUI editor theme (fonts, CSS)
  astroid/         # astroidjs — the opinionated meta-framework over Louise + Astro (experimental; unpublished)
workers/
  site/            # louisetoolkit.com — Astro on Cloudflare Workers: the marketing site, itself built with Louise Toolkit
  docs/            # docs.louisetoolkit.com — standalone Starlight; served by the same worker by Host
  sandbox/         # sandbox.louisetoolkit.com — a live, write-capable demo that resets nightly
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
readme and [docs.louisetoolkit.com](https://docs.louisetoolkit.com) for the full guide and API
reference.

## Roadmap

Louise is **pre-1.0** and dogfooded on 4 production sites. The current push —
Cloudflare platform depth, Astro-native APIs, an agent-editable MCP server, and
**Astroid** (the opinionated framework + `create-astroid` scaffold layered over
Louise) — is tracked in the open:

- [**Platform features push**](https://github.com/bowenlabs/louise-toolkit/milestone/1) — the active milestone.
- [Epic #102](https://github.com/bowenlabs/louise-toolkit/issues/102) — the umbrella issue tying the work together.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
setup (`vp`), the lint/format split, and the changeset + PR conventions. Because
Louise is pre-1.0, the many subpath exports may still change between minor
releases; breaking changes ship as a `minor` bump and are called out in the
changeset.

## License

[MIT](LICENSE) © BowenLabs
