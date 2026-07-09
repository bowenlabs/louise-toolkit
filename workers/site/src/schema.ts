// Louise CMS tables for the dogfood. `media`, `inquiries`, and `site_settings`
// use the ready-made framework tables; `pages` is composed from the framework
// `pagesColumns` plus a site-specific `sections` JSON column — an ordered array
// of structured section items (`{ _type, ...fields }`) rendered by the site's
// own bespoke components (the preconfigured-blocks model). drizzle-kit reads this
// to generate migrations; the Worker's editor routes import the composed `pages`.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { collectionVersionsTable } from "louisecms/cms";
import { inquiries, media, pagesColumns, siteSettings } from "louisecms/db";
import { pagesCollection } from "./pages-collection.js";

export const pages = sqliteTable("pages", {
  ...pagesColumns,
  sections: text("sections", { mode: "json" }).$type<Record<string, unknown>[]>(),
  // Nullable pointer to the live version (pages_versions.id); NULL = not
  // published. Maintained by the versioned Local API's publish()/unpublish().
  publishedVersionId: integer("published_version_id"),
});

// Draft/published snapshots — one row per saved version of a page. Generated
// from the same collection config that drives the versioned API + validation.
export const pagesVersions = collectionVersionsTable(pagesCollection);

export { inquiries, media, siteSettings };
