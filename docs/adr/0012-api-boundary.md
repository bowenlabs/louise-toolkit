# ADR 0012: API boundary—a deny-by-default inbound gate and one outbound client

- **Status:** Accepted (2026-09-23). **Amended 2026-09-23** at slice 2 (see _Amendment_ below): a gate in framework middleware declares public routes by path. **Amended 2026-09-26** (see _Amendment (2026-09-26, #557)_ below): `statusRoute` is the toolkit's third public route. **Amended 2026-09-26** (see _Amendment (2026-09-26, the rewrite route caps its input)_ below): the rewrite route caps its input, so one of the items out of scope here is done. **Amended 2026-09-27** (see _Amendment (2026-09-27, bearer tokens reach only a bearer route)_ below): a bearer token isn't a credential to the gate; it reaches only a route that declared it checks one. **Amended 2026-10-02** (see _Amendment (2026-10-02, Better Auth's limiter on `/api/auth`)_ below): sign-in endpoints get an address limiter, though `/api/louise/*` still doesn't. **Amended 2026-10-03** (see _Amendment (2026-10-03, captcha fails open or closed per control)_ below): a control chooses whether an unreadable captcha secret fails open or closed, and rate rules match every spelling of a path.
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0006 (keep `composeWorker`; suggested a `withEditorGuard` wrapper), ADR 0009 (MCP bearer tokens), ADR 0002 (realtime auth), ADR 0004 (edge cache); #492 and #494 (the fixes this review produced); epic #481

## Context

The question was whether Louise needs "an abstraction layer or a token gate" for data going in and out of the app. Before deciding, this review surveyed what already exists.

**Inbound, the auth model is right, but opt-in.** Every editor route factory calls `guardEditor` (same-origin check on writes plus a resolved editor session), and all of them do. The three client sites also mount 38 of their own routes under `/api/louise/*`, and every one of them is guarded as well. So `/api/louise/*` is, in practice, editor-only, except for two deliberate public routes: `formRoute` (`/api/louise/forms/<name>`) and `vitalsRoute` (`/api/louise/vitals`). Nothing enforces that, though. Each route opts in, and a route that forgets to is open. ADR 0006 recorded the repetition and left `withEditorGuard(routes)` as an optional follow-up.

**The middleware doesn't see the API.** `composeWorker` runs its routes before Astro. On the two client sites whose worker entry Astroid generates, `/api/louise/*` responses never pass through `createLouiseMiddleware`: they get no security headers, and no rate-limit rule can match them. Astroid knows about this for rate limiting (`rate-rules.ts` leaves out the contact form because "a rule here would never fire"). The same gap applies to headers, and nothing records that. The third client site mounts the same factories as Astro API routes through `runEditorRoute`, so there the middleware does apply. Which protections a request gets depends on how the site happened to mount the route.

**Outbound, there is no shared client.** Square (`sqFetch`), Fourthwall (`fwFetch`, `sfGet`), Stripe (`stripePost`), Turnstile, content webhooks, and form-notify webhooks each call `fetch` directly. None sets a timeout or a redirect policy. Upstream error text (Square's `detail`, up to 200 characters of a Fourthwall body, Stripe's message) goes into `Error.message`, and at least one route (the sandbox's `/api/checkout`) sends that straight to the browser. The two places that fetch a URL someone typed in (content webhooks, the image proxy) each wrote their own checks. The webhook one relies on a hostname regular expression and a comment claiming `global_fetch_strictly_public` is set; it isn't set in either Worker's `wrangler.jsonc`.

**Output has no serialization layer.** Routes return rows. That's fine when a table only holds editor content. It wasn't fine for `editorsRoute`, which sits on Better Auth's `user` table and listed every customer (#494).

All of the holes this review found (#492, #494) are instances of these three patterns. Fixing them one by one leaves the patterns in place.

## Decision

### 1. No token gate for browser traffic

The browser authenticates with an `HttpOnly` session cookie, and writes are protected by the same-origin check. That's the right model, and a token in front of it would make things worse. A token the browser can read is a token XSS can steal, while an `HttpOnly` cookie isn't. A token in `localStorage` also trades CSRF protection, which the toolkit already has, for exposure to XSS, which it would then have to defend against too.

Bearer tokens are for callers that aren't browsers. The first one is the MCP server (ADR 0009, slice 3). They plug into the same gate as a second kind of credential (see §2), not as a separate layer.

### 2. Inbound: one gate, deny by default under `/api/louise/`

A new core function, `louiseApiGate`, becomes the one place where "is this request allowed into the API at all" is decided. It's framework-agnostic and lives in `louise-toolkit/worker`. Two callers use it:

- `composeWorker({ gate: { resolveEditor } })` runs it before any route under the protected prefix.
- `createLouiseMiddleware` in `@louise-toolkit/astro` runs it for sites that mount routes as Astro API routes, so both mounting styles get the same boundary.

**Deny by default.** A request under `/api/louise/` must resolve to an editor unless it matches a route that declared itself public. Unknown paths get 401 before they can get 404, so an anonymous caller can't enumerate routes.

**The route declares itself public; there is no path list.** `publicRoute(route)` marks a `WorkerRoute`, and `formRoute` and `vitalsRoute` return marked routes. A site's own public route under the prefix has to be wrapped explicitly. This ADR rejects a configured list of public paths, because a list drifts away from the code and the factory is what knows whether it's public. For requests under the prefix, `composeWorker` tries marked routes first, then gates, then tries the rest. The public paths don't overlap any guarded path, so running them first changes no matching.

**What the gate checks:**

- An editor session resolves.
- **Cookie credentials** must pass the same-origin check on any unsafe method, **and on a WebSocket upgrade**. The upgrade is a `GET`, so checking by method alone would skip it and allow cross-site WebSocket hijacking of `realtimeRoute`.
- **Bearer credentials** (`Authorization` header, ADR 0009) skip the same-origin check, because a browser can't attach them to a cross-site request. The skip depends on which credential authenticated the request, never on whether `Origin` is missing. A request that carries a session cookie gets cookie rules even if it also carries a token.

**The per-route guards stay: two layers, not one.** Removing `guardEditor` from the factories would break `runEditorRoute`, which runs a factory without `composeWorker`. ADR 0006 made that portability a hard constraint. The routes also need the `EditorSession` itself for attribution and for access functions. So the gate answers "may this request enter the API", and the route answers "may this editor do this". The gate memoizes `resolveEditor` per `Request` (a `WeakMap`), so the second check doesn't cost a second session lookup.

**Headers.** `composeWorker` applies `louiseSecurityHeaders` to every response a route returns, without overwriting a header the route already set (the image proxy sets its own CSP). It skips `101 Switching Protocols`, because a WebSocket response can't be rewrapped. Gated responses also get `Cache-Control: no-store` unless the route set its own, so an editor's JSON can't land in a shared cache.

**Rate limiting stays out of the gate.** Astroid's reasoning holds: an IP limiter on editor routes can lock the owner out of their own studio. The real cost risk is the AI routes (`aiRoute`, `/generate-alt`), and the right tool there is a per-editor quota inside the route, keyed on the editor id. That's follow-up work, not part of this boundary.

**It's opt-in in the toolkit and always on in Astroid.** The toolkit is the unopinionated layer, so `gate` is an option, and a hand-written `composeWorker` without it behaves as it does today. Astroid's generated worker and middleware always pass it, which is where the opinion belongs. The toolkit docs present the gate as the way to mount editor routes, not as an extra.

### 3. Outbound: `upstreamFetch`, and `fetchPublicUrl` for URLs a user supplied

These go in `louise-toolkit/security`, with no dependencies.

**`upstreamFetch(input, { provider, timeoutMs?, ...init })`** is the one way the toolkit calls a third-party API:

- **Timeout.** The default is 10 s, using `AbortSignal.timeout`, combined with the caller's own signal through `AbortSignal.any`.
- **`redirect: "manual"` by default.** Provider APIs don't redirect. A 3xx from one is an error, not something to follow.
- **Errors are safe to show.** A non-2xx becomes an `UpstreamError { provider, status, code, retryable }` whose `message` can be shown to a user (for example "Square request failed (404 NOT_FOUND)"). The raw upstream body goes on a `detail` property, for logs only. The rule: a route never puts an upstream error's `detail` or `message` into its response without mapping it first. `SquareApiError` becomes a subclass and keeps its `status` and `code`.
- **It never logs request headers,** since that's where credentials live.

`sqFetch`, `fwFetch`, `sfGet`, `stripePost`, Turnstile verification, content webhooks, and form-notify all move onto it. Bindings (Workers AI, Email) aren't `fetch`, so they're out of scope.

**`fetchPublicUrl(url, opts)`** is `upstreamFetch` plus a URL policy, for any URL that came from a user or from content:

- https only, default port only;
- no IP-literal hosts (v4, v6, or v4-mapped v6), no single-label names, no `localhost`, `.local` or `.internal`;
- not the site's own zone unless the caller allows it;
- redirects are followed manually, at most 3 hops, and every hop is checked against the same policy.

**The threat model, stated accurately so the next comment doesn't get it wrong.** A Worker's `fetch` runs on Cloudflare's network, not inside the site's own private network, so the classic "reach the metadata service" SSRF isn't the main risk here. The main risks are:

1. **The site's own zone.** Without `global_fetch_strictly_public`, a Worker's fetch to its own zone goes straight to the origin, skipping the WAF and any Worker mapped to that URL (Cloudflare compatibility-flag docs). Neither of the toolkit's reference Workers has the flag on today, despite what the comment in `content/webhooks.ts` says. They get it, Astroid's generated `wrangler.jsonc` gets it, and the comment gets corrected (rollout slice 5).
2. **Authenticated endpoints elsewhere**, reached using the site's standing as the requester.
3. **Redirects** from an allowed host to anywhere, which the proxy fix (#492) closed for one route and this closes for all of them.

The image proxy keeps its stricter exact-host allowlist. `fetchPublicUrl` is the floor for URLs that can't be allowlisted, not a replacement for an allowlist.

### 4. Output: a rule, not a layer

This ADR adds no DTO or serializer layer. Most editor routes return editor-owned rows to an editor, and a mapping layer would duplicate every schema for no gain. The rule is narrower: **a route that reads a table which can hold rows the caller shouldn't see selects explicit columns and filters on them.** That means the Better Auth `user` table, and any table shared with customers. `editorsRoute` in #494 is the example. If the rule gets broken again, it becomes an ast-grep rule (`SELECT *` against a Better Auth table name).

## Considered and rejected

- **A token gate or API gateway in front of the whole app.** It would weaken browser auth (see §1) and duplicate the session check the routes already need.
- **Moving auth entirely into the gate and deleting the per-route guards.** That breaks `runEditorRoute` (ADR 0006) and loses defense in depth. Two layers is the point.
- **Hono middleware for the gate.** ADR 0006 already evaluated this. It needs the gate function either way, and the dependency buys nothing here.
- **A configured public-path list.** It drifts from the code. The factory that is public says so.
- **An IP rate limiter on `/api/louise/*`.** It risks locking the owner out, and it doesn't address the real risk, which is per-editor spend on AI routes.

## Consequences

- `/api/louise/*` becomes editor-only by construction. Today that's only true because every route remembered, and 38 site routes plus about 15 factories show the convention holds, so turning the gate on changes no current behavior. A future route that forgets its guard is denied instead of open.
- A site with its own deliberately public route under `/api/louise/` (none exist today) has to wrap it in `publicRoute`, or it starts returning 401. The changeset has to say this plainly.
- Route responses on the two Astroid-generated sites get the security headers and `no-store` they were missing.
- Provider failures stop leaking upstream text to browsers, and a slow provider can no longer hold a request open indefinitely.
- `WorkerRoute`, `runEditorRoute`, and `dependencies: {}` are unchanged.
- The bearer path of ADR 0009 now has a defined home: a second credential kind in `louiseApiGate`, with the cookie-vs-token rule from §2. ADR 0009 §5 gets an amendment pointing here when slice 3 lands.

## Rollout

Each slice is one PR, shipped `minor` with an upgrade note.

1. **`louiseApiGate` + `publicRoute` + `composeWorker({ gate })`**, with `formRoute` and `vitalsRoute` marked. Includes headers and `no-store`. Tests: an unguarded factory behind the gate is denied, a WebSocket upgrade is origin-checked, a public route still answers anonymously, and an unknown path returns 401, not 404.
2. **`createLouiseMiddleware` runs the gate** for Astro-mounted routes.
3. **Astroid turns it on** in the generated worker and middleware (astroidjs repo). Then the three client sites pick it up through the normal upgrade.
4. **`upstreamFetch` + `UpstreamError`**, then move each provider client onto them, one provider per commit. Stop the sandbox echoing upstream errors.
5. **`fetchPublicUrl`**, move content webhooks and form-notify onto it, and turn on `global_fetch_strictly_public` in the reference Workers and Astroid's template.

## Amendment (2026-09-23, at slice 2)

§2 says "the route declares itself public; there is no path list". That holds for `composeWorker`, which sees a `publicRoute` mark before the route runs. **It can't hold in framework middleware.** `createLouiseMiddleware({ apiGate })` runs before Astro knows which route file answers, so there is no route to read a mark from. There, a public route is declared by path:

- The toolkit's own public routes are exempt at their **default** paths. `louise-toolkit/worker` exports those paths (`LOUISE_FORMS_PATH`, `LOUISE_VITALS_PATH`, `isLouisePublicPath`), and `formRoute` and `vitalsRoute` build their defaults from the same constants, so the exemption and the route can't drift apart. That was the objection to a path list in the first place.
- A site's own public Astro route under the prefix goes in `apiGate: { isPublic }`. It's a site-side list, and it can drift like any list. The cost is bounded: none of the three sites has such a route today, and a missed entry fails closed (401), not open.

Two smaller points the slices settled:

- **Order in the middleware.** The gate runs right after the editor is resolved and before `extend`, `guard`, and `rewrite`: it needs only the editor, and a refused request shouldn't pay for the site's extra work. If `resolveEditor` throws, pages still degrade to public rendering as before, but the API fails closed.
- **Behind both layers.** On a `composeWorker` site whose middleware also sets `apiGate`, the middleware check is a second pass over requests the worker already let through. It costs nothing, because the middleware resolves the editor on every request anyway.

## Amendment (2026-09-26, #557)

The toolkit now has a third public route: `statusRoute`, which answers `GET` and `HEAD` at `/api/louise/status` with 200 or 503 for a probe outside Cloudflare. It follows both rules above. It returns a route wrapped in `publicRoute`, and its default path, `LOUISE_STATUS_PATH`, joins the forms and vitals paths in `isLouisePublicPath`, so the middleware exemption and the route build from the same constant.

A public route that reports on the site's dependencies needs two limits the other public routes don't, and they belong to this boundary:

- **No error text.** The body carries each check's `ok` and, when the check knows it, an age in milliseconds. A check that throws is logged on the server and reported as `{ ok: false }`. This is §3's rule, that upstream error text never reaches a response, applied to a response anyone can read.
- **Bounded cost.** An anonymous caller can make the checks run, so each check has a timeout, the checks run at once, and `reuseMs` reuses a finished result within an isolate. Only the finished result is shared, never a run in flight, because a Worker ties a promise to the request that started it. The checks themselves are the site's to keep cheap, for example a `SELECT 1` that reads no rows.

It sets `Cache-Control: no-store` itself, because the gate adds that header only to gated responses.

## Amendment (2026-09-26, the rewrite route caps its input)

_Out of scope, tracked separately_ listed input-size caps on AI request bodies. The rewrite route has one now (#550):

- `POST /api/louise/ai/rewrite` refuses `text` longer than `REWRITE_MAX_CHARS` (1,536 characters) with a `413`, before the model runs, and the editor toolbar shows the response's `error`.
- The cap is sized from the rewrite's output cap (`REWRITE_MAX_TOKENS`, 512) at three characters per token, because a rewrite runs about as long as its input. It bounds spend, and it keeps a typical answer within the cap. A longer selection used to come back cut off and replace the passage with a fragment. The helpers now refuse a cut-off answer too (#466).
- The SEO route already bounded its prompt: `suggestSeo` sends at most `maxContentChars` (4,000) characters of the content. It doesn't refuse a longer body, because the page's opening is enough to suggest from.

Per-editor quotas on AI routes remain out of scope. A length cap bounds the cost of one call, not how many calls an editor makes.

## Amendment (2026-09-27, bearer tokens reach only a bearer route)

Decision 2 put the bearer path of ADR 0009 into `louiseApiGate` as a second
kind of credential. Building it (#235) showed that this would undo deny by
default. The gate's promise is that a route which forgot its own guard is
denied, not open. A gate that accepted any valid token would open every such
route to every token holder, including a read-only token scoped to one
collection, because the gate can't see what the token's scope covers. The
token's scope means something only to the route that reads it.

So a bearer token isn't a credential to the gate. **The route declares that it
takes one,** the same way a public route declares itself:

- `bearerRoute(route)` marks a `WorkerRoute` that verifies a bearer token
  itself. `mcpRoute` marks itself when it's given `resolveAgent`.
- For a request that carries `Authorization: Bearer`, `composeWorker` tries the
  marked routes after the public ones and before the gate. A marked route that
  matches owns the answer, including the 401 for a bad token. If none matches,
  the request goes through the gate with cookie rules, and a request with only
  a token is refused.
- Framework middleware can't see the mark, so it declares these by path:
  `apiGate.takesBearer` in `@louise-toolkit/astro`. It's off unless set, unlike
  the public paths: a public route is harmless by design, but a route that
  relies on the gate alone would be open to any request with a bearer header.

The cookie-versus-token rule in decision 2 stands, restated for where it now
lives: a request with a bearer token is authenticated by the token alone, and
its cookie is never consulted. The origin check is skipped for the token's
identity only, so it can never apply to a cookie's.

## Amendment (2026-10-02, Better Auth's limiter on `/api/auth`)

Decision 2 keeps rate limiting out of the gate, and _Considered and rejected_
turns down an IP limiter on `/api/louise/*`, because an address limiter on
editor routes can lock the owner out of their own studio. Both stand.
`getLouiseAuth` now turns Better Auth's own limiter on for every instance
unless `baseURL` is on `localhost` or `127.0.0.1`, which puts an address limiter
on `/api/auth`, the editor's sign-in included. Better Auth turns it on by itself
only when `NODE_ENV` is `production`, which a Worker never sets, so until now it
was off on every site.

**Why `/api/auth` is different.** Everything under `/api/louise/*` runs behind
a resolved editor session, so a limiter there counts only the owner's own
requests: it can block them and protects nothing. `/api/auth` is the one place a
stranger reaches with no session at all. The magic-link endpoint sends mail to
the address it's given, sign-in endpoints take guesses, and a customer instance
mails any address. A limit per address is what stops one caller from turning the
site into a mail cannon or a password oracle.

**The lockout risk, and its limits:**

- **The editor's budget is its own.** Better Auth keys a count on the client
  address and the path with `basePath` removed, so on its own it would count an
  editor at `/api/auth` and a customer instance at `/api/shop-auth` in one
  bucket. Customers asking for links on a shop's guest Wi-Fi would then spend
  the owner's budget. `getLouiseAuth` prefixes every key with the instance's
  host and `basePath`, so they don't.
- **The editor's budget is small but short.** Each address gets 5 magic-link
  requests a minute and 5 followed links a minute; passkey sign-in falls under
  the general 100 per 10 seconds. `handleAuthRequest` answers a link request
  for an address off the admin allowlist itself, so only a request naming an
  editor's address reaches the limiter. Someone on the owner's network who knows
  that address can still spend the link budget, but for a minute at a time.
- **A session isn't counted.** An owner already signed in keeps working: the
  editor reads the session on the server, which doesn't pass through the
  limiter, and `/api/louise/*` has no limiter at all.

**How the owner gets back in:** wait out the window, a minute at most, or sign
in from another network, such as a phone's mobile data. No site setting turns
the limiter off or changes its budgets.

**The address is `CF-Connecting-IP`.** Better Auth's default,
`X-Forwarded-For`, carries whatever the client sent ahead of the real address,
and a header with more than one address resolves to no address, so every such
request would share one bucket per path. That shared bucket is the lockout this
ADR worries about, open to anyone, so the factory reads the header Cloudflare
sets and overwrites.

## Amendment (2026-10-03, captcha fails open or closed per control)

The studio's captcha fails open, for the reason this ADR keeps limiters off
`/api/louise/*`: a control that can lock the owner out of their own studio is
worse than the abuse it stops. `activeCaptcha` answers `null`, meaning off, both
when Turnstile isn't provisioned and when the site key is real but the secret
can't be read: the binding is missing, holds the placeholder, or throws. A
broken secret then costs the sign-in its captcha, not the owner their access,
and the address limiter from the 2026-10-02 amendment still holds.

A pre-launch audit of a site found that choice copied to a payment form. A
checkout takes a card token from anyone, and the captcha is what stands between
a card-testing script and a run of authorizations. A deploy whose Secrets Store
binding broke would turn that captcha off without a word, leaving only a
per-address rate limit that fails open itself.

**Each control decides.** `resolveCaptcha(env, { devServer })` returns one of
three states: `off` (not provisioned), `on` with the site key and secret, or
`unavailable` (a real site key whose secret can't be read). It reports each
`unavailable` result as the `auth.captcha-unavailable` degrade. The caller
chooses what `unavailable` means:

| Control                                 | On `unavailable` | Why                                                                                                        |
| --------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Studio sign-in (`getLouiseAuth`)        | Fail open        | Locking the owner out is worse. Unchanged: it still reads `activeCaptchaSecret`.                           |
| A checkout, or any form that charges    | Fail closed      | A captcha that turns off without a word invites card testing. Refuse with a 503 and the degrade.           |
| A form that mails an address it's given | Fail closed      | It's a mail cannon without the captcha, and nobody's locked out of anything they own.                      |
| A customer sign-in link                 | The site decides | It mails any address, as above, but a site may prefer that customers can still sign in. Say so in its ADR. |

**The dev server is `off`, decided by a build-time flag.** The dev server reads
the real site key from the Wrangler config and has no Secrets Store, so it
would always be `unavailable`. The caller passes the build's own flag, such as
`import.meta.env.DEV`, rather than the toolkit testing the request's host: a
local preview of a build (`wrangler dev` on the built Worker) rewrites the host
to the route's zone, so a host test can't tell that preview from production.
A preview of a build is a build, so it fails closed like one, unless
`.dev.vars` sets the test site key.

**Existing exports keep their behavior.** `activeCaptcha`, `activeCaptchaSecret`,
`turnstileSecret`, and `turnstileSiteKey` still fail open, so nothing changes
for a site until it moves a control onto `resolveCaptcha`.

**Rate rules match every spelling of a path.** The same audit found a related
gap in the per-address limiter. Astro's default `trailingSlash: "ignore"` sends
`/api/checkout/` to the `/api/checkout` endpoint, but an exact rule tested the
raw path and missed it, so the slashed spelling had no limit at all.
`matchRateRule` now also tests each rule against `normalizeRatePath(path)`:
decoded with `decodeURI` until stable, duplicate slashes collapsed, and the
trailing slash removed. That matches what Astro 7 does before it routes, which
decodes the same way, collapses duplicate slashes, and ignores one trailing
slash. Testing the raw path as well keeps a rule written for a slashed path
working, so the change only ever adds matches.

## Out of scope, tracked separately

- Per-editor quotas on AI routes.
- Replay protection for Square and Fourthwall webhooks (no timestamp and no event-id dedupe in the verifier), and removing the signing secret from content-webhook queue messages.
- Realtime: re-checking the session on an open socket, and validating `slug`. ADR 0002 §Auth says `slug` is validated, and it isn't, so 0002 needs an amendment.
- ~~Input-size caps on AI request bodies.~~ Done for the rewrite route (#550); see _Amendment (2026-09-26, the rewrite route caps its input)_.
