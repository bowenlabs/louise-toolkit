---
title: cms
description: "louisecms/cms — collections, codegen, the Local API, validation, patches, webhooks."
sidebar:
  order: 2
---

```ts
import {
  defineCollection,
  defineCmsConfig,
  createLocalApi,
  renderRichText,
  rule,
} from "louisecms/cms";
```

The `cms` subpath is the structured content engine: define collections, generate
Drizzle schema from them, and read/write documents through an access-controlled,
validated **Local API**. Peer dependency: `drizzle-orm`.

## Defining collections

```ts
import { defineCollection, defineCmsConfig } from "louisecms/cms";

const artworks = defineCollection({
  slug: "artworks",
  fields: {
    title: { type: "text", validation: (r) => r.required().min(2) },
    slug: { type: "text", validation: (r) => r.slug().unique() },
    year: { type: "number", validation: (r) => r.integer().positive() },
    body: { type: "richtext" },
  },
});

export const cms = defineCmsConfig({ collections: { artworks } });
```

`defineCollection` / `defineCmsConfig` are identity helpers (Sanity's
`defineType` analogue) — they return the config unchanged but give you
autocomplete and a single greppable call site.

## Codegen — schema from config

```ts
import { cmsConfigToSchema, generateSchemaSource } from "louisecms/cms";
```

- `cmsConfigToSchema(config)` builds Drizzle table objects from a `CmsConfig` at
  runtime.
- `generateSchemaSource(config)` emits `.ts` source for a committed schema file
  (import-sorted so your formatter never flags it).

Related builders: `collectionToTable`, `collectionVersionsTable`,
`relationshipJoinTables`, and full-text search helpers
(`collectionSearchTableSQL`, `extractSearchText`).

## The Local API

```ts
import { createLocalApi, createVersionedLocalApi } from "louisecms/cms";

const api = createLocalApi(collectionConfig, table, { registry });
await api.create(doc, context); // runs access + validation, then inserts
await api.find(query, context);
await api.update(id, patch, context);
```

Every method takes a `context` and runs the matching **access** function
(`read` for `find`/`findByID`, `create` for `create`, …) before touching the
database, and validates writes with the collection's
[rules](#validation) — throwing `LouiseAccessDeniedError` (→ 403) or
`LouiseValidationError` (→ 422) so a routing layer can branch by `instanceof`.
`createVersionedLocalApi` adds draft/version history for collections that opt in
with `versions`. `can(...)` evaluates access without performing the operation.

## Validation

A chainable, immutable, Sanity-style rule builder:

```ts
import { rule } from "louisecms/cms";

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

- `diffDocuments` / `computePatch` / `applyPatch` — structural document diffs for
  optimistic updates and version history.
- `renderRichText(content)` — render stored rich-text content to HTML (the
  server never runs ProseMirror; see [Rich text](/guide/rich-text/)).

## Webhooks, migrations, visual editing

- `createWebhookHook` / `deliverWebhookMessage` — afterChange-style outbound
  webhooks.
- `defineMigration` / `runMigration` — content migrations over collections.
- `buildStudioStructure`, `getCollectionsMeta` — drive a studio UI.
- `mountVisualEditing` / `mountPreviewSync` / `editAttr` — live preview and
  click-to-edit references.

:::note
`cms` is a large surface — this page is a map, not an exhaustive signature list.
Every symbol is fully typed; lean on your editor's autocomplete against the
`louisecms/cms` types.
:::
