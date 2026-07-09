---
title: Core concepts
description: The three ideas that shape every Louise API.
sidebar:
  order: 2
---

Three decisions run through the whole of Louise. Internalise them and the API
surface stops surprising you.

## 1. V8-native, no Node

Louise assumes a V8 isolate (workerd / Cloudflare Workers), not Node. It never
imports `node:*`, never assumes a filesystem, and expects Web-standard globals
(`fetch`, `crypto.subtle`, `Request`/`Response`). The commerce clients talk to
Stripe, Square, and Fourthwall with raw `fetch` and HMAC-verify webhooks with
`crypto.subtle` rather than pulling an SDK that assumes Node.

The one deliberately non-standard touch is `Error.captureStackTrace` in
[`errors`](/reference/errors/) — a real V8 engine feature that Louise
feature-detects (`if (Error.captureStackTrace)`) so it degrades cleanly
anywhere.

## 2. Bindings are injected, never imported

On Workers, bindings and secrets only exist at request time. So Louise takes
them as arguments:

```ts
db(env.DB); // not: db() that reaches for a global
enqueue(env.MY_QUEUE, msg); // not: enqueue(msg)
sendEmail(env.EMAIL, input);
```

This keeps every primitive:

- **Framework-agnostic** — Astro, Hono, or a bare Worker all call the same
  functions.
- **Testable** — pass a fake `Queue`/`EmailSender`/D1 and assert, no runtime
  mocking. (See the package's own `test/` suite.)
- **Schema-neutral** — `db()` hands you a Drizzle instance over _your_ schema.
  Louise ships exactly one opinionated table, `site_settings`, and it's opt-in.

## 3. Rich text is HTML, not JSON

The [rich-text editor](/guide/rich-text/) serializes to **HTML**, and the
site stores and renders that HTML directly (`set:html`). No ProseMirror ever
runs on the Worker; on load the editor re-parses the stored HTML.

The trade Louise makes is deliberate: HTML is trivially renderable server-side
with zero client JS, at the cost of needing a **parser-based sanitizer** on the
write path. Louise treats the sanitizer as the security boundary — a strict
per-tag attribute allowlist, `href`/`src`/`style` scrubbed — because stored HTML
is rendered verbatim.

## Edit mode

Editing is gated by **edit mode**, which a host app resolves per request
(typically a sticky cookie toggled by a query param) and exposes to templates.
Two facts matter:

- The page's edit mode controls whether _edit affordances render_.
- A separate, session-derived signal (e.g. `locals.editor`) controls whether
  _writes are trusted_. Never authorize a save on the page's edit mode alone.

Louise gives you the client and the field contract; **you own the auth**. The
[Auth & edit mode](/guide/auth-and-edit-mode/) guide walks the reference
implementation (Better Auth magic-link + passkeys), but any auth that can answer
"is this request an editor?" works.
