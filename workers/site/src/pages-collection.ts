// The `pages` collection modeled for louisecms/cms — the source of truth for the
// draft/publish + version-history workflow. `versions.drafts` opts the collection
// into a `pages_versions` snapshot table (see schema.ts) and the versioned Local
// API; `versionsRoute` (worker.ts) exposes it. The `fields` here mirror the
// EDITABLE page columns (keyed by the drizzle property names on the `pages` table
// so publish's `.set()` maps straight onto columns) — bookkeeping columns
// (`id`, `status`, `publishedVersionId`, timestamps) are deliberately absent, so
// a draft snapshot never carries them.
import { defineCollection } from "louisecms/cms";

export const pagesCollection = defineCollection({
  slug: "pages",
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
});
