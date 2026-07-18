---
title: Getting started
description: Install Louise, wire the optional peers, and make your first field editable.
sidebar:
  order: 1
---

Louise is a toolkit for building sites on **Astro + Cloudflare Workers** — content,
commerce, media, forms, auth, and AI as composable primitives, with editing the live
page in place as the headline. It's a library, not a scaffold: you add it to a
Cloudflare Workers app and wire the pieces you need. The core primitives are
framework-agnostic (they run under Astro, Hono, a bare Worker, or a unit test); the
batteries — the client, theme, and Astroid — target Astro on Cloudflare.

:::tip[See it running first]
Two live surfaces let you try Louise before wiring it in. The
[interactive examples](https://louisetoolkit.com/examples) show each primitive as
live UI backed by real, drift-proof source — the
[contact form](https://louisetoolkit.com/examples/forms) and
[Workers checkout](https://louisetoolkit.com/examples/commerce) are live today. The
[sandbox](https://sandbox.louisetoolkit.com) is a write-capable demo that resets
nightly, so you can poke at real saves without leaving anything behind.
:::

## Install

```sh
npm install louise-toolkit
```

Louise's heavier dependencies are **optional peers**, so a route that only uses
`louise-toolkit/errors` pulls in nothing extra. Install the peers for the
exports you actually use:

| If you import…                              | Also install                     |
| ------------------------------------------- | -------------------------------- |
| `louise-toolkit/db`, `/content`             | `drizzle-orm`                    |
| `louise-toolkit/client`                     | `solid-js prosekit @prosekit/pm` |
| `/email`, `/queues`, `/errors`, `/commerce` | _(no peers)_                     |

```sh
npm install drizzle-orm            # for /db and /content
npm install solid-js prosekit @prosekit/pm   # for the /client editor
```

## The mental model

Every Louise primitive is **dependency-injected**: it takes your Cloudflare
binding as an argument and returns a plain result. Louise never reaches for
`cloudflare:workers`, so the same functions run in `astro dev`, in production,
and in a unit test with a fake binding.

```ts
// A bare Cloudflare Worker endpoint.
import { db } from "louise-toolkit/db";
import { sendEmail } from "louise-toolkit/email";

export default {
  async fetch(_req: Request, env: Env) {
    const orm = db(env.DB); // Drizzle over your D1 binding — your schema, not Louise's
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

## Typed env vars with `astro:env`

Bindings arrive on `env`, but plain **env vars and secrets** (an API token, a
provider mode) are easy to fat-finger. On Astro, declare a schema and let
`astro:env` validate it and generate a typed accessor — the values still come
from `wrangler.jsonc` `vars` / `wrangler secret` at runtime, this is just the
schema on top:

```js
// astro.config.mjs
import { defineConfig, envField } from "astro/config";

export default defineConfig({
  env: {
    schema: {
      SQUARE_ENV: envField.enum({
        context: "server",
        access: "public",
        values: ["sandbox", "production"],
        default: "sandbox",
      }),
      SQUARE_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
```

Import the validated values from `astro:env/server` and pass them into the Louise
primitive — same dependency-injection model, just type-checked first:

```ts
import { SQUARE_ENV, SQUARE_TOKEN } from "astro:env/server";
// …hand SQUARE_ENV / SQUARE_TOKEN to the Square client — see the Commerce guide.
```

`astro:env` covers env vars and secrets; D1/R2/Queues **bindings** still arrive on
`env`. The [live sandbox](https://sandbox.louisetoolkit.com) wires its Square
checkout exactly this way.

## Your first inline-editable field

Inline editing is progressive enhancement. Server-render the page normally; in
edit mode, mark the editable regions and mount the client.

**1. Mark the region.** The marker is `"<collection>:<key>:<field>"`.

```html
<h1 data-louise-field="settings:1:heroHeadline">Your Studio</h1>
```

**2. Mount the client.** It self-gates — if the page has no markers (i.e. it
wasn't rendered in edit mode) `mountLouise` does nothing, so you can lazy-import
it safely.

```ts
import { mountLouise } from "louise-toolkit/client";
mountLouise();
```

**3. Accept the save.** The client sends one `PATCH` per changed field to your
save endpoint. **Allowlist every writable field** — a forged request must not be
able to touch an unlisted column.

```ts
// POST /api/louise/save  (your route — you own auth + the allowlist)
const EDITABLE = new Set(["heroHeadline", "heroIntro"]);
```

See [Inline editing](/guide/inline-editing/) for the full field lifecycle,
and [Rich text](/guide/rich-text/) for prose fields.

## Building the package

Louise is developed in the [`louise`](https://github.com/bowenlabs/louise-toolkit)
workspace with [Vite+](https://viteplus.dev):

```sh
curl -fsSL https://vite.plus | bash   # once
vp install
vp pack     # build the library → dist/
vp test     # Vitest
vp check    # Oxlint + Oxfmt + type-check
```
