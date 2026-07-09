---
title: Getting started
description: Install Louise, wire the optional peers, and make your first field editable.
sidebar:
  order: 1
---

Louise is a library, not a scaffold — you add it to a Cloudflare Workers app
(Astro, Hono, or a bare Worker) and wire the pieces you need.

## Install

```sh
npm install louisecms
```

Louise's heavier dependencies are **optional peers**, so a route that only uses
`louisecms/errors` pulls in nothing extra. Install the peers for the
exports you actually use:

| If you import…                              | Also install                     |
| ------------------------------------------- | -------------------------------- |
| `louisecms/db`, `/cms`                      | `drizzle-orm`                    |
| `louisecms/client`                          | `solid-js prosekit @prosekit/pm` |
| `/email`, `/queues`, `/errors`, `/commerce` | _(no peers)_                     |

```sh
npm install drizzle-orm            # for /db and /cms
npm install solid-js prosekit @prosekit/pm   # for the /client editor
```

## The mental model

Every Louise primitive is **dependency-injected**: it takes your Cloudflare
binding as an argument and returns a plain result. Louise never reaches for
`cloudflare:workers`, so the same functions run in `astro dev`, in production,
and in a unit test with a fake binding.

```ts
// A bare Cloudflare Worker endpoint.
import { db } from "louisecms/db";
import { sendEmail } from "louisecms/email";

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
import { mountLouise } from "louisecms/client";
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

Louise is developed in the [`louisecms`](https://github.com/bowenlabs/louisecms)
workspace with [Vite+](https://viteplus.dev):

```sh
curl -fsSL https://vite.plus | bash   # once
vp install
vp pack     # build the library → dist/
vp test     # Vitest
vp check    # Oxlint + Oxfmt + type-check
```
