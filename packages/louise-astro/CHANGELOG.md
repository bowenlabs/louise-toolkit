# @louise-toolkit/astro

## 0.8.0

### Minor Changes

- This release requires `louise-toolkit` 0.42.0. The adapter pins the toolkit to an exact version, so it's a minor rather than a patch: a caret range on 0.7 doesn't pick it up and install a second toolkit beside the one your site or `astroidjs` resolves.

  **Upgrading:** bump `@louise-toolkit/astro`, `louise-toolkit`, and `astroidjs` together, then check that the lockfile holds one `louise-toolkit` version. The toolkit's 0.42.0 entry lists what's new; nothing existing changes.

### Patch Changes

- Updated dependencies [ca79f32]
- Updated dependencies [63b5cb8]
  - louise-toolkit@0.42.0

## 0.7.0

### Minor Changes

- This release requires `louise-toolkit` 0.41.0 and, through it, `better-auth` and `@better-auth/passkey` 1.7.7 or later. The adapter pins the toolkit to an exact version, so it's a minor rather than a patch: a caret range on 0.6 doesn't pick it up and install a second toolkit beside the one your site or `astroidjs` resolves.

  **Upgrading:** bump `@louise-toolkit/astro`, `louise-toolkit`, and `astroidjs` together, then check that the lockfile holds one `louise-toolkit` version. The toolkit's 0.41.0 entry lists what changes for a site.

### Patch Changes

- Updated dependencies [acaf805]
- Updated dependencies [62422f8]
- Updated dependencies [aa3129f]
- Updated dependencies [89d90b4]
- Updated dependencies [1329de4]
- Updated dependencies [9ad4bde]
  - louise-toolkit@0.41.0

## 0.6.5

### Patch Changes

- Updated dependencies [6b9312b]
- Updated dependencies [25e2a92]
  - louise-toolkit@0.40.0

## 0.6.4

### Patch Changes

- Updated dependencies [72934fb]
- Updated dependencies [8a0d83c]
  - louise-toolkit@0.39.0

## 0.6.3

### Patch Changes

- Updated dependencies [e075216]
- Updated dependencies [51569b8]
  - louise-toolkit@0.38.0

## 0.6.2

### Patch Changes

- Updated dependencies [2586cd0]
  - louise-toolkit@0.37.2

## 0.6.1

### Patch Changes

- Updated dependencies [d76677c]
  - louise-toolkit@0.37.1

## 0.6.0

### Minor Changes

- a209a23: An Astro site's page errors are incidents too (ADR 0022):

  - **`reportIncident(input)`** (`louise-toolkit/worker`) reports a failure caught in code that has no `env` or `ctx`, such as framework middleware. It reaches `composeWorker`'s `onIncident` sinks when the handler finishes, and does nothing without `onIncident`. A cause reported this way isn't counted again if it's re-thrown to `composeWorker`.
  - **`createLouiseMiddleware`** (`@louise-toolkit/astro`) reports an error a page, an endpoint, or the middleware throws, then re-throws it, so Astro still renders its error page. Before, Astro caught those errors outside every middleware and `composeWorker` never saw them. Set `reportErrors: false` to turn it off. An error a streamed page throws after its first bytes are sent is still out of reach of any middleware.

  Nothing changes for a site without `onIncident` on `composeWorker`.

