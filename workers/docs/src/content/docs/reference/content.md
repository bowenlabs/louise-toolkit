---
title: content
description: "louise-toolkit/content—collections, codegen, the Local API, validation, patches, webhooks."
sidebar:
  order: 2
---

```ts
import {
  defineCollection,
  defineContentConfig,
  createLocalApi,
  renderRichText,
  rule,
} from "louise-toolkit/content";
```

The `content` subpath is the structured content engine: define collections, generate
Drizzle schema from them, and read/write documents through an access-controlled,
validated **Local API**. Peer dependency: `drizzle-orm`.

## Defining collections

<!-- Region "define-collection" of packages/louise/test/core/content-reference-examples.test.ts, which type-checks and runs it. Edit it there, then paste it here. -->

```ts
import type { EditorSession } from "louise-toolkit/auth";
import { defineCollection, defineContentConfig } from "louise-toolkit/content";

export interface Context {
  session: EditorSession | null;
}

export const artworks = defineCollection({
  slug: "artworks",
  fields: {
    title: { type: "text", required: true, validation: (r) => r.required().min(2) },
    slug: { type: "text", required: true, validation: (r) => r.slug().unique() },
    year: { type: "number", validation: (r) => r.integer().positive() },
    body: { type: "richText" },
  },
  // The Local API passes its `context` argument to these. No function means allowed.
  access: {
    create: ({ session }: Context) => session !== null,
    update: ({ session }: Context) => session !== null,
    publish: ({ session }: Context) => session?.role === "owner",
  },
  // Adds draft history, for createVersionedLocalApi.
  versions: { drafts: true },
});

export const content = defineContentConfig({ collections: [artworks] });
```

`defineCollection` / `defineContentConfig` are identity helpers (Sanity's
`defineType` analogue)—they return the config unchanged but give you
autocomplete and a single greppable call site.

