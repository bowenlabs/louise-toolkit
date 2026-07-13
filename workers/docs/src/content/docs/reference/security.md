---
title: security
description: "louise/security — editor-HTML sanitizer, KV rate limiter, session-secret helper, and security headers."
sidebar:
  order: 10
---

```ts
import {
  sanitizeRichHtml,
  rateLimit,
  matchRateRule,
  getSessionSecret,
  louiseSecurityHeaders,
} from "louise/security";
```

The security-critical primitives every Louise site shares — so a fix lands once
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
ProseKit editor emits — run it on **write and render**.

```ts
const safe = sanitizeRichHtml(untrustedEditorHtml); // <script>, on*, javascript: … removed
```

Pass **`mediaBase`** (your `MEDIA_URL`) to additionally drop any `<img>` whose
`src` isn't served from that base — a pasted external hotlink is removed, while
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
**fails open** — any KV error returns `ok: true`, so a limiter outage never takes
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

## `getSessionSecret(secret, url, devSecret?)`

```ts
function getSessionSecret(secret: SecretBinding, url: URL, devSecret?: string): Promise<string>;
```

Reads the session-signing secret from a Cloudflare Secrets Store binding. On
`localhost` it returns `devSecret` (default `"louise-dev-secret"`) so the
sign-in → session loop works locally; any deployed hostname **fails closed**.

:::caution[Deployment assumption]
The `localhost` dev fallback keys off `url.hostname`. On a routed Cloudflare
Worker this is safe — Cloudflare routes by the real hostname, so `url.hostname`
is never attacker-controlled and is `localhost`/`127.0.0.1` only under
`wrangler dev`. If you run Louise **behind a proxy that forwards a client-set
`Host`**, don't rely on this: provision a real `SESSION_SECRET` for every
non-local environment (the fallback only triggers when the secret is
missing/empty *and* the hostname is local), or wire your own dev gate.
:::

## `louiseSecurityHeaders(response, opts)` · `rewriteCspStyleSrc(response, styleSrc)`

Applies the baseline transport/scope headers (HSTS, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, COOP) — a no-op on
`localhost`. `rewriteCspStyleSrc` rewrites only the `style-src` directive of an
existing CSP header (for Astro's inline island styles), leaving script hashes
intact.

```ts
const res = await next();
louiseSecurityHeaders(res, { hostname: url.hostname });
```

## Types

- `KVLike` — the `get`/`put` shape the limiter needs (a real `KVNamespace` satisfies it).
- `SecretBinding` — the `{ get(): Promise<string> }` Secrets-Store shape.
- `LouiseEnv` — the base binding contract (`SESSION_SECRET`) that [`auth`](/reference/auth/)'s `LouiseAuthEnv` extends.
