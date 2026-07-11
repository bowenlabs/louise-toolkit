---
title: Forms
description: Declarative forms — define fields once, get the table, capture route, and validation.
sidebar:
  order: 10
---

Louise can **review** submissions (the Inquiries tab) and now **build** the form
behind them. `defineForm` is one definition that drives the submission table, the
public capture route, server + client validation, and the review columns — no
hand-rolled POST handler, columns, or validation per site. `inquiries` is just
the **built-in default form**.

## Define a form

```ts
import { defineForm } from "louisecms/forms";

export const contact = defineForm({
  name: "inquiries", // form + table name (a bare SQL identifier)
  fields: {
    firstName: { type: "text",     label: "First name" },
    lastName:  { type: "text",     label: "Last name" },
    email:     { type: "email",    label: "Email",   required: true },
    regarding: { type: "select",   label: "Regarding", options: ["General", "Booking", "Press"] },
    message:   { type: "textarea", label: "Message", required: true, validation: (r) => r.max(5000) },
  },
  spam: { turnstile: true, rateLimit: { max: 5, windowSec: 60 } },
});
```

Field `type` is `text | email | tel | url | textarea | number | select |
checkbox | date`. `required` makes the column `NOT NULL` **and** adds a required
check. `validation` reuses the shared [`Rule`](/reference/cms/#validation) builder
— the *same* engine the CMS collections use, so there's one validation definition.

The result carries everything derived from the fields:

- **`contact.table` / `contact.columns`** — the Drizzle table (spread `columns`
  into your own `sqliteTable` to add site columns like a `clientId`). Generate the
  migration with drizzle-kit as usual.
- **`contact.reviewColumns`** — `{ key, label, type }[]` for the submissions panel.

## Capture: `formRoute`

`formRoute` is the **public** companion to the editor-gated review route. It's
same-origin-guarded (CSRF) but **not** session-gated — anyone may submit —
validates + coerces against the fields, applies the spam guard, and inserts:

```ts
import { formRoute } from "louisecms/editor";
import { composeWorker } from "louisecms/worker";
import { contact } from "./forms";

export default composeWorker({
  routes: [
    formRoute({
      form: contact,
      // Optional spam wiring, used only when the form declares it:
      rateLimitKv: (env) => env.RL,          // KV for the fixed-window limiter
      turnstileSecret: (env) => env.TURNSTILE_SECRET,
    }),
    // …your review route + SSR fallthrough
  ],
});
```

Mounted at `/api/louise/forms/<name>` by default. A submission returns `201 {
ok: true }`; a validation failure returns `422 { error, violations }` (per-field
`{ path, message }`); a rate-limited request returns `429` with `Retry-After`; a
failed Turnstile or cross-origin request returns `403`. Unknown keys in the body
are ignored — only declared fields are read and stored.

A plain HTML `<form method="POST">` works out of the box (it sends `Referer`, so
the same-origin check passes); a `fetch` with a JSON body works too.

## Render (headless `<Form>`)

`louisecms/client` ships a headless `<Form>` that renders accessible inputs from
the catalog and **mirrors the exact server validation client-side** (it reuses
`validateSubmission` — the same `Rule` engine, no second definition), then POSTs
to the form's `formRoute`. It's unstyled by default (every element has a
`louise-form*` class hook), so a site keeps its own look.

```tsx
import { Form } from "louisecms/client";
import { contact } from "./forms"; // a client-safe { name, fields } config

<Form form={contact} />; // POSTs to /api/louise/forms/inquiries
```

Pass a plain `{ name, fields }` config to the client (not the `defineForm`
*result*, which carries the Drizzle table — keep that server-side). For a
non-Solid site, `mountForm(hostEl, { form })` renders into a DOM node and returns
a disposer. A `file` field uploads through the media route and stores the
returned URL. On a `422` the server's per-field messages are painted back onto
the inputs.

## Complex forms: TanStack Form (optional)

The base `<Form>` covers flat, generated forms with no dependency. For a
multi-step form, field arrays, or async cross-field rules, reach for
[`@tanstack/solid-form`](https://tanstack.com/form) — and still validate with
Louise's one `Rule` engine via the dependency-free adapter:

```tsx
import { tanstackFormValidators } from "louisecms/forms";
const v = tanstackFormValidators(contact); // { [field]: ({ value }) => error | undefined }

// wire each into a TanStack field:
<form.Field name="email" validators={{ onChange: v.email }}>{/* … */}</form.Field>
```

`tanstackFormValidators` (and per-field `tanstackFieldValidator`) return
functions in TanStack Form's validator shape, backed by `validateField` — so a
complex hand-built form runs the same checks as `<Form>` and the server.

## Review

The submissions review route (`inquiriesRoute`) and the drawer's Inquiries tab
are already form-agnostic: the route lists newest-first / deletes by id over the
form's table, and the panel renders the columns. So one `defineForm` gives you
capture **and** review with no extra wiring.

## Spam

Both guards are opt-in per form and enforced only when `formRoute` is given the
matching binding:

- **Rate limit** — a KV fixed-window limiter (reuses
  [`security/rate-limit`](/reference/security/)), keyed by `CF-Connecting-IP` by
  default. Fails open (a limiter outage never blocks submissions).
- **Turnstile** — server-side token verification (`verifyTurnstileToken`) of the
  `cf-turnstile-response` field. Fails closed. See the
  [turnstile setup path](https://developers.cloudflare.com/turnstile/) for the
  widget.
