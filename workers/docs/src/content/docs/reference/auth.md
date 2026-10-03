---
title: auth
description: "louise-toolkit/auth—Better Auth setup: magic-link + passkey editor sign-in, behind one request-scoped factory."
sidebar:
  order: 9
---

```ts
import {
  getLouiseAuth,
  resolveEditorSession,
  handleAuthRequest,
  redirectWithCookies,
  requireEditor,
  requireEditorFromContext,
  safeNextPath,
  defaultResolveAdmins,
} from "louise-toolkit/auth";
```

The shared Better Auth setup for a Louise site: magic-link + passkey editor
sign-in (allowlist-gated), optional customer sign-in by password or by magic link,
and captcha, behind one **request-scoped** factory. Framework-agnostic—you wire the helpers into
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
Auth signs callback URLs and binds the passkey `rpID` against it)—derive it
from the request, so a multi-tenant deployment gets the correct origin-bound
relying party per tenant. Better Auth 1.5+ speaks D1 natively; the binding is
passed straight to `database` (no adapter). The factory turns off Better Auth's runtime schema
check (`advanced.database.validateSchema: false`): the check caches per
instance, and an instance lives for one request, so it would read D1's schema on
every request. Keep the auth tables right with the
[schema generator](#generating-the-auth-schema) and your migrations instead.

Two guarantees hold on every instance, whatever route serves it:

- **Magic links go only to the allowlist, unless customers sign in by link.**
  The instance sends a sign-in email only to an address `resolveAdmins` returns.
  A customer portal mounted on its own `basePath` with `resolveAdmins: () => []`
  sends none, so nobody can use it to mail sign-in links, or create accounts past
  `disableSignUp`. Setting `customers.signIn: "magic-link"` lifts this on purpose;
  see [Customers who sign in by link](#customers-who-sign-in-by-link).
- **`SESSION_SECRET` must be real.** Off `localhost`, a missing, empty, or
  `DUMMY_REPLACE_ME` value throws rather than signing sessions with a known key.

### `LouiseAuthConfig`

| field                  | purpose                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpName`               | passkey relying-party display name                                                                                                                                                                                                                                |
| `rpID?`                | passkey relying-party **domain**. Defaults to the request origin's hostname; pin it to the apex so one passkey covers an admin subdomain too—see below                                                                                                            |
| `mailFrom`             | `from` for the magic-link email                                                                                                                                                                                                                                   |
| `renderMagicLinkEmail` | render the email body (site branding)                                                                                                                                                                                                                             |
| `resolveAdmins?`       | Site Admin allowlist; defaults to `OWNER_EMAIL` + `ENGINEER_EMAIL` from env. A platform passes a per-tenant `tenant_admins` lookup                                                                                                                                |
| `customers?`           | enable customer sign-in (omit for an admin-only editor). `signIn` is `"password"` (default) or `"magic-link"`; see [Customers who sign in by link](#customers-who-sign-in-by-link). `adminEndpoints` defaults to `false`; see [Admin endpoints](#admin-endpoints) |
| `additionalFields?`    | extra Better Auth user columns (for example, `squareCustomerId`)                                                                                                                                                                                                  |
| `tablePrefix?`         | namespace the auth tables in the same D1 (for example, `"auth_"`); must match the value passed to the [schema generator](#generating-the-auth-schema). Omit for default table names                                                                               |
| `session?`             | lifetime overrides (default 45-day rolling, daily refresh)                                                                                                                                                                                                        |
| `sessionCacheKv?`      | cache sessions in KV (`secondaryStorage` + `storeSessionInDatabase`); omit for D1-only                                                                                                                                                                            |
| `verificationStorage?` | where single-use values (magic links, resets) are consumed from; defaults to `"database"`                                                                                                                                                                         |
| `rateLimitDo?`         | Durable Object namespace where Better Auth's rate limiter counts. The limiter is on for every instance off `localhost` either way; see [Rate limiting](#rate-limiting)                                                                                            |
| `waitUntil?`           | the runtime's `waitUntil`; sends magic-link email after the response, so the endpoint's timing doesn't show whether it mailed                                                                                                                                     |
| `extraPlugins?`        | additional Better Auth plugins                                                                                                                                                                                                                                    |

```ts
// src/lib/auth.ts
import { getLouiseAuth } from "louise-toolkit/auth";
import { magicLinkEmail } from "./emails";

export const getAuth = (env: Env, baseURL: string) =>
  getLouiseAuth(env, baseURL, {
    rpName: "My Studio",
    mailFrom: { email: env.MAIL_FROM, name: "My Studio" },
    renderMagicLinkEmail: magicLinkEmail,
  });
```

Magic-link and passkey are always on. The `admin` plugin is on for an editor
instance and off for a customer instance unless it sets
`customers.adminEndpoints`; see [Admin endpoints](#admin-endpoints). Captcha
(Turnstile) mounts only when both a real secret and a real site key are
configured. Better Auth's rate
limiter is on unless `baseURL` is on `localhost` or `127.0.0.1`; see
[Rate limiting](#rate-limiting).

### One passkey across an admin subdomain

`rpID` is derived from the request origin, which is right for a single-origin
site and wrong the moment an admin app lives on its own subdomain: `example.com`
and `studio.example.com` mint **two separate passkeys** for the same person, who
now enrols twice and picks the right one from a list.

Pin it to the apex and one credential authenticates on both, since a passkey
registered for a domain is usable on its subdomains:

```ts
getLouiseAuth(env, baseURL, {
  rpName: "My Studio",
  rpID: "example.com", // both origins, one credential
  cookiePrefix: "louise-studio", // …but its own session
  // …
});
```

**The sessions stay separate, and that is the point**—a shared credential is
not a shared login. The combination that makes this safe:

- **Host-only cookies.** No `Domain` attribute and `crossSubDomainCookies` off,
  which is the default. Widening the cookie to the parent domain would broadcast
  the admin session to every sibling subdomain—including untrusted tenant
  storefronts—which is the failure this option exists to avoid, not cause.
- **A distinct `cookiePrefix`** per instance, for the same reason two instances
  on one origin need one: otherwise the sessions collide.

`rpID` must be the origin's own domain or a parent of it—a browser rejects a
registration whose rpID is neither, so a typo fails at enrolment rather than
silently. It is a bare domain: no scheme, no port.

### Single-use values stay on D1

`verificationStorage` decides where a magic link or password-reset token is
stored and consumed. It only matters alongside `sessionCacheKv`; without a
secondary storage these always live in D1 anyway.

It defaults to `"database"`, and that default is a security one. Better Auth
requires the storage's `getAndDelete` to be **atomic**, so one of these values
cannot be consumed twice. Cloudflare KV has no atomic primitive, and its
cross-colo convergence widens the window further—two requests racing the same
magic link could both succeed. D1 is strongly consistent and deletes atomically,
so consuming from there closes it, and KV stays what it is good at here: a global
session read cache.

Pass `"secondary"` to restore the older behaviour. Take it only if you have
measured the extra D1 read on the verification path and decided it matters.

### Rate limiting

Better Auth's rate limiter is on for every instance, the editor's included,
except when the host in `baseURL` is `localhost` or `127.0.0.1`: the same check
that allows the dev session secret. `[::1]` and `*.localhost` don't count as
local, and neither does a fixed production `baseURL` in local dev, so derive
`baseURL` from the request. Better Auth enables the limiter by itself only when
`NODE_ENV` is `production`, which a Worker never sets, so `getLouiseAuth` turns
it on.

It counts per instance, client address, and path, and answers a request over
budget with a 429 and an `X-Retry-After` header. Each instance counts on its
own: customers asking for links at `/api/shop-auth` don't spend the editor's
budget at `/api/auth`, and two sites on one Worker don't share one. Better
Auth's default budgets:

| path                                       | budget             |
| ------------------------------------------ | ------------------ |
| `sign-in/magic-link`, `magic-link/verify`  | 5 a minute, each   |
| other `sign-in/*`, `sign-up/*`, `change-*` | 3 per 10 seconds   |
| everything else, including passkeys        | 100 per 10 seconds |

The address comes from the `CF-Connecting-IP` header, which Cloudflare sets and
overwrites. Better Auth's default, `X-Forwarded-For`, carries whatever the
client sent ahead of the real address, and when it holds more than one address
Better Auth puts every such request in one shared bucket per path. A request
with no `CF-Connecting-IP`, which only happens off Cloudflare, lands in that
shared bucket too.

People behind one address, such as a shop's guest Wi-Fi, share a budget. Four
of them signing in by password within 10 seconds get a 429 on the fourth try.
Wire your sign-in forms to show the 429 as "try again in a moment" rather than a
generic error. An owner who hits the limit waits out the window, a minute at
most, or signs in from another network. A session they already have keeps
working: the editor reads it on the server, and the limiter only counts requests
to `/api/auth` itself. ADR 0012's amendment says why `/api/auth` gets an address limiter
when `/api/louise/*` doesn't.

#### Where it counts

Setting `rateLimitDo` moves the count into a Durable Object, and rate limiting
stops going through KV entirely.

```ts
getLouiseAuth(env, baseURL, {
  // …
  sessionCacheKv: env.SESSIONS,
  rateLimitDo: env.RATE_LIMIT_DO,
});
```

A Durable Object is the only atomic counter on Workers. Without one, the
limiter counts in KV when `sessionCacheKv` is set, and otherwise in a map in
each isolate's memory. The KV counter has a read→write gap that undercounts
under a burst, and each isolate keeps its own map, so a burst spread across
isolates gets a budget in each. Cloudflare's native Rate Limiting binding is
permissive, eventually consistent and scoped **per location**—so an attacker
spread across colos gets one budget per colo. Fine for form spam, weak for
sign-in.

Your site owns the `DurableObject` subclass and the wrangler binding; see
[`createRateLimiter`](/reference/security/) for the shape.

## `resolveEditorSession(auth, request, editorRole?)`

```ts
function resolveEditorSession(
  auth: LouiseAuth,
  request: Request,
  editorRole?: string, // default "admin"
): Promise<EditorSession | null>;
```

Re-derives the editor session from the signed Better Auth session on every
request—edit access is never trusted from the client. Returns the editor when
the user holds the editor role, else null. Assign the result to `locals` in your
Astro middleware.

## Customers who sign in by link

`customers: { signIn: "magic-link" }` drops passwords for customers. The
instance mounts no password sign-in, sign-up, or reset endpoint, and its
magic-link endpoint mails any address that asks. Following a link signs the
person in, creating the account unless `customers.disableSignUp` is set, and the
link itself verifies the email. With sign-up closed, an address with no account
gets no email, and the response body is the same either way.

Because a stranger can make the site send mail, guard the endpoint:

- **Rate limiting.** Better Auth's limiter is on for every instance off
  `localhost`, and allows each address 5 link requests a minute; see
  [Rate limiting](#rate-limiting). Set `rateLimitDo` too; the KV and in-memory
  fallbacks undercount under a burst.
- **Turnstile.** The captcha guards `sign-in/magic-link` only when both a real
  secret and a real site key are set. With the test keys, which every Worker
  Preview gets, or with none, it's off and the endpoint mails whoever asks. Each
  such send off `localhost` logs an `auth.magic-link-no-captcha` degrade.
- **`waitUntil`.** Pass it, and the send leaves the response path. Without it,
  how long the endpoint takes shows whether it mailed, which tells a caller
  whether an address has an account when sign-up is closed.

Serve the instance with `auth.handler`, not `handleAuthRequest`: that gate admits
only admins, so it would turn every customer away.

For the sign-in page, [`SignInLinkForm`](/reference/client/#louise-toolkitclientsign-in)
asks for the link, reads the 429 the limiter answers with, and resets the
Turnstile widget after each request.

Accounts that already had a password keep their hash in the `account` table
(rows with `providerId = 'credential'`). Those people sign in by link to the same
account. To store no hash, delete those rows once you've switched.

## Admin endpoints

Better Auth's `admin` plugin serves user administration at
`<basePath>/admin/*`: listing, creating, and removing users, setting roles,
banning, and impersonation. The endpoints check only the session user's `role`.

An editor instance, with no `customers`, mounts them. A customer instance
doesn't: a request to `<basePath>/admin/list-users` gets a 404, whatever the
customer's role. Everything else the plugin did stays the same:

- The `role` and ban columns stay in the generated schema, and the session user
  still carries `role`.
- A new account still gets its role, and no one can set their own role or ban.
- A banned user still can't sign in, until the ban expires.

To mount the endpoints on a customer instance, set
`customers: { adminEndpoints: true }`, and make sure no customer row can hold an
admin role. Neither setting changes the schema, so switching needs no
migration.

## `handleAuthRequest(auth, request, admins)`

The Better Auth catch-all with the editor magic-link allowlist gate. A non-admin
magic-link request is rejected **before** Better Auth runs—no token, no mail,
no user row—and returns the same enumeration-safe response a real send does.
Use it in your `/api/auth/[...all]` route. `admins` is the resolved allowlist
(the same source `resolveAdmins` uses). The gate matches `sign-in/magic-link`
under any `basePath`, so it works the same for an instance mounted elsewhere.

Don't serve a customer instance with `customers.signIn: "magic-link"` through
it: the gate would turn every customer away. Use `auth.handler` for that
instance.

## `redirectWithCookies(from, location, status?)`

A redirect that carries every cookie a Better Auth response set. Use it in a
server-rendered route that calls the API with `asResponse: true` and then sends
the browser on, such as a sign-out link:

```ts
const result = await auth.api.signOut({ headers: request.headers, asResponse: true });
return redirectWithCookies(result, "/");
```

Sign-out expires three cookies at once. Copying them with
`headers.get("set-cookie")` joins them into one header, and the browser keeps
all but the first, so the visitor stays signed in. `status` defaults to 303.
Pass a `location` your route chose, or one checked with `safeNextPath`.

`auth.api.signOut` is part of the `LouiseAuth` type, with Better Auth's
signature for a response: `signOut({ headers, asResponse: true })` returns a
`Promise<Response>`. Call it with no cast. A route that built a sign-out
`Request` and passed it to `auth.handler` to get the same response can call it
directly instead.

## `requireEditor(ctx, mutation?)` · `isSameOrigin(request)`

```ts
function requireEditor(
  ctx: { request: Request; editor: EditorSession | null },
  mutation?: boolean, // default true
): Response | null;
```

Guard for editor-gated endpoints: a same-origin (CSRF) check on mutations plus a
resolved editor session. Returns an error `Response`, or null to proceed.

### From a framework context: `requireEditorFromContext(context, mutation?)`

Most routes have a framework context, not a bare request. Pass it straight
through—anything shaped `{ request, locals: { editor } }` fits, including an Astro
`APIContext` once `App.Locals.editor` is declared:

```ts
import { requireEditorFromContext } from "louise-toolkit/auth";

export const POST: APIRoute = async (context) => {
  const denied = requireEditorFromContext(context);
  if (denied) return denied;
  // context.locals.editor is the signed-in editor
};
```

`mutation` defaults to the request's method. A write (anything but `GET`, `HEAD`,
or `OPTIONS`) gets the same-origin check, and a read doesn't—a same-origin `GET`
from `fetch` usually carries no `Origin` header to check. Pass `true` for a `GET`
that has side effects. You don't need a site-local `guard.ts` wrapper.

### `safeNextPath(raw, fallback)`

Reduces a post-sign-in `?next=` target to a same-origin path, or returns
`fallback`. Never hand `next` to a redirect or `location.assign` unchecked: that's
an open redirect (`?next=https://evil.example`), and in a browser it can run script
(`?next=javascript:…`).

A regex over the raw string isn't enough. Browsers strip tabs and newlines and read
`\` as `/`, so `/%09/evil.example` becomes `//evil.example`, which is off-site. So
`safeNextPath` resolves `raw` with the WHATWG URL parser, the same algorithm the
browser applies, and returns the normalized path, query, and hash only if it stayed
on the origin.

```ts
const next = safeNextPath(url.searchParams.get("next"), "/account");
```

## Allowlist & Turnstile helpers

- `defaultResolveAdmins(env)`—`OWNER_EMAIL` + optional `ENGINEER_EMAIL`, lowercased.
- `isAllowedSignInEmail(admins, email)`—case-insensitive membership test.
- `activeCaptcha(env)`—whether captcha is on: `{ siteKey, secret }`, or `null` for
  off. It's one decision for the widget and the check. If they're decided apart, a
  site key that stops resolving renders no widget while the server still demands a
  token, and every sign-in fails. Render the widget with
  [`renderTurnstile`](/reference/forms/#the-widget-renderturnstileel-options).
- `turnstileSiteKey(env)`, `turnstileSecret(env)`, `activeCaptchaSecret(env, secret)`—the
  lower-level halves `activeCaptcha` combines.

When captcha is on, Better Auth's captcha plugin guards `/sign-in/magic-link`
and rejects any request without an `x-captcha-response` **header**. A token in
the request body doesn't count. Send the widget's token as that header from the
sign-in form:

```ts
const token = widget?.token();
await fetch("/api/auth/sign-in/magic-link", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token ? { "x-captcha-response": token } : {}),
  },
  body: JSON.stringify({ email, callbackURL: "/" }),
});
```

## Generating the auth schema

Better Auth doesn't ship hand-written table DDL—it _derives_ its tables (user,
session, account, verification, passkey, the admin `role`/ban columns, plus any
`additionalFields`) from the config. So Louise **always generates** the auth
migration rather than hand-rolling it, from the _same_ plugin set the runtime
factory uses—the committed schema can't drift from what `getLouiseAuth`
expects. One command:

```sh
# print to stdout, or write with --out
pnpm exec louise gen-auth-schema --out drizzle/0002_auth.sql
```

`gen-auth-schema` takes an optional `--config <path>` (a module default-exporting
an `AuthSchemaConfig`—`{ customers?, additionalFields?, tablePrefix? }`) so the
generated columns match your runtime `LouiseAuthConfig`. Point it at the site's
auth config (or a small module re-exporting its `additionalFields`/`customers`)
and the base tables come from Louise, the extra columns from your config:

```sh
louise gen-auth-schema --config ./src/lib/auth-schema.config.ts --out drizzle/0002_auth.sql
```

Then apply it like any Drizzle/D1 migration (`wrangler d1 migrations apply`).
Re-run the command whenever the auth config changes—never hand-edit the output.
The programmatic generator is also exported as
`generateAuthSchemaSql(config): string`.

### Upgrading Better Auth

Before you move a site to a new Better Auth minor, diff the site's migrated auth
tables against what `generateAuthSchemaSql` (or `louise gen-auth-schema`)
produces for the same config and `tablePrefix`. A column the runtime expects but
the database lacks doesn't fail the build or the type-check. It fails at request
time, when Better Auth reads the user, so every session lookup errors and
editors can't sign in. Add any missing columns in a migration before you deploy
the upgrade.

### Where the auth tables live

Two supported layouts, chosen per deployment. Both keep one database and one
migration stream—the difference is only a table-name namespace:

| Option                                  | Isolation | user↔content joins | Best for                                                                                |
| --------------------------------------- | --------- | ------------------ | --------------------------------------------------------------------------------------- |
| **A. Same D1, default names** (default) | low       | native SQL joins   | sites that join user↔content (customer↔order, `squareCustomerId`)—one owner, one stream |
| **B. Same D1, `auth_` prefix**          | medium    | still native joins | a visible auth boundary in one database, without a second DB                            |

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
instead of logging users out—worth it at multi-tenant scale, unnecessary for a
single editor.
:::
