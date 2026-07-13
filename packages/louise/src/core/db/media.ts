// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework-owned `media` asset registry — turns "R2 file picker" into a real
// media library. Tracked assets carry verified type/size/dimensions plus
// asset-level `alt`/`caption`, are reusable across collection items, and make
// delete-safety a join (with `louise/media`'s LIKE scan retained as a
// fallback for rich-text `<img src>` embeds that don't reference a row).
//
// A CMS `upload` field stores this row's `id`/`key`; the item then carries the
// asset's alt/caption/dimensions by join. `alt` is an asset-level default
// (reused everywhere, DRY); a per-usage override and per-usage crop live on the
// consumer row, not here. Compose with `mediaColumns` or use the ready-made
// `media` table — drizzle-kit generates the migration from your schema either
// way (the `pages`/`site_settings` precedent).

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The framework-generic `media` columns. Spread into your own
 * `sqliteTable("media", { ...mediaColumns, /* extras *​/ })` to extend, or use
 * the ready-made {@link media} table when the generic set is enough.
 */
export const mediaColumns = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** R2 object key; the public URL is `MEDIA_URL` + "/" + key. Unique. */
  key: text("key").notNull().unique(),
  /** Verified MIME (from `sniffImageType`), never the client-supplied type. */
  contentType: text("content_type"),
  /** Size in bytes. */
  size: integer("size"),
  /** Intrinsic pixel dimensions, when known. */
  width: integer("width"),
  height: integer("height"),
  /** Accessibility / SEO description — the asset-level default. */
  alt: text("alt"),
  caption: text("caption"),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
};

/**
 * The ready-made `media` table. Use directly when the generic column set is
 * enough; otherwise compose your own from {@link mediaColumns}.
 */
export const media = sqliteTable("media", mediaColumns);

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
