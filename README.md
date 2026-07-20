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
— target Astro on Cloudflare.

Starting a new site? `pnpm create astroid my-site` scaffolds the whole thing.
Adding editing to an app you already have? `pnpm add louise-toolkit`.

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
  astroid/         # astroidjs — the opinionated meta-framework over Louise + Astro (pre-1.0)
  create-astroid/  # create-astroid — `pnpm create astroid`, the one-command scaffold (pre-1.0)
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
pnpm check          # Oxlint + Oxfmt + type-aware lint & type-check (TS7) over the library's TypeScript
pnpm lint:astro     # Biome lint over .astro files
pnpm lint:solid     # oxlint + eslint-plugin-solid over the SolidJS client
pnpm knip           # dead-code check: unused files & exports across the workspace
pnpm typecheck      # tsc over the library
pnpm dev            # run louisetoolkit.com locally (marketing + Starlight docs)
```

The library is packaged with `vp pack` (tsdown/Rolldown under the hood: multi-entry
`.d.ts` generation, tree-shaking). See [`packages/louise`](packages/louise) for the package
readme and [docs.louisetoolkit.com](https://docs.louisetoolkit.com) for the full guide and API
reference.

## Roadmap

Louise is **pre-1.0** and dogfooded on 4 production sites. **Astroid** and
`create-astroid` have shipped (both pre-1.0). The current push — Cloudflare
platform depth, Astro-native APIs, and an agent-editable MCP server — is tracked
in the open:

- [**Platform features push**](https://github.com/bowenlabs/louise-toolkit/milestone/1) — the active milestone.
- [Epic #102](https://github.com/bowenlabs/louise-toolkit/issues/102) — the umbrella issue tying the work together.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
setup (`vp`), the lint/format split, and the changeset + PR conventions. Because
Louise is pre-1.0, the many subpath exports may still change between minor
releases; breaking changes ship as a `minor` bump and are called out in the
changeset.

## Built with

Louise is built on — and grateful for — a lot of excellent open source. Sincere
thanks to the authors and maintainers of the projects that make it possible:

**Platform & framework** —
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com)
[![Astro](https://img.shields.io/badge/Astro-BC52EE?logo=astro&logoColor=white)](https://astro.build)

**The in-place editor** —
[![SolidJS](https://img.shields.io/badge/SolidJS-2C4F7C?logo=solid&logoColor=white)](https://www.solidjs.com)
[![ProseKit](https://img.shields.io/badge/ProseKit-6E56CF?logo=prosemirror&logoColor=white)](https://prosekit.dev)
[![TanStack Query](https://img.shields.io/badge/TanStack_Query-FF4154?logo=tanstack&logoColor=white)](https://tanstack.com/query)
[![Harper](https://img.shields.io/badge/Harper-4C6EF5)](https://writewithharper.com)

**Data, auth & validation** —
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![better-auth](https://img.shields.io/badge/better--auth-000000?logo=betterauth&logoColor=white)](https://www.better-auth.com)
[![Standard Schema](https://img.shields.io/badge/Standard_Schema-8B5CF6)](https://standardschema.dev)

**Rendering & assets** —
[![Phosphor Icons](https://img.shields.io/badge/Phosphor_Icons-2B2B2B?logo=phosphoricons&logoColor=white)](https://phosphoricons.com)
[![Roboto Flex](https://img.shields.io/badge/Roboto_Flex-5C6370)](https://github.com/googlefonts/roboto-flex)
[![resvg](https://img.shields.io/badge/resvg-5C6370)](https://github.com/yisibl/resvg-js)
[![ultrahtml](https://img.shields.io/badge/ultrahtml-5C6370)](https://github.com/natemoo-re/ultrahtml)

**Styling** —
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![daisyUI](https://img.shields.io/badge/daisyUI-1AD1A5?logo=daisyui&logoColor=white)](https://daisyui.com)

**Build & quality** —
[![Vite+](https://img.shields.io/badge/Vite%2B-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![Rolldown](https://img.shields.io/badge/Rolldown-F04E23?logo=rolldown&logoColor=white)](https://rolldown.rs)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![oxc](https://img.shields.io/badge/oxc-1F2937?logo=oxc&logoColor=white)](https://oxc.rs)
[![Biome](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Also gratefully used: [`@cloudflare/puppeteer`](https://developers.cloudflare.com/browser-rendering/)
(Browser Rendering) and [`@vercel/stega`](https://github.com/vercel/stega) (visual-edit
markers). Bundled fonts and icons ship under their original licenses — see
[THIRD_PARTY_NOTICES](packages/louise/THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © BowenLabs
