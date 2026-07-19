// The `pages` collection modeled for louise-toolkit/content — the source of truth for the
// draft/publish + version-history workflow. `versions.drafts` opts the collection
// into a `pages_versions` snapshot table (see schema.ts) and the versioned Local
// API; `versionsRoute` (worker.ts) exposes it. The `fields` here mirror the
// EDITABLE page columns (keyed by the drizzle property names on the `pages` table
// so publish's `.set()` maps straight onto columns) — bookkeeping columns
// (`id`, `status`, `publishedVersionId`, timestamps) are deliberately absent, so
// a draft snapshot never carries them.
import { defineCollection, sanitizeSectionsRichText } from "louise-toolkit/content";
import { sanitizeRichHtml } from "louise-toolkit/security";
import { BLOCKS } from "./sections/blocks.js";
import { SECTIONS } from "./sections/catalog.js";

// The site's media base — matches `vars.MEDIA_URL` in wrangler.jsonc. Passed to
// the sanitizer so a pasted body `<img>` pointing at an external origin (a
// hotlink) is dropped: body images must be uploaded into the media library (#47).
const MEDIA_BASE = "/media";

export const pagesCollection = defineCollection({
  slug: "pages",
  // Sanitize rich HTML on every write (draft save, publish, direct update) — the
  // body AND any `richText` section/block field (#182), which store HTML edited in
  // place. This used to live on the live `/save` route; now body/section edits
  // stage drafts via the versioned API, so the sanitize lives on the collection to
  // cover saveDraft/publish too — never store raw HTML.
  hooks: {
    beforeChange: [
      ({ data }) => {
        let out = data;
        if (typeof out.body === "string") {
          out = { ...out, body: sanitizeRichHtml(out.body, { mediaBase: MEDIA_BASE }) };
        }
        if ("sections" in out) {
          out = {
            ...out,
            sections: sanitizeSectionsRichText(
              out.sections,
              SECTIONS,
              (html) => sanitizeRichHtml(html, { mediaBase: MEDIA_BASE }),
              BLOCKS,
            ),
          };
        }
        return out;
      },
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
    // The Louise Sections array (deep-validated separately by
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
