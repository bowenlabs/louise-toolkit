---
"louise-toolkit": minor
"@louise-toolkit/astro": patch
---

Publishing a version now checks that it belongs to the page you're publishing, and page IDs and version IDs have their own types, so the compiler catches one passed where the other belongs.

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
