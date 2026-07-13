// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework-owned `site_settings` — the singleton config row a Louise site
// keeps (identity, appearance, structural colors, contact, nav, SEO, domain,
// feature toggles). It's entirely framework-generic, so owning it here stops it
// drifting between client sites (pt#83). Import `siteSettingsColumns` to compose
// your own table (adding site-specific columns), or use the ready-made
// `siteSettings` table when the generic set is enough. Either way drizzle-kit
// still generates the migration from your composed schema.
//
// `id` is pinned to 1 by a CHECK: this is a single config row, not a list.

import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JsonValue } from "../cms/index.js";

/**
 * The framework-generic `site_settings` columns. Spread these into your own
 * `sqliteTable("site_settings", …)` to add site-specific columns, or use the
 * ready-made {@link siteSettings} table when the generic set is enough.
 */
export const siteSettingsColumns = {
  id: integer("id").primaryKey().default(1),

  // identity
  siteName: text("site_name"),
  tagline: text("tagline"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),

  // appearance
  brandColor: text("brand_color"),
  secondaryColor: text("secondary_color"),
  tertiaryColor: text("tertiary_color"),
  fontPairing: text("font_pairing"),
  homepageLayout: text("homepage_layout"),
  darkMode: integer("dark_mode", { mode: "boolean" }).notNull().default(false),
  theme: text("theme"),
  spacingPreset: text("spacing_preset"),
  typeTokens: text("type_tokens", { mode: "json" }).$type<JsonValue>(),

  // structural colors
  navBackground: text("nav_background"),
  navTextColor: text("nav_text_color"),
  footerBackground: text("footer_background"),
  footerTextColor: text("footer_text_color"),
  pageBackground: text("page_background"),
  surfaceBackground: text("surface_background"),

  // contact
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  socialLinks: text("social_links", { mode: "json" }).$type<JsonValue>(),

  // nav
  navLinks: text("nav_links", { mode: "json" }).$type<JsonValue>(),

  // seo
  metaDescription: text("meta_description"),
  defaultOgImageUrl: text("default_og_image_url"),
  disableIndexing: integer("disable_indexing", { mode: "boolean" }).notNull().default(false),

  // domain — populated by your provisioning tooling if you automate domain
  // setup; left blank/manual otherwise.
  primaryDomain: text("primary_domain"),
  domainProvider: text("domain_provider", {
    enum: ["cloudflare", "external", "unknown"],
  }),
  nameserverDelegated: integer("nameserver_delegated", { mode: "boolean" })
    .notNull()
    .default(false),
  cfAccountId: text("cf_account_id"),
  cfApiTokenScoped: integer("cf_api_token_scoped", { mode: "boolean" }).notNull().default(false),

  // feature toggles
  features: text("features", { mode: "json" }).$type<JsonValue>(),

  // Site-specific settings extension. The framework columns above are the
  // common base every Louise site shares; a site's own settings fields (that
  // don't map to a framework column) live here as a JSON object. The generic
  // settings handler (louise/editor) patches known framework columns for the
  // base and merges a site's declared extra keys into `custom` — so a site adds
  // its own settings without a package schema change. Keys are allowlisted by
  // the site's handler config, never written wholesale.
  custom: text("custom", { mode: "json" }).$type<JsonValue>(),
};

/**
 * The ready-made `site_settings` singleton table — `id = 1` enforced by a
 * CHECK. Use this directly when the generic column set is enough; otherwise
 * compose your own table from {@link siteSettingsColumns}.
 */
export const siteSettings = sqliteTable("site_settings", siteSettingsColumns, (table) => [
  check("site_settings_singleton", sql`${table.id} = 1`),
]);
