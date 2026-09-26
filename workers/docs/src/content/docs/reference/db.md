---
title: db
description: "louise-toolkit/db—Drizzle over D1, plus the framework-owned pages, inquiries, and site_settings tables."
sidebar:
  order: 1
---

```ts
import { db, pages, inquiries, siteSettings, siteSettingsColumns } from "louise-toolkit/db";
```

A thin wrapper around Drizzle's D1 driver. **Raw binding in, Drizzle instance
out**—the schema is yours, never Louise's.

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
import { db } from "louise-toolkit/db";
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
import { siteSettings } from "louise-toolkit/db";

const [settings] = await db(env.DB).select().from(siteSettings).limit(1);
```

`siteSettingsColumns` exposes the column set for composing your own table
variant when you need to extend it.

## `pages` / `inquiries`

The two other framework-generic content tables, offered on the same
compose-or-use-as-is pattern:

- **`pages`** (`pagesColumns`, `Page`, `NewPage`)—slug, title, sanitized rich
  `body`, publish status, SEO/OG, ordering, timestamps.
- **`inquiries`** (`inquiriesColumns`, `Inquiry`, `NewInquiry`)—contact-form
  submissions.

```ts
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { pagesColumns } from "louise-toolkit/db";

// Use as-is, or spread the columns to add site-specific fields:
export const pages = sqliteTable("pages", {
  ...pagesColumns,
  authorId: integer("author_id"),
});
```

drizzle-kit still generates each site's migration from its composed schema, so
sharing the column set costs no flexibility.

:::tip
`db()` stays schema-agnostic—the tables above are **opt-in building blocks**,
not a schema Louise imposes. They exist so the core content tables (`pages`,
`inquiries`, `site_settings`) don't drift between projects; everything else—products, artworks, your content model—is yours. The
[`content`](/reference/content/) module generates Drizzle schema from a collection
config if you want that.
:::

:::note
Auth tables (`user`, `session`, …) are **not** here—they're generated from your
[`auth`](/reference/auth/) config by Better Auth, not hand-written.
:::

## Checking that the database is migrated

Schema migrations are applied out of band, with `wrangler d1 migrations apply`,
and every deploy of a site can share one database. So a deploy can land before
its migration, and the failure shows up later as a missing column on whatever
route touches it first. These compare the migration files the code was built
with against D1's ledger (`d1_migrations`). They're read-only: nothing here
applies a migration.

```ts
function migrationStatus(
  d1: D1Client,
  expected: readonly string[],
  options?: { table?: string },
): Promise<MigrationStatus>;

interface MigrationStatus {
  applied: string[]; // expected, and in the ledger
  pending: string[]; // expected, not in the ledger: the database is behind
  unknown: string[]; // in the ledger, not expected: a newer deploy migrated it
}
```

`expected` takes file names or paths. Bundle them at build time, for example with
Vite's `import.meta.glob` (`?raw` keeps it from parsing the SQL):

```ts
import { migrationStatus } from "louise-toolkit/db";

const MIGRATIONS = Object.keys(import.meta.glob("../migrations/*.sql", { query: "?raw" }));
const { pending } = await migrationStatus(env.DB, MIGRATIONS);
```

A database with no ledger yet counts as having applied nothing. Pass `table` if
your Wrangler config sets `migrations_table`.

- **`assertMigrationsApplied(d1, expected, options?)`** throws a
  `LouisePendingMigrationsError` whose `files` names the pending migrations.
  Otherwise it returns the status, so you can still log `unknown`.
- **`compareMigrations(expected, ledger)`** is the pure comparison, for a script
  that reads the ledger its own way.
- To show it to an owner, pass `pending` as `pendingMigrations` to
  [`summarizeHealth`](/reference/health/). Check live when you read the summary,
  too, because a deploy can land between scans.

### The deploy gate

`louise migrations-check` runs the same comparison before a deploy, and exits 1
when the database is behind the code:

```sh
corepack pnpm exec louise migrations-check DB --remote
```

It reads the ledger through `wrangler d1 execute`, so run it where `wrangler` is
on the `PATH` and can reach the account, and compares it with the `.sql` files in
`--dir` (default `migrations`). `--config` picks the Wrangler config, and
`--table` the ledger. A ledger that's ahead of the code is reported, not failed.
Put it in front of the deploy command, for example
`louise migrations-check DB --remote && wrangler deploy`.
