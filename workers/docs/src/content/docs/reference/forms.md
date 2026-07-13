---
title: forms
description: "louise/forms — declarative form definitions: derive the table, capture route, validation, and review columns from one definition."
sidebar:
  order: 12
---

```ts
import { defineForm, validateSubmission, tanstackFormValidators } from "louise/forms";
```

Define a form's fields **once**; derive the submission table, the public capture
route ([`formRoute`](/reference/editor/)), server + client validation, and the
review columns from that single definition. `inquiries` is the built-in default
form ([`louise/db`](/reference/db/)). Validation reuses the shared `Rule`
engine ([`cms`](/reference/cms/#validation)) — one definition, both sides. Peer:
`drizzle-orm`. See the [forms guide](/guide/forms/) for the full walk-through.

## `defineForm(config)`

```ts
function defineForm(config: FormConfig): FormDefinition;
```

Returns the config plus everything derived from it — the Drizzle `columns`/
`table` and the `reviewColumns` Louise Settings renders.

### `FormConfig` / `FormField`

| field                 | purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `name`                | form + table name (a bare SQL identifier, `^[A-Za-z_][A-Za-z0-9_]*$`)                |
| `fields`              | `Record<string, FormField>`                                                         |
| `spam?`               | opt-in anti-spam (below)                                                             |
| `notify?`             | `{ webhook?, email? }` — where a submission is announced                            |
| `submitLabel?`        | button label for the render helper (default `"Send"`)                              |

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
`verifyTurnstileToken`, fails closed), and two **silent** heuristics — `honeypot`
(a decoy field) and `minSeconds` (a too-fast-submit check vs the render helper's
`louise_ts`). `looksLikeSpam(config, body)` evaluates the silent pair.

```ts
function verifyTurnstileToken(secret: string, token: string | null, remoteIp?: string | null): Promise<boolean>;
```

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
function tanstackFieldValidator(key, field): (args: { value: unknown }) => Promise<string | undefined>;
```

Dependency-free validators in `@tanstack/solid-form`'s shape, backed by the same
`Rule` engine — so a complex hand-built form keeps one validation definition. The
consumer brings the peer.

## Catalog without new tables

For one-off forms (RSVP/waitlist/booking), store into the shared `submissions`
table ([`louise/db`](/reference/db/)) via `formRoute`'s `genericTable` and
review each with [`submissionsRoute`](/reference/editor/) — no migration per form.
