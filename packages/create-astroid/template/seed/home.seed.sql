-- Seed the editable home page (slug `home`) that src/pages/index.astro renders.
-- Idempotent. Apply once after migrations:
--   wrangler d1 execute DB --file seed/home.seed.sql --remote
--   (drop --remote for the local dev D1)
INSERT OR IGNORE INTO pages (slug, title, body, status, sort_order, created_at, updated_at)
VALUES (
  'home',
  '__BRAND_NAME__',
  '<p>Welcome to __BRAND_NAME__. Sign in at <code>/login</code>, switch on edit mode, and change this text in place — then hit Publish.</p>',
  'published',
  0,
  unixepoch(),
  unixepoch()
);
