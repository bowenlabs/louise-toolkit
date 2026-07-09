-- Full-text search index for pages (FTS5). A virtual table has no Drizzle
-- schema representation (drizzle-kit can't diff it), so this migration is
-- hand-authored — it mirrors collectionSearchTableSQL(pagesCollection), with one
-- column per the collection's search.fields (title, body, flattened sections).
-- The index is kept in sync on publish; populate it for existing rows once via
-- the reindex endpoint: POST /api/louise/pages/reindex.
CREATE VIRTUAL TABLE IF NOT EXISTS `pages_fts` USING fts5(`title`, `body`, `sections`);
