CREATE TABLE `pages_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer NOT NULL,
	`version_data` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer,
	`scheduled_at` integer
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `published_version_id` integer;
--> statement-breakpoint
-- Backfill: one initial "published" version snapshot per currently-published
-- page (config fields, camelCase keys to match the versioned API), preserving
-- live content and seeding version history. Guarded on published_version_id so
-- re-running is a no-op.
INSERT INTO `pages_versions` (`parent_id`, `version_data`, `status`, `created_at`)
SELECT
	`id`,
	json_object(
		'slug', `slug`,
		'title', `title`,
		'body', `body`,
		'seoTitle', `seo_title`,
		'seoDescription', `seo_description`,
		'ogImage', `og_image`,
		'noindex', `noindex`,
		'sortOrder', `sort_order`,
		'sections', json(`sections`)
	),
	'published',
	unixepoch()
FROM `pages`
WHERE `status` = 'published' AND `published_version_id` IS NULL;
--> statement-breakpoint
UPDATE `pages`
SET `published_version_id` = (
	SELECT `v`.`id` FROM `pages_versions` `v`
	WHERE `v`.`parent_id` = `pages`.`id`
	ORDER BY `v`.`id` DESC LIMIT 1
)
WHERE `status` = 'published' AND `published_version_id` IS NULL;