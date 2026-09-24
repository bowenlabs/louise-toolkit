---
title: forms
description: "louise-toolkit/forms—declarative form definitions: derive the table, capture route, validation, and review columns from one definition."
sidebar:
  order: 12
---

```ts
import { defineForm, validateSubmission, tanstackFormValidators } from "louise-toolkit/forms";
```

Define a form's fields **once**; derive the submission table, the public capture
route ([`formRoute`](/reference/editor/)), server + client validation, and the
review columns from that single definition. `inquiries` is the built-in default
form ([`louise-toolkit/db`](/reference/db/)). Validation reuses the shared `Rule`
engine ([`content`](/reference/content/#validation))—one definition, both sides. Peer:
`drizzle-orm`. See the [forms guide](/guide/forms/) for the full walk-through.

## `defineForm(config)`

```ts
function defineForm(config: FormConfig): FormDefinition;
```

Returns the config plus everything derived from it—the Drizzle `columns`/
`table` and the `reviewColumns` Louise Settings renders.

### `FormConfig` / `FormField`

| field          | purpose                                                               |
| -------------- | --------------------------------------------------------------------- |
| `name`         | form + table name (a bare SQL identifier, `^[A-Za-z_][A-Za-z0-9_]*$`) |
| `fields`       | `Record<string, FormField>`                                           |
| `spam?`        | opt-in anti-spam (below)                                              |
| `notify?`      | `{ webhook?, email? }`—where a submission is announced (below)        |
| `submitLabel?` | button label for the render helper (default `"Send"`)                 |

`notify.webhook` is fetched with [`fetchPublicUrl`](/reference/security/), so it
must be a public https URL; a target the policy refuses is skipped, and the
submission still succeeds.

A `FormField` is `{ type, label, required?, options?, placeholder?, help?,
validation? }`. `type` is `text | email | tel | url | textarea | number | select
| checkbox | date | file`. `required` drives a `NOT NULL` column **and** a
required check. `validation` is the shared `(r) => Rule` builder. `email`/`url`/
`select`/`number` carry a built-in format/coercion check; `file` uploads through
the [media](/reference/media/) route and stores the URL.

**Column mapping.** text-like → `text`, `checkbox` → boolean `integer`, `number`
→ `real`, plus an autoincrement `id` and a `created_at` timestamp. `deriveFormColumns`
and `columnName` (camelCase → snake_case) are exported for composing your own table.

### `FormDefinition`

`FormConfig` + `columns` (spread into a table), `table` (ready-made), and
`reviewColumns: { key, label, type }[]`.

## Validation

```ts
function validateSubmission(config, data): Promise<{ values; violations }>;
function validateField(key, field, value, data?): Promise<ValidationViolation[]>;
function coerceFormValue(field, raw): unknown;
```

`validateSubmission` coerces + validates a whole submission (used by `formRoute`);
`validateField` does one field (used by the TanStack adapter); `coerceFormValue`
normalizes a raw value to its stored shape (numbers, booleans, trimmed strings,
blank → `null`).

## Spam

`spam` on the form declares intent; `formRoute` enforces it with the bindings you
pass. `rateLimit` (KV fixed-window), `turnstile` (verified with
`verifyTurnstileToken`, fails closed), and two **silent** heuristics—`honeypot`
(a decoy field) and `minSeconds` (a too-fast-submit check vs the render helper's
`louise_ts`). `looksLikeSpam(config, body)` evaluates the silent pair.

```ts
function verifyTurnstileToken(
  secret: string,
  token: string | null,
  remoteIp?: string | null,
): Promise<boolean>;
```

### The widget: `renderTurnstile(el, options)`

The browser half. Decide whether captcha is on with `activeCaptcha(env)` (from
`louise-toolkit/auth`) on the server, pass its `siteKey` to the page, and render:

```ts
import { renderTurnstile } from "louise-toolkit/forms/turnstile";

const widget = await renderTurnstile(el, {
  siteKey,
  appearance: "interaction-only", // this widget only
});

// after ANY failed submit, not just a captcha failure:
widget.reset();
```

It loads Turnstile's script once and renders **explicitly**. Turnstile's automatic
mode scans the page once, when its script runs, so a widget created by a component
that hydrates later is never found. Explicit rendering works whichever loads first.
If the script doesn't load within `timeoutMs` (10 seconds by default), the promise
rejects, so the form can say so instead of submitting without a token.

The widget returns `{ token, reset, remove }`. The token also goes into the
enclosing form as `cf-turnstile-response`, so building `FormData` from the form
carries it. A token is **single-use**: a submit that fails for any reason, such as
validation or a 429, has still spent it. Call `reset()`, or the retry posts the spent
token and fails every time.

Set `appearance` here rather than in the Cloudflare dashboard. The dashboard's
invisible mode belongs to the site key, so it changes every form that shares the
key, sign-in included. Only the options you pass are sent. Add Turnstile's origins
to your CSP with `turnstileCsp()`.

### Importing Turnstile on its own

`louise-toolkit/forms/turnstile` exports `renderTurnstile`, `loadTurnstile`,
`turnstileCsp`, `TURNSTILE_SCRIPT_SRC` and `verifyTurnstileToken`, and needs no
other package. `louise-toolkit/forms` exports the same functions, but it also
carries `defineForm`, which needs the optional `drizzle-orm` peer. Import from
`forms/turnstile` on a sign-in page, in a CSP builder, or anywhere else without
a forms table.

## Notifications

```ts
function notifySubmission(config, values, mailer?): Promise<void>;
function renderSubmissionText(config, values): string;
```

`formRoute` fires these after a successful insert, off the response path. The
webhook POSTs `{ form, values }`; email uses a `mailer` you pass to `formRoute`.
A notification failure never fails the submission.

## Complex forms: TanStack adapter

```ts
function tanstackFormValidators(config): Record<string, ({ value }) => Promise<string | undefined>>;
function tanstackFieldValidator(
  key,
  field,
): (args: { value: unknown }) => Promise<string | undefined>;
```

Dependency-free validators in `@tanstack/solid-form`'s shape, backed by the same
`Rule` engine—so a complex hand-built form keeps one validation definition. The
consumer brings the peer.

**Wire them to `onChangeAsync`** (or `onBlurAsync` / `onSubmitAsync`), never
`onChange`. They are async by contract, and a promise-returning function in a sync
slot is stored as the promise—`meta.errors` then holds a pending `Promise`
instead of a string, so the message never renders and submit never disables. See
the [forms guide](/guide/forms/#complex-forms-tanstack-form).

## Catalog without new tables

For one-off forms (RSVP/waitlist/booking), store into the shared `submissions`
table ([`louise-toolkit/db`](/reference/db/)) via `formRoute`'s `genericTable` and
review each with [`submissionsRoute`](/reference/editor/)—no migration per form.
