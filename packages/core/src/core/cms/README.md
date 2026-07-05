# `@louisecms/core/cms`

A V8-native CMS engine: model content as **collections**, and the engine
generates a Drizzle schema, a typed **Local API** (`find` / `findByID` /
`create` / `update` / `deleteByID`), and serializable **admin metadata** for a
generic admin UI to render against. The Payload-config idea, with zero Node.js
dependency.

`cms` is the one sanctioned exception to Louise's zero-cross-primitive rule: it
is typed against the _shape_ of a Drizzle instance but never imports
`louise/db`. The consumer wires them together explicitly.

```ts
import { db } from "@louisecms/core/db";
import { createLocalApi, defineCmsConfig } from "@louisecms/core/cms";
```

---

## Defining a config

`defineCmsConfig` validates a config and returns the **resolved** config —
the single source of truth fed to schema codegen, admin metadata, and the
Local API. Always read the value it returns, never the raw input you passed in
(a plugin may have transformed it).

```ts
export const cmsConfig = defineCmsConfig({
  collections: [postsCollection],
  plugins: [seoPlugin({ collections: ["posts"] })],
});
```

With no `plugins`, `defineCmsConfig` returns the input unchanged (by reference).

---

## Plugins — `plugin(config) => config`

A **Louise Admin plugin** is a synchronous transform over the whole config, modeled on
Payload's `plugins` array. It may add or modify collections, inject fields, or
register lifecycle hooks. Plugins run in array order, each fed the previous
one's output, **before validation** — so a plugin's output is held to exactly
the same rules as a hand-written config.

```ts
import type { Louise AdminPlugin } from "@louisecms/core/cms";

const addUpdatedAt: Louise AdminPlugin = (config) => ({
  ...config,
  collections: config.collections.map((c) => ({
    ...c,
    fields: { ...c.fields, updatedAt: { type: "date", mode: "timestamp" } },
  })),
});
```

**Rules:** treat the input as immutable — return a new object, never mutate
`config` in place. Plugins are synchronous in this release so the resolved
config can be consumed by sync schema codegen and config loading; an async
variant is a deliberate future extension.

Published first-party plugins live under `@louisecms/core-admin-plugin-*` (e.g.
`@louisecms/core-admin-plugin-seo`). Community plugins live under
`@louise-community/*`.

---

## Access control

Each collection may declare per-operation `access` functions, modeled on
Payload's own `access` shape:

```ts
defineCollection({
  slug: "posts",
  fields: { title: { type: "text", required: true } },
  access: {
    read: () => true, // public reads
    create: ({ session }) => session !== null,
    update: ({ session }) => session !== null,
    delete: ({ session }) => session !== null,
    // publish is checked by createVersionedLocalApi's publish/unpublish —
    // a separate privilege from update, matching Payload's own model.
    publish: ({ session }) => session?.role === "owner",
  },
});
```

`createLocalApi` enforces these on every call — `read` for `find`/`findByID`,
`create`/`update`/`delete` for their namesakes — **before** touching the
database. No access function configured for an operation means that
operation is unconditionally allowed. A rejected check throws
`LouiseAccessDeniedError` (a `LouiseCmsError` subclass, so existing
`instanceof LouiseCmsError` handling still catches it — `mountCmsRoutes`,
below, maps it to an HTTP 403 specifically).

Louise doesn't standardize the context shape access functions receive — it's
the `TContext` generic every `LocalApi` method takes as its first argument
(see Local API below). Your app decides what it looks like (a session, an
internal-RPC flag, both — see `app/louise-admin.config.ts`'s `PagesAccessContext`
for a real example).

---

## Hooks

Each collection may declare lifecycle `hooks`. They are enforced by
`createLocalApi` on every operation. Transforming hooks (`beforeChange`,
`beforeRead`, `afterRead`) run in array order, each fed the previous output;
side-effect hooks (`afterChange`, `beforeDelete`, `afterDelete`) run in order
for their effects.

| Hook                           | When                               | Signature            |
| ------------------------------ | ---------------------------------- | -------------------- |
| `beforeChange`                 | before validation on create/update | `({ data }) => data` |
| `afterChange`                  | after a persisted create/update    | `({ doc }) => void`  |
| `beforeRead` / `afterRead`     | per row on `find` / `findByID`     | `({ doc }) => doc`   |
| `beforeDelete` / `afterDelete` | around a successful delete         | `({ id }) => void`   |

`beforeChange` runs **before** validation, so a hook may supply or default a
required field (this is how `@louisecms/core-admin-plugin-seo` defaults `metaTitle`
from `title`). `afterChange` runs outside the write `try` so a side-effect error
is never mis-reported as a write failure. Read hooks do **not** run on the doc
returned from `create`/`update`. All hooks may be async. Access checks run
before any hook for that operation.

```ts
defineCollection({
  slug: "posts",
  fields: { title: { type: "text", required: true } },
  hooks: {
    beforeChange: [({ data }) => ({ ...data, title: data.title?.trim() })],
  },
});
```

---

## Local API

Every method takes a `context` (the access-control value above) as its first
argument — required, not optional, so a call site can't forget it:

```ts
const posts = createLocalApi<typeof postsTable, MyContext>(
  db(env.DB, schema),
  postsTable,
  postsCollection,
);

await posts.create(context, { title: "Hello" });
await posts.find(context, { where: eq(postsTable.status, "published") });
```

