---
"louise-toolkit": minor
---

An owner can mark an image as decorative, and AI alt text gets the image's context (#599).

- **Three alt states:** `NULL` is not written yet, `""` is decorative (HTML's "skip this image"), and any other text is the description. The Media panel's alt editor and the rich-text image control each get a **Decorative image** checkbox. The media route's `PATCH` now stores a `null` alt as `NULL` instead of `''`, and rich text serializes a decorative image as `alt=""` and parses it back, where it used to drop the attribute.
- **Only NULL is missing:** the alt backfill selects `"alt" IS NULL`, so it no longer regenerates an image the owner cleared on purpose. `MEDIA_ALT_MISSING_SQL` exports the condition for a site's health scan.
- **Context:** `AltTextOptions.context` (`pageTitle`, `heading`, `caption`, `href`) is folded into the prompt, and a linked image is described by where the link goes. The backfill passes the image's caption. Without context, the prompt is unchanged.

What to know when you upgrade:

- **Run the migration before the new count goes live.** An existing `''` alt is ambiguous: it used to mean both "not written" and "cleared". `MEDIA_ALT_UNDECIDED_SQL("media")` is the one-time statement, `UPDATE "media" SET "alt" = NULL WHERE "alt" = '';`, which makes each one "not written" so nothing silently becomes decorative. Add it as a D1 migration with your media table's name.
- **A site's health scan** should count missing alt text with `MEDIA_ALT_MISSING_SQL`, or decorative images stay on the owner's to-do list.
