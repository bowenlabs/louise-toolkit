---
"louise-toolkit": minor
---

`createLocalApi` and `createVersionedLocalApi` now throw `LouiseContentError` when the collection's table has no `id` column, and the message says what to add. The Local API finds, updates, and deletes rows by `id`, but a table from `collectionToTable` or `generateSchemaSource` has that column only when the collection declares `id: { type: "number", autoIncrement: true }`. Before, nothing checked: `create`, `find`, and `count` worked, and the first `findByID`, `update`, `deleteByID`, search, or publish failed with a SQL error such as `where  = ?`, or with a bare "Write failed."

- **The message names the fix.** It asks for the `id` field, or for an `id: integer("id").primaryKey({ autoIncrement: true })` column when you wrote the table by hand. When the collection has an `autoIncrement` field under another key, such as `noteId`, the message asks you to rename it to `id`.
- **`reindexDoc` and `depth: 1` reads check too.** `reindexDoc` throws the same error before it queries, and a `find` or `findByID` with `depth: 1` throws it for a related collection whose table in the `ContentRegistry` has no `id` column.
- **Generated schemas don't change.** `collectionToTable` and `generateSchemaSource` still add an `id` column only when you declare one, so the upgrade itself generates no migration.

**What to do:** nothing, if your Local API tables already have an `id` column, as the ready-made `pages` table does. The one setup this breaks is a table without `id` that you used only for `create`, `find`, and `count`, which worked before and now throws where you build the API. Add the `id` field to the collection, or the column to your hand-written table, and generate a migration. SQLite can't add a primary key column to an existing table, so expect that migration to rebuild the table.