`Context` is your own type. Louise never reads it: it passes whatever each
[Local API](#the-local-api) call receives straight to the collection's `access`
functions.

## Codegen—schema from config

```ts
import { contentConfigToSchema, generateSchemaSource } from "louise-toolkit/content";
```

- `contentConfigToSchema(config)` builds Drizzle table objects from a `ContentConfig` at
  runtime.
- `generateSchemaSource(config)` emits `.ts` source for a committed schema file
  (import-sorted so your formatter never flags it).

Related builders: `collectionToTable`, `collectionVersionsTable`,
`relationshipJoinTables`, and full-text search helpers
(`collectionSearchTableSQL`, `extractSearchText`).

## The Local API

<!-- Region "local-api" of packages/louise/test/core/content-reference-examples.test.ts, which type-checks and runs it. Edit it there, then paste it here. -->

```ts
import { gte } from "drizzle-orm";
import { createLocalApi, createVersionedLocalApi } from "louise-toolkit/content";
import { db } from "louise-toolkit/db";
import { artworks, type Context } from "./content.config";
import * as schema from "./schema"; // your Drizzle tables: artworks, artworksVersions

const orm = db(env.DB);
const context: Context = { session };

// Every method takes the context first, then its own arguments.
const api = createLocalApi<typeof schema.artworks, Context>(orm, schema.artworks, artworks);
const artwork = await api.create(context, { title: "Untitled", slug: "untitled", year: 2026 });
const recent = await api.find(context, { where: gte(schema.artworks.year, 2020), limit: 10 });
await api.update(context, artwork.id, { title: "Still life" });

// The same methods, plus drafts, for a collection with `versions: { drafts: true }`.
// A draft holds the whole document, and publishing validates all of it.
const versioned = createVersionedLocalApi<
  typeof schema.artworks,
  typeof schema.artworksVersions,
  Context
>(orm, schema.artworks, schema.artworksVersions, artworks);
const snapshot = { title: "Still life, revised", slug: "still-life", year: 2026 };
const draft = await versioned.saveDraft(context, artwork.id, snapshot);
const live = await versioned.publish(context, draft.id);
```

Here `env.DB` is your D1 binding and `session` is the signed-in editor's
session, or `null`. The signatures:

```ts
createLocalApi(db, table, config, registry?, options?);
createVersionedLocalApi(db, table, versionsTable, config, registry?, options?);
```

- `table` is the collection's Drizzle table, and `versionsTable` is its
  companion from `collectionVersionsTable(config)`.
- `registry` is a `ContentRegistry`. `find` and `findByID` need one to resolve
  relationship fields with `depth: 1`.
- `options.deferReindex` moves full-text index updates off the write path.
- The type parameters are the table types and your context type. Without them,
  `context` is `unknown` and accepts anything.

Every method takes the `context` first and runs the matching **access** function
(`read` for `find`/`findByID`/`count`/`search`, `create` for `create`, …)
before touching the database, and validates writes with the collection's
[rules](#validation)—throwing `LouiseAccessDeniedError` (→ 403) or
`LouiseValidationError` (→ 422) so a routing layer can branch by `instanceof`.

`createVersionedLocalApi` adds draft/version history for collections that opt in
with `versions`: `saveDraft`, `scheduleDraft`, `prepareDraft`, `publish`,
`publishScheduled`, `unpublish`, `findVersions`, `diffVersions`, and
`discardVersion`. A draft stores its input as the whole snapshot rather than
merging it into the live row, so pass every required field. The draft methods
check the `update` access function. `publish`, `publishScheduled`, and
`unpublish` check `publish`, and `findVersions` and `diffVersions` check `read`.
`can(config, operation, context)` evaluates access without performing the
operation.

### Page and version IDs

A page ID and a version ID are both integers, so the versioned methods take
branded types that keep them apart: `saveDraft`, `scheduleDraft`, `unpublish`,
and `findVersions` take a `PageId`, and `publish`, `discardVersion`, and
`diffVersions` take a `VersionId`. Passing one where the other belongs, or a
plain `number`, is a type error. At runtime both are ordinary numbers.

```ts
import { parsePageId, toPageId, toVersionId } from "louise-toolkit/content";

const page = toPageId(row.id); // a number you trust; throws unless it's a positive integer
const [latest] = await api.findVersions(context, page);
await api.publish(context, toVersionId(latest.id));

const fromUrl = parsePageId(params.id); // untrusted input: undefined unless valid
if (fromUrl === undefined) return new Response("Bad id", { status: 400 });
```

`parsePageId` and `parseVersionId` accept a positive integer or its decimal
string, such as a route parameter or an agent's tool argument.

## Validation

A chainable, immutable, Sanity-style rule builder:

```ts
import { rule } from "louise-toolkit/content";

rule().required().min(2).max(80);
rule().slug().unique();
rule().email().warning("Double-check this address");
rule().custom((value, ctx) => value !== "forbidden" || "Not allowed");
```

Pure checks (`min`/`max`/`length`/`regex`/`email`/`slug`/`integer`/`positive`/
`custom`) run anywhere; `unique` and `reference` are DB-backed and skipped in a
pure client pass. `validateDocument(...)` returns all violations;
`assertValid(...)` throws `LouiseValidationError` on any `"error"`-severity one
while returning warnings.

## Patches & rich text

- `diffDocuments` / `computePatch` / `applyPatch`—structural document diffs for
  optimistic updates and version history.
- `renderRichText(content)`—render stored rich-text content to HTML (the
  server never runs ProseMirror; see [Rich text](/guide/rich-text/)).

## Webhooks, migrations, visual editing

- `createWebhookHook` / `deliverWebhookMessage`—afterChange-style outbound
  webhooks. Delivery goes through [`fetchPublicUrl`](/reference/security/): the
  endpoint must be https on the default port, with a hostname rather than an IP
  address, and every redirect is checked the same way. Pass a policy as the
  second argument to add your own site's host to `blockHosts`.
- `defineMigration` / `runMigration`—content migrations over collections.
- `buildEditorStructure`, `getCollectionsMeta`—drive the Louise Editor UI.
- `mountVisualEditing` / `mountPreviewSync` / `editAttr`—live preview and
  click-to-edit references.

:::note
`content` is a large surface—this page is a map, not an exhaustive signature list.
Every symbol is fully typed; lean on your editor's autocomplete against the
`louise-toolkit/content` types.
:::
