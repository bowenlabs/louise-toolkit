// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Astroid → Louise content mapping. This is the opinionated seam: given an
// Astroid project config, derive the Louise `CollectionConfig`(s) a site needs.
// Astroid decides WHICH collections and fields exist (its opinions); Louise's
// codegen decides HOW they become D1 tables. Dependency flows one way — this
// imports `louise-toolkit/content`, never the reverse.

// `content/define` and `content/sections` rather than the `content` barrel: the
// barrel eagerly pulls the codegen/localApi/validation chunks, and those import
// drizzle-orm for real — an *optional* peer of louise-toolkit, so importing it
// here would force a package on consumers who only DESCRIBE content (e.g.
// create-astroid's schema generators, which call this function but never run the
// beforeChange hook below). Both entries are drizzle-free: `content/define` for
// the config types/builders, and `content/sections` for the write-time section
// validators. That second entry is what the Rule-evaluator split
// (louise-toolkit/src/core/content/rule.ts) added, so this hook can import the
// validators STATICALLY instead of the dynamic `import("louise-toolkit/content")`
// it used to need to keep the CLI's graph drizzle-free.
import {
  type CollectionConfig,
  type ContentConfig,
  defineCollection,
  type FieldConfig,
} from "louise-toolkit/content/define";
import { assertValidSections, sanitizeSectionsRichText } from "louise-toolkit/content/sections";
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
/** The media base a `pages` write sanitizes rich content against (config, `/media` default). */
function pageMediaBase(config: AstroidConfig): string {
  return config.deploy?.mediaBase ?? "/media";
}

/**
 * Return a copy of a `pages` write payload with its `sections` rich-text fields
 * sanitized against the project media base — a no-op when the write carries no
 * `sections`. Pure; leaves every other field (and a partial PATCH's absent ones)
 * untouched.
 *
 * Exported because two write paths need it: the collection's `beforeChange` hook
 * below, AND the raw `pagesRoute` (which does not run collection hooks — see
 * {@link astroidPagesWriteHooks}).
 */
export function sanitizeAstroidPageSections(
  config: AstroidConfig,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (data.sections === undefined) return data;
  const mediaBase = pageMediaBase(config);
  const sections = sanitizeSectionsRichText(data.sections, astroidSectionCatalog, (html) =>
    sanitizeRichHtml(html, { mediaBase }),
  );
  return { ...data, sections };
}

/**
 * Validate the (already-sanitized) `sections` of a `pages` write against the
 * catalog, throwing `LouiseValidationError` — an unknown `_type`, a field of the
 * wrong shape, or a setting outside its declared options is rejected with a 422
 * carrying the per-field violations. A no-op when the write carries no
 * `sections`, so a partial PATCH of other fields isn't spuriously validated.
 */
export async function assertAstroidPageSections(
  config: AstroidConfig,
  data: Record<string, unknown>,
  operation: "create" | "update" = "update",
): Promise<void> {
  if (data.sections === undefined) return;
  await assertValidSections(astroidSectionCatalog, data.sections, {
    operation,
    mediaBase: pageMediaBase(config),
  });
}

/**
 * The write-time hooks the raw `pagesRoute` (louise-toolkit/editor) needs to
 * enforce the same section contract as the draft path.
 *
 * `pagesRoute` writes straight to the table and — unlike `versionsRoute` — takes
 * no collection config, so it never runs the `beforeChange` hook below. Left
 * bare (as it was), a direct `POST` / `PATCH /api/louise/pages/:id` persists an
 * unknown section `_type`, a setting outside its options, or unsanitized section
 * rich text: exactly what the hook exists to stop, silently missing from the one
 * route the on-canvas *structural* edits flow through. `<Sections>` then skips
 * the bad `_type`, so the section just vanishes with no error anywhere.
 *
 * These wire the SAME sanitize + validate the hook uses into `pagesRoute`'s
 * `sanitize` / `transform` / `validate` seams, so both write paths enforce one
 * contract. Spread into the route config:
 *
 *   pagesRoute({ table: pages, resolveEditor, fields, ...astroidPagesWriteHooks(config) })
 */
export function astroidPagesWriteHooks(config: AstroidConfig): {
  sanitize: (html: string) => string;
  transform: (data: Record<string, unknown>) => Record<string, unknown>;
  validate: (
    data: Record<string, unknown>,
    ctx: { operation: "create" | "update" },
  ) => Promise<void>;
} {
  const mediaBase = pageMediaBase(config);
  return {
    // `body` is a richField, so it goes through pagesRoute's own sanitize seam —
    // with the project media base, matching the hook rather than the toolkit
    // default sanitizer that knows no media base.
    sanitize: (html) => sanitizeRichHtml(html, { mediaBase }),
    // `sections` is not a richField, so it's sanitized here in the transform,
    // which pagesRoute runs BEFORE validate — the hook's sanitize-then-validate
    // order.
    transform: (data) => sanitizeAstroidPageSections(config, data),
    validate: (data, ctx) => assertAstroidPageSections(config, data, ctx.operation),
  };
}

export function astroidPagesCollection(config: AstroidConfig): CollectionConfig {
  // The `body` is rich HTML edited in place (`<Editable type="richtext">`) and
  // staged as a draft, so sanitize it on every write — never store raw HTML. A
  // pasted `<img>` pointing off-origin (a hotlink) is dropped: body images must
  // live in the media library. Mirrors the reference site's pages-collection hook.
  const mediaBase = pageMediaBase(config);

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
          // Sanitize BEFORE validating: a richText field stores HTML, and
          // validating the raw value would pass content the sanitizer is about
          // to change. Same order as the body above. Both steps are shared with
          // the raw pagesRoute (see astroidPagesWriteHooks) so the two write
          // paths can't diverge — the sanitize throws nothing, the assert throws
          // LouiseValidationError → 422 with per-field violations.
          next = sanitizeAstroidPageSections(config, next);
          await assertAstroidPageSections(config, next, "update");
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