Pass the **resolved** collection (post-plugin) as the third argument — it
carries the injected fields, registered hooks, and access rules.
`create`/`update` reject unknown fields and enforce required fields.

### Relationship resolution (`depth`)

`find`/`findByID`'s `options.depth` is `0` (default, the bare related-row id)
or `1` (batch-resolve every `hasMany: false` relationship field into the
related row, one query per field — never one per row). `depth: 1` requires a
4th `registry` argument to `createLocalApi`:

```ts
const registry: CmsRegistry = {
  tables: { authors: authorsTable, posts: postsTable },
  configs: { authors: authorsCollection, posts: postsCollection },
};
const posts = createLocalApi(db(env.DB, schema), postsTable, postsCollection, registry);

const [post] = await posts.find(context, { depth: 1 });
// post.authorId is now the related `authors` row, not a bare id —
// unless that collection's own `read` access fn rejects `context`, in
// which case the field is left as the bare id rather than throwing.
```

Omitting `registry` when a collection has no relationship fields is fine —
`depth: 1` is then a no-op. Requesting `depth: 1` on a collection that _does_
have relationship fields, without a `registry`, throws `LouiseCmsError`.
`hasMany: true` relationship fields (join-table backed) aren't resolved by
`depth: 1` yet.

### Versioned Local API (drafts/publish)

Collections with `versions: { drafts: true }` get a generated
`${slug}_versions` table and a `createVersionedLocalApi` factory layering
`findVersions`/`saveDraft`/`publish`/`unpublish` on top of the plain
`LocalApi`:

```ts
const pages = createVersionedLocalApi(db(env.DB), pagesTable, pagesVersionsTable, pagesCollection);

const draft = await pages.saveDraft(context, pageId, { title: "New title" });
// saveDraft never validates required fields — an incomplete draft is valid.
await pages.publish(context, draft.id);
// publish validates the full document (like create/update) and copies the
// version's data onto the main row, setting publishedVersionId.
```

`publish`/`unpublish` are gated by the collection's `access.publish`, not
`access.update` — see Access control above.

---

## Full-text search (issue #29)

Collections may opt into search by listing which of their own `text`/
`richText`/`upload` fields to index:

```ts
defineCollection({
  slug: "pages",
  fields: {
    title: { type: "text", required: true },
    body: { type: "richText" },
  },
  search: { fields: ["title", "body"] },
});
```

This describes a companion SQLite **FTS5** virtual table (`${slug}_fts` —
see `codegen.ts`'s `collectionSearchTableSQL`), kept in sync automatically
by `createLocalApi` on every `create`/`update`/`deleteByID` (and
`publish`, for versioned collections) — there's nothing to wire up in
`hooks`. `richText` fields are flattened to plain text (TipTap JSON's
`text` leaves, concatenated) before indexing; nested `array`/block content
isn't indexed in this phase.

```ts
const results = await pages.search(context, "hello world");
```

`search` is gated by the same `read` access fn as `find`/`findByID`, and
throws `LouiseCmsError` if the collection has no `search` config.

**The FTS5 table itself isn't drizzle-modelable** — drizzle-orm has no
virtual-table column builder, so unlike the `versions` companion table it
isn't part of `schema.generated.ts`/`pnpm db:generate`'s diff. Generate it
once as a hand-authored migration instead:

```bash
npx drizzle-kit generate --custom --name=my_collection_search_fts
# paste collectionSearchTableSQL(myCollection) into the generated file
```

---

## Public REST API (`@louisecms/core/hono`)

`mountCmsRoutes` mounts a Payload-equivalent REST surface (`GET`/`POST`
`/api/:collection`, `GET /api/:collection/search?q=...`, `GET`/`PATCH`/
`DELETE` `/api/:collection/:id`) over a static `{ slug: LocalApi }` registry:

```ts
import { mountCmsRoutes } from "@louisecms/core/hono";

mountCmsRoutes(app, {
  collections: { posts },
  // Called once per request, before any Local API call — its return
  // value is the `context` every route below passes through. Louise
  // doesn't resolve sessions/auth itself; this is the one place your app
  // decides what `context` looks like for this request.
  resolveContext: async (c) => ({ session: await getSessionFromCookie(c) }),
});
```

Every collection's own `access` rules are what actually gate each request —
`mountCmsRoutes` just resolves the context they're checked against and maps
`LouiseAccessDeniedError` to an HTTP 403 (`LouiseCmsError`'s other
recognized message shapes map to 404/409; anything else falls through to a
generic 400, and non-Louise errors are rethrown rather than swallowed as a
200). It has no opinion on CORS or rate limiting — see
`app/core/lib/cms-api.ts` in this repo's own app for a real example layering
both on top before mounting.

## Rendering rich text — `renderRichText`

`richText` fields are stored as TipTap JSON (`TipTapJSONContent`) with no
transform layer — the Local API and REST API hand it back exactly as authored.
`renderRichText(content)` is the read-side counterpart: it turns that stored
JSON into an HTML string for the public site, escaping text so stored content
can't inject markup.

```ts
import { renderRichText } from "@louisecms/core/cms";

const html = renderRichText(page.body); // TipTapJSONContent → string
```

It's framework-agnostic (just returns a string) — inject it via Astro's
`set:html`, Hono's `c.html`, or anywhere else. `@louisecms/core-admin-blocks`'
`RichTextBlock.astro` wraps it for the generic block-rendering path.
