# louise

**A V8-native toolkit for building editable sites on Cloudflare Workers.**

Louise makes the live site editable in place: no separate admin app, no JSON forms
for prose. It ships as framework-agnostic core primitives (`cms`, `db`, `media`,
`forms`, `commerce`, `email`, `queues`, `worker`, plus opt-in `auth`/`security`), a
SolidJS + ProseKit inline-edit client, Louise Settings (a registry-driven settings
surface), the generic `api/louise/*` handlers, and the daisyUI editor theme — as
granular, tree-shakeable subpath exports.

> Full guide and API reference: **[louisetoolkit.com/docs](https://louisetoolkit.com/docs)**

## Install

```sh
npm install louise
```

Louise's heavier dependencies are **optional peers** — install only what the exports
you use require:

| If you use…                                                         | Install                                             |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `louise/db`, `/cms`, `/media`, `/editor`, `/forms`                  | `drizzle-orm`                                       |
| `louise/client`                                                     | `solid-js prosekit @prosekit/pm`                    |
| `louise/client/settings`                                            | `@tanstack/solid-query` (+ the client peers)        |
| `louise/auth`                                                       | `better-auth` (`@better-auth/passkey` for passkeys) |
| `louise/browser`                                                    | `@cloudflare/puppeteer`                             |
| `louise/stega`                                                      | `@vercel/stega`                                     |
| `/security`, `/worker`, `/email`, `/queues`, `/errors`, `/commerce` | _(no peers)_                                        |

The core primitives are dependency-injected — you pass in your Cloudflare bindings
(D1, R2, Queues, Email); Louise never reaches for `cloudflare:workers` itself.

## Exports

| Subpath                                       | What it is                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `louise/client`                               | The inline edit-on-the-page client + ProseKit rich-text editor, icons, blocks                                     |
| `louise/client/settings`                      | Louise Settings — the registry-driven settings surface: shell (`mountSettings`), framework panels, data layer     |
| `louise/editor`                               | Framework-generic `api/louise/*` handlers (save/settings/pages/media/forms/submissions/seed)                      |
| `louise/forms`                                | `defineForm` → derived table + capture route + validation + review columns; optional TanStack adapter             |
| `louise/cms`                                  | Collections, codegen, patch/validation, structure, webhooks                                                       |
| `louise/db`                                   | Thin Drizzle-over-D1 helper + framework-owned `pages`/`inquiries`/`media`/`submissions`/`site_settings` columns   |
| `louise/media`                                | R2 media: magic-byte-sniffed uploads, asset registry (alt/caption/dims), `cfImage` transforms, delete-safety scan |
| `louise/auth`                                 | Better Auth factory + guard/handler + `generateAuthSchemaSql` (and the `louise` CLI)                              |
| `louise/security`                             | `sanitize`, rate-limit, secrets, security headers                                                                 |
| `louise/worker`                               | `composeWorker` — compose editor + site routes over an SSR fallthrough                                            |
| `louise/browser`                              | Cache-first OG-image render + link checker (Cloudflare Browser Rendering)                                         |
| `louise/commerce`                             | Shared commerce primitives: money helpers + webhook-signature crypto                                              |
| `louise/commerce/stripe`                      | Stripe glue: Payment Element / PaymentIntents, invoices, webhooks (raw `fetch`, no SDK)                           |
| `louise/commerce/square`                      | Square `/v2` catalog, orders, payments, customers, loyalty, subscriptions + webhook verification                  |
| `louise/commerce/fourthwall`                  | Fourthwall storefront/catalog + webhook verification                                                              |
| `louise/email`                                | Cloudflare Email Sending (`env.EMAIL.send`)                                                                       |
| `louise/queues`                               | Cloudflare Queues producer + batch consumer                                                                       |
| `louise/stega`                                | `@vercel/stega` visual-editing tagging + a dependency-free stripper                                               |
| `louise/errors`                               | `LouiseError` and typed subclasses                                                                                |
| `louise/theme/louise.css`, `/theme/fonts.css` | the daisyUI "louise" editor theme                                                                                 |

## Quick start

```ts
// A Cloudflare Worker endpoint — bindings are passed in, never imported.
import { db } from "louise/db";
import { sendEmail } from "louise/email";

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
import { mountLouise } from "louise/client";
mountLouise(); // no-op unless the page rendered edit-mode markers
```

See the [Getting Started guide](https://louisetoolkit.com/docs/guide/getting-started) for
the full wiring (edit mode, the save endpoint, rich text, Louise Settings, media, theme).

## Contributing / building

This package is developed in the [`louise`](https://github.com/bowenlabs/louise-toolkit)
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
