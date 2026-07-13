---
title: auth
description: "louise/auth — Better Auth setup: magic-link + passkey editor sign-in, behind one request-scoped factory."
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
} from "louise/auth";
```

The shared Better Auth setup for a Louise site: magic-link + passkey editor
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
| `customers?`           | enable customer email/password (omit for an admin-only editor)                                                                |
| `additionalFields?`    | extra Better Auth user columns (e.g. `squareCustomerId`)                                                                      |
| `tablePrefix?`         | namespace the auth tables in the same D1 (e.g. `"auth_"`); must match the value passed to the [schema generator](#generating-the-auth-schema). Omit for default table names |
| `session?`             | lifetime overrides (default 45-day rolling, daily refresh)                                                                    |
| `sessionCacheKv?`      | cache sessions in KV (`secondaryStorage` + `storeSessionInDatabase`); omit for D1-only                                        |
| `extraPlugins?`        | additional Better Auth plugins                                                                                                |

```ts
// src/lib/auth.ts
import { getLouiseAuth } from "louise/auth";
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

The Better Auth catch-all with the editor magic-link allowlist gate. A non-admin
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

## Generating the auth schema

Better Auth doesn't ship hand-written table DDL — it *derives* its tables (user,
session, account, verification, passkey, the admin `role`/ban columns, plus any
`additionalFields`) from the config. So Louise **always generates** the auth
migration rather than hand-rolling it, from the *same* plugin set the runtime
factory uses — the committed schema can't drift from what `getLouiseAuth`
expects. One command:

```sh
# print to stdout, or write with --out
npx louise gen-auth-schema --out drizzle/0002_auth.sql
```

`gen-auth-schema` takes an optional `--config <path>` (a module default-exporting
an `AuthSchemaConfig` — `{ customers?, additionalFields?, tablePrefix? }`) so the
generated columns match your runtime `LouiseAuthConfig`. Point it at the site's
auth config (or a small module re-exporting its `additionalFields`/`customers`)
and the base tables come from Louise, the extra columns from your config:

```sh
louise gen-auth-schema --config ./src/lib/auth-schema.config.ts --out drizzle/0002_auth.sql
```

Then apply it like any Drizzle/D1 migration (`wrangler d1 migrations apply`).
Re-run the command whenever the auth config changes — never hand-edit the output.
The programmatic generator is also exported as
`generateAuthSchemaSql(config): string`.

### Where the auth tables live

Two supported layouts, chosen per deployment. Both keep one database and one
migration stream — the difference is only a table-name namespace:

| Option                                  | Isolation | user↔content joins | Best for                                                                 |
| --------------------------------------- | --------- | ------------------ | ------------------------------------------------------------------------ |
| **A. Same D1, default names** (default) | low       | native SQL joins   | sites that join user↔content (customer↔order, `squareCustomerId`) — one owner, one stream |
| **B. Same D1, `auth_` prefix**          | medium    | still native joins | a visible auth boundary in one database, without a second DB             |

**Default to A.** The sites have real user↔content joins, one owner, and one
migration history; a second boundary adds friction for little gain. Choose **B**
only when you want an explicit auth namespace cheaply:

```sh
louise gen-auth-schema --table-prefix auth_ --out drizzle/0002_auth.sql
```

The prefix must be a bare SQL identifier (`/^[A-Za-z_][A-Za-z0-9_]*$/`), and the
**same** prefix must be set on [`LouiseAuthConfig.tablePrefix`](#louiseauthconfig)
so the runtime queries the namespaced tables. The optional KV session cache
([`sessionCacheKv`](#louiseauthconfig)) is orthogonal and works under either
option.

## `LouiseAuthEnv`

Extends [`LouiseEnv`](/reference/security/) with the auth bindings your
`Env` should satisfy: `DB` (D1), `EMAIL`, `TURNSTILE_SECRET`,
`TURNSTILE_SITE_KEY?`, `OWNER_EMAIL?`, `ENGINEER_EMAIL?`.

:::note
Sessions default to **D1**. The KV cache (`sessionCacheKv`) is opt-in: it keeps
D1 authoritative (`storeSessionInDatabase: true`) so a KV TTL lapse recovers
instead of logging users out — worth it at multi-tenant scale, unnecessary for a
single editor.
:::
