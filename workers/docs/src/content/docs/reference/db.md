---
title: db
description: "louisecms/db — Drizzle over D1, plus the framework-owned pages, inquiries, and site_settings tables."
sidebar:
  order: 1
---

```ts
import { db, pages, inquiries, siteSettings, siteSettingsColumns } from "louisecms/db";
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
import { db } from "louisecms/db";
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
import { siteSettings } from "louisecms/db";

const [settings] = await db(env.DB).select().from(siteSettings).limit(1);
```

`siteSettingsColumns` exposes the column set for composing your own table
variant when you need to extend it.

## `pages` / `inquiries`

The two other framework-generic CMS tables, offered on the same
compose-or-use-as-is pattern:

- **`pages`** (`pagesColumns`, `Page`, `NewPage`) — slug, title, sanitized rich
  `body`, publish status, SEO/OG, ordering, timestamps.
- **`inquiries`** (`inquiriesColumns`, `Inquiry`, `NewInquiry`) — contact-form
  submissions.

```ts
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { pagesColumns } from "louisecms/db";

// Use as-is, or spread the columns to add site-specific fields:
export const pages = sqliteTable("pages", {
  ...pagesColumns,
  authorId: integer("author_id"),
});
```

drizzle-kit still generates each site's migration from its composed schema, so
sharing the column set costs no flexibility.

:::tip
`db()` stays schema-agnostic — the tables above are **opt-in building blocks**,
not a schema Louise imposes. They exist so the core CMS tables (`pages`,
`inquiries`, `site_settings`) don't drift between projects; everything else —
products, artworks, your content model — is yours. The
[`cms`](/reference/cms/) module generates Drizzle schema from a collection
config if you want that.
:::

:::note
Auth tables (`user`, `session`, …) are **not** here — they're generated from your
[`auth`](/reference/auth/) config by Better Auth, not hand-written.
:::
