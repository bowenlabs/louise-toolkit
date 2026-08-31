---
title: security
description: "louise-toolkit/security—editor-HTML sanitizer, KV rate limiter, session-secret helper, and security headers."
sidebar:
  order: 10
---

```ts
import {
  sanitizeRichHtml,
  rateLimit,
  matchRateRule,
  getSessionSecret,
  readSecret,
  louiseSecurityHeaders,
} from "louise-toolkit/security";
```

The security-critical primitives every Louise site shares—so a fix lands once
and protects every site. Each helper takes its binding explicitly, so a site
stays free to name bindings however it likes. No required peers (`ultrahtml` is
bundled).

## `sanitizeRichHtml(html, options?)`

```ts
function sanitizeRichHtml(html: string, options?: { mediaBase?: string }): string;
```

Parser-based **allowlist** sanitizer for editor-authored rich text. Parses with
ultrahtml and rebuilds against a strict element + per-tag attribute allowlist,
scrubs `href`/`src` schemes and inline `style`, and strips any stray dangerous
token. The allowlist matches exactly what the [`client`](/reference/client/)
ProseKit editor emits—run it on **write and render**.

```ts
const safe = sanitizeRichHtml(untrustedEditorHtml); // <script>, on*, javascript: … removed
```

Pass **`mediaBase`** (your `MEDIA_URL`) to additionally drop any `<img>` whose
`src` isn't served from that base—a pasted external hotlink is removed, while
media-hosted images are kept. Omit it to keep any safe `http(s)`/relative `src`
(the default). See [strict media](/guide/media/#strict-media-every-image-from-the-library).

`ALLOWED_TAGS` and `ATTR_ALLOW` are exported for composing a variant.

## `rateLimit(kv, key, limit, windowSec)` · `matchRateRule(rules, method, path)`

```ts
function rateLimit(
  kv: KVLike,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; remaining: number; retryAfter: number }>;
```

A lightweight KV-backed **fixed-window** limiter for public POST surfaces. It
**fails open**—any KV error returns `ok: true`, so a limiter outage never takes
down sign-in. `windowSec` must be ≥ 60 (KV's minimum TTL). The _rules_ are your
policy: define a `RateRule[]` and pass it to `matchRateRule`.

```ts
const rule = matchRateRule(RATE_RULES, request.method, url.pathname);
if (rule) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { ok, retryAfter } = await rateLimit(
    env.KV,
    `${rule.name}:${ip}`,
    rule.limit,
    rule.windowSec,
  );
  if (!ok)
    return new Response("Too many requests", {
      status: 429,
      headers: { "retry-after": String(retryAfter) },
    });
}
```

## `createRateLimiter(ctx)` · `durableRateLimitStorage(namespace)`

```ts
function createRateLimiter(ctx: DurableObjectState): RateLimiter;
function durableRateLimitStorage(ns: RateLimitNamespace): DurableRateLimitStorage;
```

The **atomic** limiter. A Durable Object handles one request at a time, so
read-decide-write inside it cannot race—unlike the KV limiter above, whose
read→write gap can undercount under a burst, and unlike Cloudflare's native Rate
Limiting binding, which is documented as permissive, eventually consistent, and
scoped **per location** (an attacker spread across colos gets one budget per
colo). That trade is fine for form spam and weak for sign-in.

Following the `realtime` and `workflows` pattern, your site owns the
`DurableObject` subclass and the wrangler binding; this module is the logic it
delegates to.

```ts
// worker.ts — your class, your binding
import { DurableObject } from "cloudflare:workers";
import { createRateLimiter } from "louise-toolkit/security";

export class RateLimitDO extends DurableObject<Env> {
  #rl = createRateLimiter(this.ctx);
  fetch(request: Request) {
    return this.#rl.fetch(request);
  }
  alarm() {
    return this.#rl.alarm();
  }
}
```

One object per key, so no single object becomes a bottleneck—a DO sustains
roughly 500–1,000 simple operations per second, which is a per-key ceiling rather
than a per-site one.

Fixed window, like the KV limiter: a client can reach up to ~2x the budget across
a boundary, the accepted cost of storing one number instead of a list of
timestamps. The window is never extended while blocking, or a client under
sustained load would never be let back in. An alarm reaps the counter once its
window passes, so a per-IP key does not hold storage forever.

**Fails open**, like the KV limiter: an unreachable object allows the request. A
limiter outage must never lock every editor out of their own site.

To put Better Auth's own rate limiting on it, pass the namespace as
[`rateLimitDo`](/reference/auth/) rather than wiring `consume` yourself.

## `readSecret(source, options?)`

```ts
type SecretSource = SecretBinding | string | null | undefined;

function readSecret(
  source: SecretSource,
  options?: { placeholder?: string | readonly string[] },
): Promise<string | null>;
```

Reads a secret and returns `null` whenever it isn't really configured: the
binding is absent, the Secrets Store isn't provisioned (a declared-but-unset
binding **throws** on `.get()`), the value is empty, or it still holds a
placeholder sentinel you name. Values are trimmed before the sentinel compare.

The point is that callers can **degrade**—skip the integration, run a
simulated path, leave a captcha off—instead of throwing or calling an upstream
API with a dummy credential:

```ts
const token = await readSecret(env.STRIPE_SECRET_KEY, { placeholder: "DUMMY_REPLACE_ME" });
if (!token) return simulatedCheckout(); // the feature is dormant, not broken
```

There is no built-in sentinel: the placeholder is the caller's convention, not
the package's. (Astroid layers its own `DUMMY_REPLACE_ME` convention on top—see `astroidjs`' `resolveModuleSecrets`.)