- bbe2a20: An agent with no browser can call the MCP endpoint with a scoped, expiring agent token (#235).

  - **`mcpRoute` takes `resolveAgent`.** A request with `Authorization: Bearer` is authenticated by the token alone and skips the same-origin check; a request without one is unchanged. `resolveMcpSession({ resolveUser })` turns a token into the editor who issued it, with `session.agent` set to the token's ID, name, and scope.
  - **Tokens are scoped, expire, and revoke immediately.** A scope maps each collection to `read`, `draft`, or `publish`, and there's no default. A token lasts 30 days unless its issuer says otherwise, and at most 90. Only its SHA-256 is stored, and it starts with `louise_at_`.
  - **`agentTokensRoute`** at `/api/louise/mcp/tokens` lets a signed-in editor issue, list, and revoke their own tokens. A token can't manage tokens.
  - **`editorForUser(env, userId)`** in `louise-toolkit/auth` re-derives an editor from their user row. A token stops working when its editor isn't an admin, is banned, or has left the sign-in allowlist.
  - **`bearerRoute(route)`** in `louise-toolkit/worker` marks a route that checks a bearer token itself. `composeWorker`'s gate lets a bearer request through to marked routes only; everywhere else under the prefix it's refused as before.
  - **`apiGate.takesBearer`** in `@louise-toolkit/astro` does the same for the middleware gate, by path. It's off unless you set it.

  **Upgrading:** nothing changes until you pass `resolveAgent`. To turn tokens on, export `agentTokens` from `louise-toolkit/mcp` in your Drizzle schema, generate and apply the migration that creates `agent_tokens`, and mount `agentTokensRoute`. With the Astro middleware gate, also set `apiGate.takesBearer: (path) => path === LOUISE_MCP_PATH`. If your auth uses `tablePrefix` or `resolveAdmins`, pass the same to `editorForUser`. The reasoning is in the 2026-09-27 amendments to ADR 0009 and ADR 0012.

### Patch Changes

- Updated dependencies [18d8f80]
- Updated dependencies [a209a23]
- Updated dependencies [e0663dd]
- Updated dependencies [a3423b6]
- Updated dependencies [39d9f27]
- Updated dependencies [0ba0640]
- Updated dependencies [cf12fbd]
- Updated dependencies [1fc869c]
- Updated dependencies [b0d2e37]
- Updated dependencies [0786a5b]
- Updated dependencies [81a71d5]
- Updated dependencies [bbe2a20]
- Updated dependencies [4e0702d]
- Updated dependencies [9fcda28]
- Updated dependencies [265e50c]
- Updated dependencies [348af4f]
- Updated dependencies [6998d43]
- Updated dependencies [a23b35a]
- Updated dependencies [dffa94e]
- Updated dependencies [df7b551]
- Updated dependencies [0ae20ab]
  - louise-toolkit@0.37.0

## 0.5.0

### Minor Changes

- 76c5baa: Form fields accept a web address without a scheme and, under the form's locale, a number with grouping separators (#594).

  - **`url`:** `example.com` or `www.example.com/menu` gains `https://` before the check, and the normalized value is what's stored.
  - **`number`:** `FormConfig.locale` (new, no default) makes a number read that locale's grouping and decimal separators, so `1,200` is 1200 in `en-US` and `1.200,5` is 1200.5 in `de-DE`. Without a locale, nothing changes: a comma is a decimal point in some locales, so it isn't guessed.
  - **Messages say what works:** "Enter a web address, like example.com." and "Enter a number, like 1200." replace "`<key>` must be a valid URL" and "`<label>` must be a number".
  - **`<Form>` renders a number as a text input** with `inputmode="decimal"`, since `type="number"` drops `1,200`, adds spinners, and changes on a scroll.
  - **`coerceFormValue(field, raw, { locale })`** and `tanstackFieldValidator(key, field, { locale })` take the locale; `tanstackFormValidators` passes the form's.
  - **`formToAstroSchema`** (`@louise-toolkit/astro`) runs the same coercion first, so an Astro Action accepts what `formRoute` accepts, with the same two messages.

  **Upgrading:** set `locale` on a form whose `number` fields should accept separators. A test that matched the old messages needs the new ones, and a stylesheet that targeted `input[type="number"]` in a `<Form>` needs `input[inputmode="decimal"]`.

### Patch Changes

- Updated dependencies [f1706b3]
- Updated dependencies [0d7666c]
- Updated dependencies [76c5baa]
- Updated dependencies [b8252ca]
- Updated dependencies [4a234fe]
- Updated dependencies [1e95091]
- Updated dependencies [20a09e9]
- Updated dependencies [865521e]
- Updated dependencies [8875199]
- Updated dependencies [4892c0a]
- Updated dependencies [a588c28]
- Updated dependencies [b901cbe]
- Updated dependencies [645efd5]
- Updated dependencies [0f773fd]
- Updated dependencies [f4c99d5]
- Updated dependencies [d893984]
  - louise-toolkit@0.36.0

## 0.4.0

### Minor Changes

- 9ffe693: `createLouiseMiddleware` takes an optional `redirectFor(path, context)` (#574). When a GET or HEAD answers 404, the middleware asks it where the path moved and answers with that redirect instead, keeping the visitor's query string. A live page always wins, since it's only asked after a 404, and a lookup that throws keeps the 404. Pair it with `resolvePageRedirect` and the `pageRedirects` table from `louise-toolkit/db`.
- c241310: `louiseSaveDraftAction` takes an optional `base`, the field revisions a draft save started from (#572), and returns the saved fields' `revs`. A save whose `base` is stale for a field someone else changed returns `{ conflicts }` rather than throwing, because a rejected Action reaches the client only as an error, which can't carry the current values the owner chooses between. If your site wraps the Action for `mountLouise({ actions })`, resolve with its result as before and the editor shows the conflict.
- fa3f05d: `louiseSaveDraftAction` takes an optional `softLocks`, as `versionsRoute` does (#572). A save that changes a field another editor holds in the realtime session returns `{ locked }` as data rather than throwing, the same way a conflict returns `{ conflicts }`, and the editor shows it. Pass `realtimeSoftLocks` from `louise-toolkit/realtime`.
- bd15917: `seoHead(Astro, input)` prints a page's head tags from `louise-toolkit/seo`'s `pageHead`, with the origin and path taken from the request (#582). The origin is `input.origin`, then the `site` in `astro.config`, then the request's own origin, so set `site` to keep a preview host out of the canonical URL. Print the result inside `<head>` with `<Fragment set:html={…} />`. It needs the `louise-toolkit` release that adds `louise-toolkit/seo`.

### Patch Changes

- dd1e803: The docs moved to [docs.louisetoolkit.org](https://docs.louisetoolkit.org). The package `homepage` and the README links point there now. Nothing in the code changes, and the old docs.louisetoolkit.com links keep working as long as its redirect is in place.
- Updated dependencies [57ab8ad]
- Updated dependencies [346ab53]
- Updated dependencies [2cee9bc]
- Updated dependencies [b5bc2d1]
- Updated dependencies [e8c452f]
- Updated dependencies [3ab9a01]
- Updated dependencies [dd1e803]
- Updated dependencies [c241310]
- Updated dependencies [fa3f05d]
- Updated dependencies [98a7af7]
- Updated dependencies [b215176]
- Updated dependencies [bd15917]
- Updated dependencies [5bbed31]
- Updated dependencies [9ffe693]
- Updated dependencies [8fbee20]
- Updated dependencies [d7a3644]
- Updated dependencies [d2c5aca]
- Updated dependencies [bdceb77]
- Updated dependencies [38d51b3]
- Updated dependencies [e53714d]
- Updated dependencies [6dd5c85]
- Updated dependencies [2d93708]
- Updated dependencies [ab0a1e8]
- Updated dependencies [692ce84]
- Updated dependencies [b02ea9e]
- Updated dependencies [79a01c4]
  - louise-toolkit@0.35.0

## 0.3.0

### Minor Changes

- 5824b23: You can now give an outside probe a URL that says whether your site works. Until now nothing could check a site from outside Cloudflare: the Health panel's route needs an editor session, and no route checked D1, KV, or a provider.

  - **`statusRoute({ checks })`** (`louise-toolkit/editor`) answers `GET` and `HEAD` at `/api/louise/status` with 200 when every check passes and 503 when any fails, throws, or times out. It's public under ADR 0012, so the API gate lets an anonymous probe through. The body is `{ ok, checks: { [name]: { ok, ageMs? } } }`: booleans and ages, never an error's text. A check that throws is logged on the server instead. Every response has `Cache-Control: no-store`.
  - **You supply the checks,** because only your site knows what "working" means. A check is `(env, signal) => boolean | { ok, ageMs? }`. Two builders cover the generic cases: `d1Check((env) => env.DB)` passes when D1 answers `SELECT 1`, and `ageCheck(read, maxAgeMs)` passes when a timestamp, such as your last health scan's `checkedAt`, is no older than the limit, and reports its age. It uses the same rule as `isStale` (`louise-toolkit/health`), so the status route and the Health panel agree about what counts as out of date.
  - **Each check has a timeout,** `timeoutMs` (default 2 seconds), so a hung dependency makes a 503 instead of a hung probe. `reuseMs` reuses a finished result within an isolate, so a burst of anonymous requests can't multiply your database queries.
  - `runStatusChecks(env, checks)` is the same run without the route, and `LOUISE_STATUS_PATH` (`louise-toolkit/worker`) is its default path.

  **What changed without it:** `isLouisePublicPath` now includes `/api/louise/status`, so `createLouiseMiddleware({ apiGate })` lets anonymous requests to that path through to whatever answers there. If your site has its own editor-only route at `/api/louise/status`, move it or check the editor session in the route itself before you upgrade.

  **What to do:** nothing is required. To use it, mount `statusRoute` with cheap checks, since anyone can make them run, and point your uptime probe at `/api/louise/status`.

### Patch Changes

- c5179ee: Publishing a version now checks that it belongs to the page you're publishing, and page IDs and version IDs have their own types, so the compiler catches one passed where the other belongs.

  - **`POST /api/louise/pages/:id/publish` answers `404`** when the body's `versionId` isn't a version of page `:id`. Before, the route published it anyway: `publish` finds the page through the version row, so a mismatched pair published a different page than the URL named, after flushing the URL page's draft buffer to D1. The route checks before the flush now, so a rejected publish leaves that buffer alone. A page `:id` like `0` or `07` gets a `400` on any version route.
  - **Only an absent `versionId` publishes the latest draft.** A publish body whose `versionId` is present but isn't a positive JSON integer (`"7"`, `0`, `1.5`, `null`), or a body that isn't a JSON object, now gets a `400`. Before, the route read any `versionId` it couldn't validate as absent and published the newest draft instead, so `{ "versionId": "7" }` published something the caller never named. The body takes a JSON number, the same as `discard`, which already answered `400`; an empty body or `{}` still means the latest draft.
  - **`PageId` and `VersionId`** (`louise-toolkit/content`) are branded `number` types. At runtime they're plain numbers. Make them with `toPageId(n)` and `toVersionId(n)`, which throw `LouiseContentError` unless `n` is a positive integer, or parse untrusted input (a route parameter, a request body, a tool argument) with `parsePageId(value)` and `parseVersionId(value)`, which accept a positive integer or its decimal string and return `undefined` for anything else.
  - **The versioned Local API takes them:** `saveDraft`, `scheduleDraft`, `unpublish`, and `findVersions` take a `PageId`; `publish`, `discardVersion`, and `diffVersions` take a `VersionId`. So does `applySaveDraft` (`louise-toolkit/editor`), and `EditSessionTarget.id` (`louise-toolkit/realtime`) is a `PageId`. The plain `LocalApi` methods (`findByID`, `update`, `deleteByID`) still take a `number`, and a `PageId` works there as is.
  - **The MCP tool schemas** describe a document ID as a positive integer or its decimal string, which is what `parsePageId` accepts.
  - **`@louise-toolkit/astro`:** the `saveDraft` Action's input rejects an `id` that isn't positive, and brands it before it calls `applySaveDraft`.

  **What to do:** this is a breaking type change for code that calls the versioned Local API or `applySaveDraft` directly. Wherever TypeScript now reports that a `number` isn't assignable to `PageId` or `VersionId`, wrap the value:

  ```ts
  import { toPageId, toVersionId } from "louise-toolkit/content";

  await api.saveDraft(context, toPageId(page.id), data);
  await api.publish(context, toVersionId(version.id)); // a row from findVersions
  await applySaveDraft(env, deps, editor, toPageId(id), snapshot);
  ```

  For an ID from a URL or a request body, use `parsePageId` and answer `400` when it returns `undefined`, rather than `Number(...)`. Nothing changes at runtime for a valid ID, and there's nothing to migrate. If a client of your own publishes with an explicit `versionId`, make sure it sends a version of the page in the URL as a JSON number: a mismatched pair used to publish the other page and now gets a `404`, and a string such as `"7"` used to publish the latest draft and now gets a `400`.

- Updated dependencies [1df0e13]
- Updated dependencies [217efca]
- Updated dependencies [bfed21e]
- Updated dependencies [a427795]
- Updated dependencies [a1f3167]
- Updated dependencies [c13ad5e]
- Updated dependencies [2ec284a]
- Updated dependencies [2ec284a]
- Updated dependencies [8d1b802]
- Updated dependencies [c5179ee]
- Updated dependencies [a75e8b5]
- Updated dependencies [299c75c]
- Updated dependencies [a893b8c]
- Updated dependencies [5824b23]
- Updated dependencies [add6569]
- Updated dependencies [238820a]
- Updated dependencies [2e57bb9]
  - louise-toolkit@0.34.0

## 0.2.7

### Patch Changes

- Updated dependencies [6b46d81]
- Updated dependencies [5a76d9f]
- Updated dependencies [a632579]
  - louise-toolkit@0.33.0

## 0.2.6

### Patch Changes

- Updated dependencies [acec046]
  - louise-toolkit@0.32.0

## 0.2.5

### Patch Changes

- Updated dependencies [a626637]
  - louise-toolkit@0.31.3

## 0.2.4

### Patch Changes

- Updated dependencies [08084be]
  - louise-toolkit@0.31.2

## 0.2.3

### Patch Changes

- Updated dependencies [9833a03]
- Updated dependencies [57aa151]
- Updated dependencies [0b4a96c]
  - louise-toolkit@0.31.1

## 0.2.2

### Patch Changes

- Updated dependencies [3ec61df]
  - louise-toolkit@0.31.0

## 0.2.1

### Patch Changes

- Updated dependencies [1b300ad]
  - louise-toolkit@0.30.1

## 0.2.0

### Minor Changes

- 4f0ed19: `createLouiseMiddleware({ apiGate })`: the deny-by-default editor API gate for routes mounted as Astro API routes (ADR 0012, slice 2).

  **What's new.** `composeWorker({ gate })` protects routes the worker dispatches. A site that mounts the editor routes as Astro API routes through `runEditorRoute` never reaches that gate. Pass `apiGate: true` to the middleware and every request under `/api/louise` must come from a signed-in editor before any route runs. Writes and WebSocket upgrades are origin-checked, and gated responses get `Cache-Control: no-store` unless the route set its own. If `resolveEditor` throws, pages still render publicly as before, but the API **refuses** rather than serving an anonymous request.

  **Public routes are declared by path here.** Middleware runs before Astro knows which route file answers, so a route can't mark itself public the way `publicRoute` does for `composeWorker`. The toolkit's own public routes are exempt at their default paths (`/api/louise/forms/*`, `/api/louise/vitals`); add your own with `apiGate: { isPublic: (pathname) => … }`. `louise-toolkit/worker` now exports those default paths (`LOUISE_FORMS_PATH`, `LOUISE_VITALS_PATH`, `isLouisePublicPath`), which `formRoute` and `vitalsRoute` build their defaults from, so the exemption can't drift from where the routes answer. It also exports `underPrefix`.

  **What you have to do.** Nothing until you turn it on. Before you do, list any Astro route under `/api/louise` that must answer without an editor session (a webhook, for example) and name it in `isPublic`, or it starts returning 401. Behind `composeWorker({ gate })` it's a second check on requests the worker already let through, and costs nothing: the middleware resolves the editor on every request anyway.

### Patch Changes

- Updated dependencies [4f0ed19]
- Updated dependencies [34d502b]
- Updated dependencies [ba58f54]
- Updated dependencies [403126f]
- Updated dependencies [eb9e111]
- Updated dependencies [25b6645]
  - louise-toolkit@0.30.0

## 0.1.2

### Patch Changes

- a93642b: A batch of small helpers the client sites each hand-rolled (#464):

  - **`kvCached(kv, key, load, { ttlSeconds, cacheMisses? })`** and **`kvBust`** in
    `louise-toolkit/worker`: a read-through KV cache for one value looked up on every
    request. Misses are cached by default, so a garbage hostname costs one read per TTL.
    It fails open on KV errors. `ttlSeconds` is required and must be at least 60, KV's
    minimum.
  - **`isNoindexHost(hostname, { prefixes?, suffixes? })`** in `louise-toolkit/security`
    covers `*.workers.dev` preview and version URLs by default, plus your own prefixes.
    `louiseSecurityHeaders` takes **`noindex`** to send `X-Robots-Tag: noindex`, and
    `@louise-toolkit/astro`'s `createLouiseMiddleware` takes **`noindex: (host) =>
boolean`**. Set it in middleware: a header set in a streamed page is silently dropped.
  - **`majorToCents(amount, fractionDigits?)`** and **`parseMoneyInput(text,
fractionDigits?)`** in `louise-toolkit/commerce`. They replace two different
    functions that were both called `dollarsToCents`. One was `Math.round(d * 100)`,
    which turns 1.005 into 100 rather than 101. The other parsed form input as text, and
    is kept but made currency-agnostic.

  Considered and left in the sites: cart-line math (three carts, three shapes; the shared
  part is a one-liner) and a modal focus trap (one site only).

- 16ae16a: editor: `resumeDraft`, the edit-mode draft read every site was copying (#455)

  Edit mode has to render the editor's work-in-progress, not the live row, or
  reopening a page shows the last-published content and the next save reverts the
  draft. Every site hand-wrote that read: three client sites carried a near-identical
  `lib/louise-drafts.ts`, the docs told readers to write it themselves, and the
  toolkit's own demo site had a fourth copy. The three client copies also missed the KV
  write buffer, so on a site with buffering on, edit mode could show a draft older
  than the one the next save would build on.

  ```ts
  import { resumeReadSession } from "@louise-toolkit/astro";
  import { resumeDraft } from "louise-toolkit/editor";

  const resume = resumeReadSession(env.DB, Astro.cookies);
  const draft = await resumeDraft(
    resume.client,
    { versionsTable: pagesVersions, collection: "pages", bufferKv: env.DRAFTS },
    page, // { id, publishedVersionId }
  );
  resume.commit();
  ```

  - **`resumeDraft`** (`louise-toolkit/editor`) returns the draft snapshot or `null`,
    in the same order `applySaveDraft` builds on: the KV buffer first, then the newest
    draft _newer_ than `publishedVersionId`. A draft at or below the live pointer is
    superseded, and resuming it would silently revert the page. It returns the whole
    snapshot; which fields you render (`sections`, `body`, …) stays yours. It takes the
    row you already loaded, so it adds no query for the live pointer.
  - **`resumeReadSession`** (`@louise-toolkit/astro`) opens the D1 session anchored at
    the editor's bookmark cookie, so a draft saved a moment ago is visible behind read
    replication. It falls back to the raw binding when replication is off.
  - **`D1_BOOKMARK_MAX_AGE`** (`louise-toolkit/db`): the bookmark cookie's lifetime,
    now shared by the save path and the read path instead of repeated as a literal.

  **If you have a `lib/louise-drafts.ts`:** keep your field accessors, and replace the
  query inside them with `resumeDraft`. Pass the page row instead of its id. If you
  buffer drafts in KV, pass the same namespace as `bufferKv`.

- Updated dependencies [ee0757a]
- Updated dependencies [6ca7a0f]
- Updated dependencies [11e52a7]
- Updated dependencies [4bcecdb]
- Updated dependencies [a93642b]
- Updated dependencies [31ec8ed]
- Updated dependencies [16ae16a]
- Updated dependencies [2543a27]
- Updated dependencies [49d63c2]
- Updated dependencies [e53dfb1]
- Updated dependencies [bfafb00]
- Updated dependencies [8e25af5]
- Updated dependencies [7ec18c0]
- Updated dependencies [d795d30]
  - louise-toolkit@0.29.0

## 0.1.1

### Patch Changes

- Updated dependencies [0d0e2c5]
  - louise-toolkit@0.28.0

## 0.1.0

### Minor Changes

- 2227153: Astro support moves to `@louise-toolkit/astro`

  **Breaking.** The `louise-toolkit/astro` subpath is gone. Its contents
  (`createLouiseMiddleware`, the Action factories, `louiseLoader`,
  `defineCatalogLoader`, `formToAstroSchema`) now live in a new package, and
  `louise-toolkit` no longer declares Astro at all: no peer, no devDependency, no
  export, no keyword.

  ```diff
  -import { louiseLoader } from "louise-toolkit/astro";
  +import { louiseLoader } from "@louise-toolkit/astro";
  ```

  ```sh
  pnpm add @louise-toolkit/astro
  ```

  Nothing else changes: same functions, same signatures, same behavior. A
  scaffolded project gets the new dependency automatically: `create-astroid`
  derives its version the same way it derives the other two, and the generated
  worker and Actions import from the new specifier.

  **Why.** `louise-toolkit` is described as framework-agnostic and shipped an
  `astro` peer dependency with an `./astro` export (#327). That claim should be
  true rather than aspirational, and the practical cost was real: the toolkit couldn't
  be published, versioned, or reasoned about without Astro in the picture, and
  Astro's own release cadence dragged the whole workspace.

  Keeping the adapter as its own package rather than folding it into `astroidjs`
  preserves the naming slot for a future host (a `/remix`, `/nuxt`, or plain-Hono
  adapter has somewhere obvious to go) and keeps the opinionated layer separate
  from the thin binding.

  The adapter versions independently of both core and `astroidjs`. It depends on
  `louise-toolkit` through the public export map only, which is what
  `scripts/ci/checks/export-map.mjs` now guards: the three symbols it needed that
  were reachable only from `src/` were promoted to public in the preceding release.

### Patch Changes

- Updated dependencies [76e38bc]
- Updated dependencies [4467706]
- Updated dependencies [afdddf7]
- Updated dependencies [2227153]
- Updated dependencies [b643c3e]
- Updated dependencies [bea4d08]
- Updated dependencies [7b71572]
- Updated dependencies [ca92147]
- Updated dependencies [54ce5ea]
- Updated dependencies [4aa52e9]
  - louise-toolkit@0.27.0
