# @louisecms/core

**A V8-native, inline "edit-on-the-live-page" CMS for Cloudflare Workers.**

Louise makes the live site editable in place: no separate admin app, no JSON forms
for prose. It ships as framework-agnostic core primitives (`cms`, `db`, `commerce`,
`email`, `queues`), a SolidJS + ProseKit inline-edit client, and the daisyUI editor
theme — as granular, tree-shakeable subpath exports.

> Full guide and API reference: **[louisecms.com/docs](https://louisecms.com/docs)**

## Install

```sh
npm install @louisecms/core
```

Louise's heavier dependencies are **optional peers** — install only what the exports
you use require:

| If you use…                                 | Install                          |
| ------------------------------------------- | -------------------------------- |
| `@louisecms/core/db`, `/cms`                | `drizzle-orm`                    |
| `@louisecms/core/client`                    | `solid-js prosekit @prosekit/pm` |
| `/email`, `/queues`, `/errors`, `/commerce` | _(no peers)_                     |

The core primitives are dependency-injected — you pass in your Cloudflare bindings
(D1, R2, Queues, Email); Louise never reaches for `cloudflare:workers` itself.

## Exports

| Subpath                                                | What it is                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `@louisecms/core/client`                               | The inline edit-on-the-page client + ProseKit rich-text editor |
| `@louisecms/core/cms`                                  | Collections, codegen, patch/validation, structure, webhooks    |
| `@louisecms/core/db`                                   | Thin Drizzle-over-D1 helper + framework-owned `site_settings`  |
| `@louisecms/core/commerce`                             | Stripe invoices (raw `fetch` + `crypto.subtle`, no SDK)        |
| `@louisecms/core/commerce/fourthwall`                  | Fourthwall storefront/catalog + webhook verification           |
| `@louisecms/core/email`                                | Cloudflare Email Sending (`env.EMAIL.send`)                    |
| `@louisecms/core/queues`                               | Cloudflare Queues producer + batch consumer                    |
| `@louisecms/core/errors`                               | `LouiseError` and typed subclasses                             |
| `@louisecms/core/theme/louise.css`, `/theme/fonts.css` | the daisyUI "louise" editor theme                              |

## Quick start

```ts
// A Cloudflare Worker endpoint — bindings are passed in, never imported.
import { db } from "@louisecms/core/db";
import { sendEmail } from "@louisecms/core/email";

export default {
  async fetch(req: Request, env: Env) {
    const orm = db(env.DB); // Drizzle over your D1 binding
    await sendEmail(env.EMAIL, {
      from: "studio@example.com",
      to: "you@example.com",
      subject: "Hello from the edge",
      html: "<p>Sent V8-natively.</p>",
    });
    return new Response("ok");
  },
};
```

Making a field inline-editable is a marker plus the client:

```html
<h1 data-louise-field="settings:1:heroHeadline">Meg Bowen</h1>
```

```ts
import { mountLouise } from "@louisecms/core/client";
mountLouise(); // no-op unless the page rendered edit-mode markers
```

See the [Getting Started guide](https://louisecms.com/docs/guide/getting-started) for
the full wiring (edit mode, the save endpoint, rich text, the drawer, media, theme).

## Contributing / building

This package is developed in the [`louisecms`](https://github.com/bowenlabs/louisecms)
workspace with [Vite+](https://viteplus.dev). It's packaged with `vp pack` (tsdown /
Rolldown: multi-entry, `.d.ts`, tree-shaking).

```sh
vp install
vp pack            # build → dist/
vp test            # Vitest
vp check           # Oxlint + Oxfmt + type-check
```

## License

[MIT](../../LICENSE) © BowenLabs