## `getSessionSecret(secret, url, devSecret?, options?)`

```ts
function getSessionSecret(
  secret: SecretSource,
  url: URL,
  devSecret?: string,
  options?: { placeholder?: string | readonly string[] },
): Promise<string>;
```

Reads the session-signing secret—from a Cloudflare Secrets Store binding or
the plain string a `wrangler secret put` produces. On `localhost` it returns
`devSecret` (default `"louise-dev-secret"`) so the sign-in → session loop works
locally; any deployed hostname **fails closed**.

Unlike `readSecret`, a missing session secret is an error, not a feature to
switch off. Pass `placeholder` if your scaffold seeds secrets with a sentinel—otherwise a placeholder that reached production would be treated as a valid
signing key.

:::caution[Deployment assumption]
The `localhost` dev fallback keys off `url.hostname`. On a routed Cloudflare
Worker this is safe—Cloudflare routes by the real hostname, so `url.hostname`
is never attacker-controlled and is `localhost`/`127.0.0.1` only under
`wrangler dev`. If you run Louise **behind a proxy that forwards a client-set
`Host`**, don't rely on this: provision a real `SESSION_SECRET` for every
non-local environment (the fallback only triggers when the secret is
missing/empty _and_ the hostname is local), or wire your own dev gate.
:::

## `louiseSecurityHeaders(response, opts)` · `rewriteCspStyleSrc(response, styleSrc)`

Applies the baseline transport/scope headers (HSTS, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, COOP)—a no-op on
`localhost`. `rewriteCspStyleSrc` rewrites only the `style-src` directive of an
existing CSP header (for Astro's inline island styles), leaving script hashes
intact.

```ts
const res = await next();
louiseSecurityHeaders(res, { hostname: url.hostname });
```

## Types

- `KVLike`—the `get`/`put` shape the limiter needs (a real `KVNamespace` satisfies it).
- `SecretBinding`—the `{ get(): Promise<string> }` Secrets-Store shape.
- `LouiseEnv`—the base binding contract (`SESSION_SECRET`) that [`auth`](/reference/auth/)'s `LouiseAuthEnv` extends.
