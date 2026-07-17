# louise-toolkit

**A V8-native toolkit for building editable sites on Cloudflare Workers.**

Louise makes the live site editable in place: no separate admin app, no JSON forms
for prose. It ships as framework-agnostic core primitives (`content`, `db`, `media`,
`forms`, `commerce`, `email`, `queues`, `worker`, plus opt-in `auth`/`security`), a
SolidJS + ProseKit inline-edit client, Louise Settings (a registry-driven settings
surface), the generic `api/louise/*` handlers, and the daisyUI editor theme — as
granular, tree-shakeable subpath exports.

> Full guide and API reference: **[docs.louisetoolkit.com](https://docs.louisetoolkit.com)**

## Install

```sh
npm install louise-toolkit
```

Louise's heavier dependencies are **optional peers** — install only what the exports
you use require:

| If you use…                                                         | Install                                             |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `louise-toolkit/db`, `/content`, `/media`, `/editor`, `/forms`      | `drizzle-orm`                                       |
| `louise-toolkit/client`                                             | `solid-js prosekit @prosekit/pm`                    |
| `louise-toolkit/client/settings`                                    | `@tanstack/solid-query` (+ the client peers)        |
| `louise-toolkit/auth`                                               | `better-auth` (`@better-auth/passkey` for passkeys) |
| `louise-toolkit/browser`                                            | `@cloudflare/puppeteer`                             |
| `louise-toolkit/stega`                                              | `@vercel/stega`                                     |
| `/security`, `/worker`, `/email`, `/queues`, `/errors`, `/commerce` | _(no peers)_                                        |

The core primitives are dependency-injected — you pass in your Cloudflare bindings
(D1, R2, Queues, Email); Louise never reaches for `cloudflare:workers` itself.

## Exports

| Subpath                                               | What it is                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `louise-toolkit/client`                               | The inline edit-on-the-page client + ProseKit rich-text editor, icons, blocks                                     |
| `louise-toolkit/client/settings`                      | Louise Settings — the registry-driven settings surface: shell (`mountSettings`), framework panels, data layer     |
| `louise-toolkit/editor`                               | Framework-generic `api/louise/*` handlers (save/settings/pages/media/forms/submissions/seed)                      |
| `louise-toolkit/forms`                                | `defineForm` → derived table + capture route + validation + review columns; optional TanStack adapter             |
| `louise-toolkit/content`                              | Collections, codegen, patch/validation, structure, webhooks                                                       |
| `louise-toolkit/db`                                   | Thin Drizzle-over-D1 helper + framework-owned `pages`/`inquiries`/`media`/`submissions`/`site_settings` columns   |
| `louise-toolkit/media`                                | R2 media: magic-byte-sniffed uploads, asset registry (alt/caption/dims), `cfImage` transforms, delete-safety scan |
| `louise-toolkit/auth`                                 | Better Auth factory + guard/handler + `generateAuthSchemaSql` (and the `louise` CLI)                              |
| `louise-toolkit/security`                             | `sanitize`, rate-limit, secrets, security headers                                                                 |
| `louise-toolkit/worker`                               | `composeWorker` — compose editor + site routes over an SSR fallthrough                                            |
| `louise-toolkit/browser`                              | Cache-first OG-image render + link checker (Cloudflare Browser Rendering)                                         |
| `louise-toolkit/commerce`                             | Shared commerce primitives: money helpers + webhook-signature crypto                                              |
| `louise-toolkit/commerce/stripe`                      | Stripe glue: Payment Element / PaymentIntents, invoices, webhooks (raw `fetch`, no SDK)                           |
| `louise-toolkit/commerce/square`                      | Square `/v2` catalog, orders, payments, customers, loyalty, subscriptions + webhook verification                  |
| `louise-toolkit/commerce/fourthwall`                  | Fourthwall storefront/catalog + webhook verification                                                              |
| `louise-toolkit/email`                                | Cloudflare Email Sending (`env.EMAIL.send`)                                                                       |
| `louise-toolkit/queues`                               | Cloudflare Queues producer + batch consumer                                                                       |
| `louise-toolkit/stega`                                | `@vercel/stega` visual-editing tagging + a dependency-free stripper                                               |
| `louise-toolkit/errors`                               | `LouiseError` and typed subclasses                                                                                |
| `louise-toolkit/theme/louise.css`, `/theme/fonts.css` | the daisyUI "louise" editor theme                                                                                 |

## Quick start

```ts
// A Cloudflare Worker endpoint — bindings are passed in, never imported.
import { db } from "louise-toolkit/db";
import { sendEmail } from "louise-toolkit/email";

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
import { mountLouise } from "louise-toolkit/client";
mountLouise(); // no-op unless the page rendered edit-mode markers
```

See the [Getting Started guide](https://docs.louisetoolkit.com/guide/getting-started) for
the full wiring (edit mode, the save endpoint, rich text, Louise Settings, media, theme).

## Contributing / building

This package is developed in the [`louise-toolkit`](https://github.com/bowenlabs/louise-toolkit)
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
