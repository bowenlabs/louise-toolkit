-- Seed the editable home page (slug `home`) that src/pages/index.astro renders.
-- Idempotent. Apply once after migrations:
--   wrangler d1 execute DB --file seed/home.seed.sql --remote
--   (drop --remote for the local dev D1)
--
-- `sections` is the page-builder array — the same shape the on-canvas editor
-- reads and the server validates against the section catalog on write. Each item
-- is `{"_type": …, …fields, "_settings": {…}}`, and `_settings` holds TOKENS
-- (colorway/align), never CSS, so a re-theme needs no content change.
--
-- Seeding it is deliberate: an empty array renders an empty page, and a blank
-- canvas is a worse first run than having something real to click on and edit.
--
-- Full-text search (the editor's Pages search) is kept in sync on PUBLISH, so a
-- row inserted with raw SQL like this is NOT in the index until you either
-- publish an edit to it or backfill once with `POST /api/louise/pages/reindex`
-- (signed in). The page renders fine either way — only in-editor search is
-- affected.
--
-- To override just the <head> title/description (not the on-page H1), add
-- `seo_title` / `seo_description` columns below. `seo_title` is run through the
-- config's title template, which already appends the brand — so set the page
-- part only ("Pricing"), not "Pricing | __BRAND_NAME__".
INSERT OR IGNORE INTO pages (slug, title, body, sections, status, sort_order, created_at, updated_at)
VALUES (
  'home',
  '__BRAND_NAME__',
  '<p>Welcome to __BRAND_NAME__. Sign in at <code>/login</code>, switch on edit mode, and change this text in place — then hit Publish.</p>',
  json_array(
    json_object(
      '_type', 'hero',
      'heading', '__BRAND_NAME__',
      'subheading', 'Edit this in place — sign in, switch on edit mode, and type.',
      'ctaLabel', 'Get in touch',
      'ctaHref', '/contact',
      '_settings', json_object('colorway', 'base', 'align', 'center')
    ),
    json_object(
      '_type', 'featureGrid',
      'heading', 'What we do',
      'items', json_array(
        json_object('title', 'First thing', 'body', 'Describe it here.'),
        json_object('title', 'Second thing', 'body', 'And this one.'),
        json_object('title', 'Third thing', 'body', 'And this one too.')
      ),
      '_settings', json_object('colorway', 'base')
    ),
    json_object(
      '_type', 'cta',
      'heading', 'Ready when you are',
      'body', 'Swap this copy for your own.',
      'ctaLabel', 'Contact us',
      'ctaHref', '/contact',
      '_settings', json_object('colorway', 'brand', 'align', 'center')
    )
  ),
  'published',
  0,
  unixepoch(),
  unixepoch()
);
