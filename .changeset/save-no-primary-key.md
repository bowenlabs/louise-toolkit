---
"louise-toolkit": minor
---

A field save refuses a collection with no primary key instead of rewriting every row (#702).

`applyFieldSave` matched the save's `key` against the table's primary key, and on a table without one it ran the update with no `WHERE`, rewriting the whole table. It now answers `500` with a message that names the collection, and `saveRoute` throws at construction when any collection it's given has no primary key.

**Upgrading:** every framework table has an `id` primary key, so a site using them sees no change. A site that passes `saveRoute` a table without a primary key now fails at startup; give the table one.
