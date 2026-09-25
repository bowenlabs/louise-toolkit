---
title: security
description: "louise-toolkit/security—editor-HTML sanitizer, KV rate limiter, session-secret helper, and security headers."
sidebar:
  order: 10
---

```ts
import {
  sanitizeRichHtml,
  plainText,
  metaDescription,
  hasRichText,
  rateLimit,
  matchRateRule,
  getSessionSecret,
  readSecret,
  louiseSecurityHeaders,
  isNoindexHost,
  upstreamFetch,
  UpstreamError,
  upstreamLogLine,
  fetchPublicUrl,
  publicUrlProblem,
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

## Rich text as text

```ts
plainText(html, { maxPasses? }): string
metaDescription(html, { maxLength?, maxPasses? }): string | undefined
hasRichText(html): boolean
stripEmptyHeadings(html): string
```

Editor HTML ends up in places that **print** it rather than render it, and an
emptied field is still a truthy string. These four cover both. Each returns
text, not HTML. None of them sanitizes, so escape the result on output as you
would any string.

- **`plainText`** flattens markup to one line. Tags become spaces, so
  `<p>One</p><p>Two</p>` reads "One Two". Entities are decoded, including copy
  stored double-encoded (`&lt;p&gt;`). A literal `5 &lt; 6 and 7 &gt; 2` survives
  intact, because only tag-shaped text is removed.
- **`metaDescription`** is `plainText` clamped on a word boundary—160 characters
  by default, about where search results truncate. It returns `undefined`, not
  `""`, for markup-only input, so the caller falls back to a default instead of
  emitting `content=""`.
- **`hasRichText`** is `false` for leftovers such as `<h3></h3>`, `<p><br></p>`,
  and `<p>&nbsp;</p>`. It's `true` for any text, or for an image, video, iframe,
  or SVG with no text around it. Use it instead of a truthiness check before
  rendering a field.
- **`stripEmptyHeadings`** removes headings with nothing in them. A screen reader
  announces an empty one as a nameless heading. Run it on sanitized output:

```ts
const body = stripEmptyHeadings(sanitizeRichHtml(page.body));
```

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

### Allowing the bundled font: `allowCspDataFonts(response)`

Louise's theme inlines its brand font as a `data:` `@font-face` (see
[Fonts](/reference/theme/#fonts)), and every edit surface loads it. A strict
`font-src` blocks that. `allowCspDataFonts` adds `data:` to the response's
existing `font-src`. If the policy has no `font-src` but has a `default-src`,
it appends a `font-src` built from `default-src` plus `data:`, so nothing else
loosens. It's a no-op without a CSP header, when fonts are already
unrestricted, or when `data:` is already allowed.

The `@louise-toolkit/astro` middleware (`createLouiseMiddleware`) calls it on
every response, so a site that uses the middleware needs no `font-src` change.
Call it yourself only if you assemble responses without that middleware.

### Payment SDK origins

A payment SDK that mounts a card form can load its own stylesheet and fonts into
**your** page, not only into its iframe. Allowing its origin in `script-src`
alone isn't enough: the script loads, but the blocked stylesheet stops the card
form from mounting. Add the SDK's origins to `style-src` and `font-src` too.

For Square, `squareWebPaymentsCsp(options?)` from
`louise-toolkit/commerce/square-web` returns the origins per directive
(`script`, `style`, `frame`, `connect`, `font`). Merge each list into the
matching directive of your policy:

```ts
import { squareWebPaymentsCsp } from "louise-toolkit/commerce/square-web";

const square = squareWebPaymentsCsp({ wallets: true });
// square.style → style-src, square.font → font-src, and so on.
```

It allows both Square environments by default, because a CSP is usually fixed
at build time while the environment is a runtime secret. Pass
`environments: ["production"]` only when you compute the policy per request.

### Keeping preview hosts out of search: `isNoindexHost(hostname, options?)`

A preview deploy is a full copy of the site, so an indexed one competes with
production for its own content. `isNoindexHost` answers for a hostname:
`*.workers.dev` (Workers preview and version URLs) by default, plus any
`prefixes` you pass for your own conventions. Pass the answer as `noindex` to
send `X-Robots-Tag: noindex`:

```ts
louiseSecurityHeaders(res, {
  hostname: url.hostname,
  noindex: isNoindexHost(url.hostname, { prefixes: ["preview.", "studio."] }),
});
```

Send it from middleware, not from a page. A streamed page has already sent its
headers by the time page code runs, so a header set there is silently dropped.
`@louise-toolkit/astro`'s middleware takes a `noindex: (hostname) => boolean`
option for exactly this.

## `upstreamFetch(input, init)` · `UpstreamError`

```ts
function upstreamFetch(
  input: string | URL,
  init: RequestInit & {
    provider: string; // "Square", "Stripe": names the error
    timeoutMs?: number; // default 10 seconds
  },
): Promise<Response>;

