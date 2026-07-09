CREATE TABLE `inquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text NOT NULL,
	`regarding` text,
	`message` text NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`content_type` text,
	`size` integer,
	`width` integer,
	`height` integer,
	`alt` text,
	`caption` text,
	`uploaded_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_key_unique` ON `media` (`key`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`og_image` text,
	`noindex` integer DEFAULT false NOT NULL,
	`sort_order` real DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` (`slug`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`site_name` text,
	`tagline` text,
	`logo_url` text,
	`favicon_url` text,
	`brand_color` text,
	`secondary_color` text,
	`tertiary_color` text,
	`font_pairing` text,
	`homepage_layout` text,
	`dark_mode` integer DEFAULT false NOT NULL,
	`theme` text,
	`spacing_preset` text,
	`type_tokens` text,
	`nav_background` text,
	`nav_text_color` text,
	`footer_background` text,
	`footer_text_color` text,
	`page_background` text,
	`surface_background` text,
	`contact_email` text,
	`contact_phone` text,
	`contact_address` text,
	`social_links` text,
	`nav_links` text,
	`meta_description` text,
	`default_og_image_url` text,
	`disable_indexing` integer DEFAULT false NOT NULL,
	`primary_domain` text,
	`domain_provider` text,
	`nameserver_delegated` integer DEFAULT false NOT NULL,
	`cf_account_id` text,
	`cf_api_token_scoped` integer DEFAULT false NOT NULL,
	`features` text,
	`custom` text,
	CONSTRAINT "site_settings_singleton" CHECK("site_settings"."id" = 1)
);
