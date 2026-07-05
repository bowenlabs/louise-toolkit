---
title: db
description: "@louisecms/core/db — Drizzle over D1, plus the site_settings table."
sidebar:
  order: 1
---

```ts
import { db, siteSettings, siteSettingsColumns } from "@louisecms/core/db";
```

A thin wrapper around Drizzle's D1 driver. **Raw binding in, Drizzle instance
out** — the schema is yours, never Louise's.

Peer dependency: `drizzle-orm`.

## `db(d1, schema?)`

```ts
function db<TSchema extends Record<string, unknown>>(
  d1: D1Database,
  schema?: TSchema,
): DrizzleD1Database<TSchema>;
```

Returns a Drizzle instance bound to your D1 database. Pass your own schema object
for typed relational queries; omit it for a schema-less handle.

```ts
import { db } from "@louisecms/core/db";
import * as schema from "./schema"; // your Drizzle tables

export async function GET({ locals, request }, env: Env) {
  const orm = db(env.DB, schema);
  const rows = await orm.select().from(schema.artworks);
  return Response.json(rows);
}
```

Because the binding is passed in, the same call works in `astro dev`, in
production, and in a test with a fake D1.

## `siteSettings` / `siteSettingsColumns`

A framework-owned **singleton config table** you can compose into your schema or
use as-is, so a generic "site settings" row doesn't drift between projects.

```ts
import { siteSettings } from "@louisecms/core/db";

const [settings] = await db(env.DB).select().from(siteSettings).limit(1);
```

`siteSettingsColumns` exposes the column set for composing your own table
variant when you need to extend it.

:::tip
`db()` is intentionally the *only* opinion Louise has about your database, and
`siteSettings` is the *only* table it ships. Everything else — artworks,
products, pages, your content model — is yours. The [`cms`](/docs/reference/cms/)
module generates Drizzle schema from a collection config if you want that.
:::
