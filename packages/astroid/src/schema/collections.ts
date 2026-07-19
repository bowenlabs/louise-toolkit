// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Astroid → Louise content mapping. This is the opinionated seam: given an
// Astroid project config, derive the Louise `CollectionConfig`(s) a site needs.
// Astroid decides WHICH collections and fields exist (its opinions); Louise's
// codegen decides HOW they become D1 tables. Dependency flows one way — this
// imports `louise-toolkit/content`, never the reverse.

// `content/define` rather than the `content` barrel: the barrel eagerly pulls the
// codegen/localApi/validation chunks, and those import drizzle-orm for real — an
// *optional* peer of louise-toolkit, so importing it here forced a package on
// consumers who only ever describe collections. This entry is the drizzle-free
// half (see louise-toolkit/src/core/content/define.ts).
import {
  type CollectionConfig,
  type ContentConfig,
  defineCollection,
  type FieldConfig,
} from "louise-toolkit/content/define";
import { sanitizeRichHtml } from "louise-toolkit/security";
// The catalog is the single declaration of what a section IS — the same object
// the on-canvas editor mounts with and this hook validates against. It lives
// beside the components (it ships as source for them) and is imported here so
// the two can't drift.
import { astroidSectionCatalog } from "../components/sections.js";
import type { AstroidConfig } from "../config.js";

/**
 * The opinionated `pages` collection — the EDITABLE page fields, versioned
 * drafts, and full-text search. Keyed to the same names as Louise's `pagesColumns`
 * so a publish's `.set()` maps straight onto the physical columns; bookkeeping
 * columns (`id`/`status`/timestamps/`publishedVersionId`) live on the table via
 * `pagesColumns`, never here — matching the site's `pages-collection.ts`.
 *
 * Validated by `defineCollection` at build time, so a malformed field shape throws
 * here rather than at codegen.
 */
export function astroidPagesCollection(config: AstroidConfig): CollectionConfig {
  // The `body` is rich HTML edited in place (`<Editable type="richtext">`) and
  // staged as a draft, so sanitize it on every write — never store raw HTML. A
  // pasted `<img>` pointing off-origin (a hotlink) is dropped: body images must
  // live in the media library. Mirrors the reference site's pages-collection hook.
  const mediaBase = config.deploy?.mediaBase ?? "/media";

  const fields: Record<string, FieldConfig> = {};
  fields.slug = { type: "text", required: true };
  fields.title = { type: "text", required: true };
  // Sanitized rich HTML (a string), not TipTap JSON — matches `pagesColumns.body`.
  fields.body = { type: "text" };
  fields.seoTitle = { type: "text" };
  fields.seoDescription = { type: "text" };
  fields.ogImage = { type: "text" };
  fields.noindex = { type: "checkbox" };
  fields.sortOrder = { type: "number" };
  // Structured page-builder blocks (the editable home), deep-validated against
  // the section catalog on write — see the beforeChange hook below.
  fields.sections = { type: "json" };

  return defineCollection({
    slug: "pages",
    fields,
    hooks: {
      beforeChange: [
        async ({ data }) => {
          let next = data;
          if (typeof next.body === "string") {
            next = { ...next, body: sanitizeRichHtml(next.body, { mediaBase }) };
          }

          if (next.sections !== undefined) {
            // DYNAMIC import, and not an oversight.
            //
            // `louise-toolkit/content`'s sections module reaches drizzle-orm for
            // real (sections → validation → `import { and, eq, ne }`), and
            // drizzle is an *optional* peer. A static import here would put it
            // back in the import graph of every caller that only DESCRIBES
            // content — which is precisely what shipped a broken `create-astroid`
            // to the registry once, and why `content/define` exists.
            //
            // create-astroid calls this function to generate a schema and never
            // runs the hook, so deferring the import keeps the CLI's graph
            // drizzle-free while the running site — where drizzle is installed —
            // gets real validation. The proper fix is to split the Rule evaluator
            // out of `validation.ts` so a drizzle-free `content/sections` entry
            // can exist; until then, this is the seam.
            const { assertValidSections, sanitizeSectionsRichText } = await import(
              "louise-toolkit/content"
            );
            // Sanitize BEFORE validating: a richText field stores HTML, and
            // validating the raw value would pass content the sanitizer is about
            // to change. Same order as the body above.
            const sections = sanitizeSectionsRichText(next.sections, astroidSectionCatalog, (html) =>
              sanitizeRichHtml(html, { mediaBase }),
            );
            // Throws LouiseValidationError → 422 with per-field violations. An
            // unknown `_type` or a field of the wrong shape is rejected at the
            // door rather than rendering as a hole later.
            await assertValidSections(astroidSectionCatalog, sections, {
              operation: "update",
              mediaBase,
            });
            next = { ...next, sections };
          }

          return next;
        },
      ],
    },
    versions: { drafts: true },
    search: { fields: ["title", "body", "sections"] },
  });
}

/**
 * The Louise `ContentConfig` for an Astroid project. Today: the `pages`
 * collection. Archetype- and module-specific collections (e.g. a portfolio
 * `gallery`) layer in here as they land — this is the single place that maps
 * brand config down to Louise content.
 */
export function astroidContentConfig(config: AstroidConfig): ContentConfig {
  return { collections: [astroidPagesCollection(config)] };
}
