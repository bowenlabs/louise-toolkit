# @louise-toolkit/astro

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
