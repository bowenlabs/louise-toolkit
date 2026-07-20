---
title: Quickstart
description: See Louise running in 30 seconds, then make a field on your own Astro + Cloudflare site editable in place.
sidebar:
  order: 0
---

Louise is a **toolkit for building editable sites on Astro + Cloudflare Workers** —
content, commerce, media, forms, auth, and AI as composable primitives. Editing
the live page in place is the headline; this page gets you from zero to it.

## See it first (30 seconds)

You don't have to install anything to evaluate Louise:

- **[Interactive examples](https://louisetoolkit.com/examples)** — each primitive as
  live UI beside the real, drift-proof source that ships it. The
  [contact form](https://louisetoolkit.com/examples/forms) and
  [Workers checkout](https://louisetoolkit.com/examples/commerce) run today.
- **[Live sandbox](https://sandbox.louisetoolkit.com)** — a real, write-capable
  Louise site that resets nightly. Toggle edit mode and change anything; nothing
  you do sticks around.

This whole docs-and-marketing site is itself built with Louise, so the demos
_are_ the product.

## Add it to your app (≈5 minutes)

The steps below wire inline editing into an existing **Astro on Cloudflare Workers**
app (the [`@astrojs/cloudflare`](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
adapter, with a D1 binding on `env.DB`). Inline editing is progressive
enhancement — you server-render normally, then mark the editable regions and
mount the client in edit mode.

:::tip[Starting from scratch? There's a one-command scaffold]
Standing the whole app up by hand — bindings, migrations, worker wiring — is what
**Astroid** (the opinionated framework layer over Louise) collapses into
`pnpm create astroid my-site`. It scaffolds an editable Astro app on Cloudflare
with sign-in, migrations, and the editor already wired.

This page is the other path: adding Louise to an app you already have. See the
[Astroid guide](/guide/astroid/) if you're starting fresh.
:::

### 1. Install

```sh
pnpm add louise-toolkit
# peers for what this quickstart uses: Drizzle (db) + the inline-edit client
pnpm add drizzle-orm solid-js prosekit @prosekit/pm
```

Louise's heavier dependencies are **optional peers** — a route that only imports
`louise-toolkit/errors` pulls in nothing extra. Install peers per export you use.

### 2. Mark a region as editable

The marker is `"<collection>:<key>:<field>"` — the collection, the row key, and
the field the client will PATCH.

```astro
---
// src/pages/index.astro — render the value from your own D1 row as usual.
const settings = /* your Drizzle query over env.DB */;
---
<h1 data-louise-field="settings:1:heroHeadline">{settings.heroHeadline}</h1>
```

### 3. Mount the client

It **self-gates**: if the page has no markers (i.e. it wasn't rendered in edit
mode) `mountLouise()` does nothing — so published pages ship no editor JS.

```ts
import { mountLouise } from "louise-toolkit/client";
mountLouise();
```

### 4. Accept the save

The client sends one `PATCH` per changed field to your editor route. Louise's
`saveRoute` builds that route for you — you pass your own table, an **allowlist**
of writable fields, and a `resolveEditor` that decides who may edit.

```ts
// src/pages/api/louise/[...path].ts — mounted at /api/louise/*
import { saveRoute, runEditorRoute } from "louise-toolkit/editor";
import { siteSettings } from "../../../schema"; // your Drizzle table

const route = saveRoute({
  // Placeholder gate — returns an editor or null. Swap for real auth (step 5).
  resolveEditor: (request) => (isEditor(request) ? { id: "you" } : null),
  collections: {
    settings: { table: siteSettings, fields: ["heroHeadline"] }, // allowlist!
  },
});

export const ALL = (ctx) => runEditorRoute(route, ctx.request, ctx.locals.runtime.env);
```

Only allowlisted fields are writable — a forged request can never touch an
unlisted column.

### 5. Gate it with real auth

Step 4 used a placeholder `resolveEditor`. In production, resolve a real editor
session — Louise ships a `better-auth` integration and a same-origin/CSRF guard.
See **[Auth & edit mode](/guide/auth-and-edit-mode/)** for the session flow that
turns a viewer into an in-place editor, and marks the page for edit mode so
`mountLouise()` activates.

## Next steps

- **[Getting started](/guide/getting-started/)** — the full mental model
  (dependency-injected primitives, `astro:env`, the field lifecycle).
- **[Core concepts](/guide/concepts/)** — collections, sections, drafts, settings.
- **[Is Louise for you?](/guide/comparison/)** — honest comparison vs. Tina /
  Sanity / Payload, and the explicit non-goals.
- Then reach for the primitive you need: [Forms](/guide/forms/),
  [Media](/guide/media/), [Commerce](/guide/commerce/),
  [AI assists](/guide/ai-assists/), and the full
  [reference](/reference/editor/).
