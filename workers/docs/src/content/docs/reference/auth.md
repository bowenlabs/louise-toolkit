---
title: auth
description: "louisecms/auth — Better Auth setup: magic-link + passkey studio sign-in, behind one request-scoped factory."
sidebar:
  order: 9
---

```ts
import {
  getLouiseAuth,
  resolveEditorSession,
  handleAuthRequest,
  requireEditor,
  defaultResolveAdmins,
} from "louisecms/auth";
```

The shared Better Auth setup for a Louise site: magic-link + passkey studio
sign-in (allowlist-gated), optional customer email/password, and captcha, behind
one **request-scoped** factory. Framework-agnostic — you wire the helpers into
your Astro middleware and routes.

Peer dependencies: `better-auth`, `@better-auth/passkey`. Builds on
[`security`](/reference/security/) (`getSessionSecret`, `LouiseEnv`).

:::caution
Build the instance **per request**. The D1 binding and Secrets-Store secret only
exist at request time on Workers, so a module-level `betterAuth()` singleton
fails. `getLouiseAuth` is the factory; call it inside the handler.
:::

## `getLouiseAuth(env, baseURL, config)`

```ts
function getLouiseAuth(
  env: LouiseAuthEnv,
  baseURL: string,
  config: LouiseAuthConfig,
): Promise<LouiseAuth>;
```

Constructs the request-scoped auth instance. `baseURL` is the origin (Better
Auth signs callback URLs and binds the passkey `rpID` against it) — derive it
from the request, so a multi-tenant deployment gets the correct origin-bound
relying party per tenant. Better Auth 1.5+ speaks D1 natively; the binding is
passed straight to `database` (no adapter).

### `LouiseAuthConfig`

| field                  | purpose                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `rpName`               | passkey relying-party display name                                                                                            |
| `mailFrom`             | `from` for the magic-link email                                                                                               |
| `renderMagicLinkEmail` | render the email body (site branding)                                                                                         |
| `resolveAdmins?`       | admin allowlist; defaults to `OWNER_EMAIL` + `ENGINEER_EMAIL` from env. A platform passes a per-tenant `tenant_admins` lookup |
| `customers?`           | enable customer email/password (omit for an admin-only studio)                                                                |
| `additionalFields?`    | extra Better Auth user columns (e.g. `squareCustomerId`)                                                                      |
| `session?`             | lifetime overrides (default 45-day rolling, daily refresh)                                                                    |
| `sessionCacheKv?`      | cache sessions in KV (`secondaryStorage` + `storeSessionInDatabase`); omit for D1-only                                        |
| `extraPlugins?`        | additional Better Auth plugins                                                                                                |

```ts
// src/lib/auth.ts
import { getLouiseAuth } from "louisecms/auth";
import { magicLinkEmail } from "./emails";

export const getAuth = (env: Env, baseURL: string) =>
  getLouiseAuth(env, baseURL, {
    rpName: "My Studio",
    mailFrom: { email: env.MAIL_FROM, name: "My Studio" },
    renderMagicLinkEmail: magicLinkEmail,
  });
```

Magic-link + `admin` + passkey are always on; captcha (Turnstile) mounts only
when both a real secret and a real site key are configured.

## `resolveEditorSession(auth, request, editorRole?)`

```ts
function resolveEditorSession(
  auth: LouiseAuth,
  request: Request,
  editorRole?: string, // default "admin"
): Promise<EditorSession | null>;
```

Re-derives the editor session from the signed Better Auth session on every
request — edit access is never trusted from the client. Returns the editor when
the user holds the editor role, else null. Assign the result to `locals` in your
Astro middleware.

## `handleAuthRequest(auth, request, admins)`

The Better Auth catch-all with the studio magic-link allowlist gate. A non-admin
magic-link request is rejected **before** Better Auth runs — no token, no mail,
no user row — and returns the same enumeration-safe response a real send does.
Use it in your `/api/auth/[...all]` route. `admins` is the resolved allowlist
(the same source `resolveAdmins` uses).

## `requireEditor(ctx, mutation?)` · `isSameOrigin(request)`

```ts
function requireEditor(
  ctx: { request: Request; editor: EditorSession | null },
  mutation?: boolean, // default true
): Response | null;
```

Guard for editor-gated endpoints: a same-origin (CSRF) check on mutations plus a
resolved editor session. Returns an error `Response`, or null to proceed.

## Allowlist & Turnstile helpers

- `defaultResolveAdmins(env)` — `OWNER_EMAIL` + optional `ENGINEER_EMAIL`, lowercased.
- `isAllowedSignInEmail(admins, email)` — case-insensitive membership test.
- `turnstileSiteKey(env)`, `turnstileSecret(env)`, `activeCaptchaSecret(env, secret)` — the both-halves-real captcha activation gate.

## `LouiseAuthEnv`

Extends [`LouiseEnv`](/reference/security/) with the auth bindings your
`Env` should satisfy: `DB` (D1), `EMAIL`, `TURNSTILE_SECRET`,
`TURNSTILE_SITE_KEY?`, `OWNER_EMAIL?`, `ENGINEER_EMAIL?`.

:::note
Sessions default to **D1**. The KV cache (`sessionCacheKv`) is opt-in: it keeps
D1 authoritative (`storeSessionInDatabase: true`) so a KV TTL lapse recovers
instead of logging users out — worth it at multi-tenant scale, unnecessary for a
single studio.
:::
