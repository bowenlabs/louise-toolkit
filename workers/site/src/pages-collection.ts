// The `pages` collection modeled for louise/cms — the source of truth for the
// draft/publish + version-history workflow. `versions.drafts` opts the collection
// into a `pages_versions` snapshot table (see schema.ts) and the versioned Local
// API; `versionsRoute` (worker.ts) exposes it. The `fields` here mirror the
// EDITABLE page columns (keyed by the drizzle property names on the `pages` table
// so publish's `.set()` maps straight onto columns) — bookkeeping columns
// (`id`, `status`, `publishedVersionId`, timestamps) are deliberately absent, so
// a draft snapshot never carries them.
import { defineCollection } from "louise/cms";
import { sanitizeRichHtml } from "louise/security";

// The site's media base — matches `vars.MEDIA_URL` in wrangler.jsonc. Passed to
// the sanitizer so a pasted body `<img>` pointing at an external origin (a
// hotlink) is dropped: body images must be uploaded into the media library (#47).
const MEDIA_BASE = "/media";

export const pagesCollection = defineCollection({
  slug: "pages",
  // Sanitize the rich-text `body` on every write (draft save, publish, direct
  // update). The body used to be sanitized only on the live `/save` route; now
  // that body edits stage drafts via the versioned API, the sanitize must live
  // on the collection so it covers saveDraft/publish too — never store raw HTML.
  hooks: {
    beforeChange: [
      ({ data }) =>
        typeof data.body === "string"
          ? { ...data, body: sanitizeRichHtml(data.body, { mediaBase: MEDIA_BASE }) }
          : data,
    ],
  },
  fields: {
    slug: { type: "text", required: true },
    title: { type: "text", required: true },
    body: { type: "text" },
    seoTitle: { type: "text" },
    seoDescription: { type: "text" },
    ogImage: { type: "text" },
    noindex: { type: "checkbox" },
    sortOrder: { type: "number" },
    // The structured sections array (deep-validated separately by
    // assertValidSections on the draft-save path).
    sections: { type: "json" },
  },
  // Every op requires an editor session (defense in depth; the route also
  // guards). Publishing is its own privilege — the versioned API gates it via
  // `access.publish`.
  access: {
    read: (ctx) => Boolean(ctx?.session),
    create: (ctx) => Boolean(ctx?.session),
    update: (ctx) => Boolean(ctx?.session),
    delete: (ctx) => Boolean(ctx?.session),
    publish: (ctx) => Boolean(ctx?.session),
  },
  versions: { drafts: true },
  // Full-text search over the page title, body, and (flattened) sections content
  // — indexed into a `pages_fts` FTS5 table, kept in sync on publish.
  search: { fields: ["title", "body", "sections"] },
});
