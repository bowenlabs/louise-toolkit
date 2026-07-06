---
title: security
description: "louisecms/security — editor-HTML sanitizer, KV rate limiter, session-secret helper, and security headers."
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
} from "louisecms/security";
```

The security-critical primitives every Louise site shares — so a fix lands once
and protects every site. Each helper takes its binding explicitly, so a site
stays free to name bindings however it likes. No required peers (`ultrahtml` is
bundled).

## `sanitizeRichHtml(html)`

```ts
function sanitizeRichHtml(html: string): string;
```

Parser-based **allowlist** sanitizer for editor-authored rich text. Parses with
ultrahtml and rebuilds against a strict element + per-tag attribute allowlist,
scrubs `href`/`src` schemes and inline `style`, and strips any stray dangerous
token. The allowlist matches exactly what the [`client`](/docs/reference/client/)
ProseKit editor emits — run it on **write and render**.

```ts
const safe = sanitizeRichHtml(untrustedEditorHtml); // <script>, on*, javascript: … removed
```

`ALLOWED_TAGS` and `ATTR_ALLOW` are exported for composing a variant.

## `rateLimit(kv, key, limit, windowSec)` · `matchRateRule(rules, method, path)`

```ts
function rateLimit(
  kv: KVLike, key: string, limit: number, windowSec: number,
): Promise<{ ok: boolean; remaining: number; retryAfter: number }>;
```

A lightweight KV-backed **fixed-window** limiter for public POST surfaces. It
**fails open** — any KV error returns `ok: true`, so a limiter outage never takes
down sign-in. `windowSec` must be ≥ 60 (KV's minimum TTL). The *rules* are your
policy: define a `RateRule[]` and pass it to `matchRateRule`.

```ts
const rule = matchRateRule(RATE_RULES, request.method, url.pathname);
if (rule) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { ok, retryAfter } = await rateLimit(env.KV, `${rule.name}:${ip}`, rule.limit, rule.windowSec);
  if (!ok) return new Response("Too many requests", { status: 429, headers: { "retry-after": String(retryAfter) } });
}
```

## `getSessionSecret(secret, url, devSecret?)`

```ts
function getSessionSecret(secret: SecretBinding, url: URL, devSecret?: string): Promise<string>;
```

Reads the session-signing secret from a Cloudflare Secrets Store binding. On
`localhost` it returns `devSecret` (default `"louise-dev-secret"`) so the
sign-in → session loop works locally; any deployed hostname **fails closed**.

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
- `LouiseEnv` — the base binding contract (`SESSION_SECRET`) that [`auth`](/docs/reference/auth/)'s `LouiseAuthEnv` extends.
