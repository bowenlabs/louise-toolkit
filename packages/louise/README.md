# louisecms

**A V8-native, inline "edit-on-the-live-page" CMS for Cloudflare Workers.**

Louise makes the live site editable in place: no separate admin app, no JSON forms
for prose. It ships as framework-agnostic core primitives (`cms`, `db`, `commerce`,
`email`, `queues`), a SolidJS + ProseKit inline-edit client, and the daisyUI editor
theme — as granular, tree-shakeable subpath exports.

> Full guide and API reference: **[louisecms.com/docs](https://louisecms.com/docs)**

## Install

```sh
npm install louisecms
```

Louise's heavier dependencies are **optional peers** — install only what the exports
you use require:

| If you use…                                 | Install                          |
| ------------------------------------------- | -------------------------------- |
| `louisecms/db`, `/cms`                      | `drizzle-orm`                    |
| `louisecms/client`                          | `solid-js prosekit @prosekit/pm` |
| `/email`, `/queues`, `/errors`, `/commerce` | _(no peers)_                     |

The core primitives are dependency-injected — you pass in your Cloudflare bindings
(D1, R2, Queues, Email); Louise never reaches for `cloudflare:workers` itself.

## Exports

| Subpath                                          | What it is                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `louisecms/client`                               | The inline edit-on-the-page client + ProseKit rich-text editor                                   |
| `louisecms/cms`                                  | Collections, codegen, patch/validation, structure, webhooks                                      |
| `louisecms/db`                                   | Thin Drizzle-over-D1 helper + framework-owned `site_settings`                                    |
| `louisecms/commerce`                             | Stripe invoices (raw `fetch` + `crypto.subtle`, no SDK)                                          |
| `louisecms/commerce/fourthwall`                  | Fourthwall storefront/catalog + webhook verification                                             |
| `louisecms/commerce/square`                      | Square `/v2` catalog, orders, payments, customers, loyalty, subscriptions + webhook verification |
| `louisecms/email`                                | Cloudflare Email Sending (`env.EMAIL.send`)                                                      |
| `louisecms/queues`                               | Cloudflare Queues producer + batch consumer                                                      |
| `louisecms/errors`                               | `LouiseError` and typed subclasses                                                               |
| `louisecms/theme/louise.css`, `/theme/fonts.css` | the daisyUI "louise" editor theme                                                                |

## Quick start

```ts
// A Cloudflare Worker endpoint — bindings are passed in, never imported.
import { db } from "louisecms/db";
import { sendEmail } from "louisecms/email";

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
<h1 data-louise-field="settings:1:heroHeadline">Your Studio</h1>
```

```ts
import { mountLouise } from "louisecms/client";
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

## Credits

**Bundled** (redistributed with this package, so its notice ships here): icons
from [Phosphor Icons](https://phosphoricons.com) (MIT © Phosphor Icons), inlined
at build time — see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

**Built on** (peer dependencies you install yourself — not redistributed here):
[ProseKit](https://prosekit.dev) + [ProseMirror](https://prosemirror.net) for
rich text, [SolidJS](https://www.solidjs.com) for the client, and
[Drizzle ORM](https://orm.drizzle.team) over Cloudflare D1.

## License

[MIT](./LICENSE) © BowenLabs
