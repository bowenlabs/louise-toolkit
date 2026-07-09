---
title: Auth & edit mode
description: How editing is gated — and why writes trust the session, not the page.
sidebar:
  order: 10
---

Louise ships the editor and the field contract; **you own authentication**. Any
auth that can answer "is this request an editor?" works. This guide describes one
concrete, secure approach as a baseline.

## Edit mode is a signal, not a permission

Edit mode is a **sticky cookie** the host app resolves per request (toggled by a
query param):

- `?louise` → enter edit mode (admins only) and set the cookie
- `?louise=off` → clear it

When an admin is in edit mode, middleware exposes two _separate_ facts to the
request:

- **`locals.editMode`** — the page renders edit affordances (markers, the bar).
- **`locals.editor`** — the save/media endpoints trust the write.

:::danger[The rule]
`locals.editor` — **not** the page's edit mode — is what authorizes a write. Edit
mode only decides whether affordances render; a save must be re-checked against
the session. Never authorize a write on edit mode alone.
:::

## An example auth setup (Better Auth)

In this example, login is at **`/louise`**, passwordless via **Better Auth
magic-link** delivered through Cloudflare Email Sending (Louise's
[`email`](/reference/email/) primitive). Notable choices:

- **Owner-allowlisted.** The auth route rejects any email that isn't the
  configured owner **before** Better Auth runs, returning an
  enumeration-safe response — so an anonymous caller can't relay magic links to
  third parties or mint user rows.
- **Passkeys** for fast re-entry after a one-time, session-gated enrollment;
  magic link remains the bootstrap/fallback.
- **Per-request construction.** Better Auth is built per request
  (`getAuth(env, baseURL)`) because bindings and the signing secret only exist at
  request time on Workers.
- **Rate-limited & captcha'd** public POSTs (sign-in, contact, checkout).

None of this is _in_ the `louisecms` package — it's the host app's
wiring. Louise's contribution is the `email` primitive the magic link rides on
and the client that only renders once your middleware says "editor".
