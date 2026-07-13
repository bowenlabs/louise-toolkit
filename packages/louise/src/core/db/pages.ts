// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework-owned `pages` — the generic CMS page table every Louise site has
// (slug, title, sanitized rich body, publish status, SEO/OG, ordering,
// timestamps). Owning the column set here stops it drifting between client
// sites (the `site_settings` precedent). Import `pagesColumns` to compose your
// own table (adding site-specific columns), or use the ready-made `pages` table
// when the generic set is enough — drizzle-kit still generates the migration
// from your composed schema either way.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The framework-generic `pages` columns. Spread into your own
 * `sqliteTable("pages", { ...pagesColumns, /* extras *​/ })` to extend, or use
 * the ready-made {@link pages} table when the generic set is enough.
 */
export const pagesColumns = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  /** Sanitized rich HTML — run `sanitizeRichHtml` (louise/security) on write
   *  and render. */
  body: text("body"),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  /** Absolute URL of the page's Open Graph share image; null falls back to the
   *  site-wide default in `site_settings`. */
  ogImage: text("og_image"),
  /** Keep the page out of search indexes (legal pages, private notes). */
  noindex: integer("noindex", { mode: "boolean" }).notNull().default(false),
  sortOrder: real("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
};

/**
 * The ready-made `pages` table. Use directly when the generic column set is
 * enough; otherwise compose your own from {@link pagesColumns}.
 */
export const pages = sqliteTable("pages", pagesColumns);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