class UpstreamError extends Error {
  provider: string;
  status: number; // 0 when no response arrived
  code: string | null; // the provider's code, when it's code-shaped
  retryable: boolean; // 429, 5xx, or no response
  detail: string | null; // the provider's own words: logs only
  operation: string | null; // "GET /v2/cards": the path, never the query
}
```

The one way the toolkit calls a third-party API. Every provider client
(Square, Fourthwall, Stripe, Turnstile) goes through it, and your own
integrations can too. It adds three things a bare `fetch` doesn't:

- **A timeout,** combined with any `signal` you pass. A request with no answer
  becomes an `UpstreamError` with status `0` and code `timeout` or `network`.
- **No redirects.** A provider API doesn't redirect, so a 3xx comes back as a
  non-ok response instead of being followed to a host nobody chose.
- **An error that's safe to show.** `message` names the provider, the status,
  and the provider's code, for example `Square request failed (404 NOT_FOUND)`.
  What the provider actually wrote is on `detail`, which is left out of
  `JSON.stringify(err)` and `{ ...err }`, so it can't end up in a response by
  accident.

A non-2xx is returned, not thrown, because each provider reports errors in its
own shape. Read the body with `readUpstreamBody(res)`: it never throws, unlike
`res.json()` on an HTML error page, whose `SyntaxError` quotes the page.

Log with `upstreamLogLine(err)`, which includes `operation` and `detail`, and
show users `message` or copy you map from `code`:

```ts
try {
  await createPayment(square, payment);
} catch (err) {
  console.error("payment failed:", upstreamLogLine(err));
  return Response.json({ error: "Payment failed. Please try again." }, { status: 502 });
}
```

## `fetchPublicUrl(input, init?)` · `publicUrlProblem(url, policy?)`

```ts
function fetchPublicUrl(
  input: string | URL,
  init?: RequestInit & {
    provider?: string; // names the error; default "Remote"
    timeoutMs?: number;
    maxRedirects?: number; // default 3
    allowHttp?: boolean; // default false
    blockHosts?: string[]; // ".example.com" matches the domain and subdomains
  },
): Promise<Response>;
```

`upstreamFetch` for a URL someone else chose: a webhook endpoint, a form's
notify target, anything from content or a config a user can edit. It refuses,
with a `BlockedUrlError`, any URL that:

- isn't https (unless `allowHttp`) on the default port;
- has a username or password in it;
- uses an IP address instead of a hostname, in any form the URL parser
  accepts (`2130706433` and `0x7f.1` both mean `127.0.0.1`);
- is a single-label name, `localhost`, or a private-network name such as
  `.local` or `.internal`;
- matches a host in `blockHosts`.

Every redirect hop is checked the same way. Only a `GET` or `HEAD` follows any
redirect. Other methods follow only a `307` or `308`, which keep the method and
body; a `301`, `302`, or `303` would turn a webhook `POST` into an empty `GET`
that "succeeds" with nothing delivered, so it's returned as the non-ok response
it is. A redirect to another origin drops `Authorization` and `Cookie`.

`publicUrlProblem(url, policy)` runs the same checks without fetching. It
returns the reason as a string, or `null` when the URL is allowed, so you can
validate a URL when someone saves it.

This checks the URL, not where its hostname resolves, because a Worker can't
look that up. Add your site's own hostname to `blockHosts`, and set the
`global_fetch_strictly_public` compatibility flag: without it, a Worker's
`fetch` to its own zone goes straight to the origin, skipping the WAF and any
Worker on that route.

## Types

- `KVLike`—the `get`/`put` shape the limiter needs (a real `KVNamespace` satisfies it).
- `SecretBinding`—the `{ get(): Promise<string> }` Secrets-Store shape.
- `LouiseEnv`—the base binding contract (`SESSION_SECRET`) that [`auth`](/reference/auth/)'s `LouiseAuthEnv` extends.
