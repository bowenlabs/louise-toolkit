// Louise CMS tables for the dogfood. `media`, `inquiries`, and `site_settings`
// use the ready-made framework tables; `pages` is composed from the framework
// `pagesColumns` plus a site-specific `sections` JSON column — an ordered array
// of structured section items (`{ _type, ...fields }`) rendered by the site's
// own bespoke components (the preconfigured-blocks model). drizzle-kit reads this
// to generate migrations; the Worker's editor routes import the composed `pages`.
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { inquiries, media, pagesColumns, siteSettings } from "louisecms/db";

export const pages = sqliteTable("pages", {
  ...pagesColumns,
  sections: text("sections", { mode: "json" }).$type<Record<string, unknown>[]>(),
});

export { inquiries, media, siteSettings };
