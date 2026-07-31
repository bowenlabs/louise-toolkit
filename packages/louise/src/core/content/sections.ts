// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/content — the structured "sections" schema + its server-side validator.
//
// A *section* is one item of a page's `sections` JSON array — `{ _type, ...fields }`
// — a discriminated block that the SITE renders with its own bespoke component.
// The catalog here is schema only (field defs); it lives in core (not the DOM
// client) so the SAME catalog object drives both the on-page editor
// (`mountSections`, which type-imports these types) and the write-time validator
// below, which the pages route runs before persisting.
//
// The catalog is the sections analogue of an `ArrayFieldConfig.discriminator`:
// `_type` selects a variant, each variant is a field map. `validateSections`
// checks the array shape and each variant's field types, and reuses the content
// `Rule` machinery (via `validateValue`) for any per-field `validation` chain.

import { LouiseValidationError, type ValidationViolation } from "../errors.js";
// The field-type registry owns what each `type` means — its validation and
// whether it's edited in place (ADR 0010 A2). Importing it for the side effect of
// registering the built-ins as well as for the checker: a catalog naming `"link"`
// is only meaningful once something has defined it.
import { type FieldOptions, type FieldTypeName, validateFieldType } from "./field-types.js";
// The drizzle-free Rule engine, NOT the `./validation.js` barrel — that half
// imports `drizzle-orm` (an *optional* peer) for its uniqueness queries, and
// importing it here would drag drizzle into every consumer of these section
// validators (e.g. the `louise-toolkit/content/sections` entry). See rule.ts's
// header and `content/define.ts`.
import { type ValidationBuilder, type ValidationFieldContext, validateValue } from "./rule.js";

// Re-exported, not defined here. The predicate belongs with the `link` field
// type in `field-types.ts`; this alias exists because `isSafeLinkUrl` shipped
// from this module in the XSS fix and `core/editor/settings.ts` imports it from
// here. Two definitions of the same allowlist briefly existed — the fix branched
// before the registry landed, and both survived the merge — which is the exact
// drift the "asserted identical in test" comments are there to prevent.
export { isSafeLinkUrl } from "./field-types.js";

/**
 * The names a section field may declare.
 *
 * Now an alias for {@link FieldTypeName} — one list for sections and settings
 * both, where there used to be `SectionFieldType` (8) and `SettingsFieldType` (6),
 * overlapping on four and disagreeing on the rest. A type added to one was
 * silently missing from the other, and that asymmetry had teeth: settings had a
 * `links` type and no `link` type, so there was nowhere for a scheme check to
 * live, and stored nav destinations went unvalidated until it was found.
 *
 * Kept as its own name because it is the published one — a site's catalog is
 * typed with it.
 */
export type SectionFieldType = FieldTypeName;

/**
 * Editor options for a `richText` field.
 *
 * Schema, not UI — plain data describing which affordances the field wants, which
 * is why it lives in core alongside the rest of the field's declaration rather
 * than with the ProseKit editor that reads it.
 */
export interface RichTextFieldOptions {
  /** The page-BUILDER palette (Hero/Columns/Gallery…). Meant for full page
   *  bodies, not a one-line heading — leave it off for most section fields. */
  blocks?: boolean;
  /** Lazy-load Harper for grammar checking. */
  grammar?: boolean;
  /** Inline formatting only — the light bubble (bold/italic/underline/strike/
   *  link/colour). `false` surfaces the prose block buttons and the AI-rewrite
   *  sparkle. Defaults to `true` for a section field. */
  minimal?: boolean;
  /** Show the "Insert image" button. Default `true`; drop it from a heading or
   *  tagline where an inline image doesn't belong. */
  image?: boolean;
  /** Single-line mode: the value serializes as inline HTML with no block wrapper,
   *  so editing can't turn an `<h1>` into a `<p>` nested inside the site's own
   *  element and lose its styling. */
  inline?: boolean;
}

export interface SectionField {
  type: SectionFieldType;
  label?: string;
  placeholder?: string;
  /**
   * `richText` only — this field's editor options.
   *
   * Declared here because they were always a property of the FIELD. They shipped
   * as a mount-level `richTextModes` map keyed by a `data-louise-rt` name the
   * render stamped, which meant a rendezvous between two files to say something
   * one of them already knew: the catalog declares a heading is a heading.
   *
   * Wins over the mount-level `richText` / `richTextModes`, both of which still
   * work.
   */
  richText?: RichTextFieldOptions;
  /** Whether this field is edited in place on the bespoke render (a visible text
   *  node) vs. in the dock (a value you can't point at, e.g. a link URL).
   *  Defaults to `true` for text/textarea, `false` for `array`. */
  inline?: boolean;
  /**
   * `select` only — the allowed values, in the order the picker shows them.
   * A stored value outside this set is a validation error, the same way an
   * undeclared `_layout` token is.
   *
   * `label` is what the editor reads; `value` is what's stored. They differ for
   * the usual reason a token differs from its presentation — "Brand" is a label,
   * `brand` is the thing the site's class map is keyed on.
   *
   * May instead be a {@link FieldOptionsResolver} — an async function returning
   * the choices — for a picker whose values come from an API rather than the
   * catalog. Note the trade: a resolved set is NOT checked on write, because that
   * would put a network call on the save path. See the `select` type's own
   * comment in `field-types.ts`.
   */
  options?: FieldOptions;
  /**
   * `select` only — an opaque hint for how the picker should render (e.g.
   * `"swatch"` for colour tokens). Passed through untouched, like
   * {@link SectionDef.icon}: the schema layer has no business knowing what a
   * swatch looks like, and a site's renderer may ignore it entirely.
   */
  display?: string;
  /** `array` only — label for each repeated item (e.g. "Feature"). */
  itemLabel?: string;
  /** `array` only — the fields of each repeated item. With a {@link SectionField.discriminator}
   *  these are the fields shared by *every* variant; the variant adds more on top. */
  itemFields?: Record<string, SectionField>;
  /**
   * `array` only — makes the array a *discriminated union* of item shapes
   * (blocks: image vs. quote vs. embed …) instead of one fixed `itemFields`
   * shape, mirroring `ArrayFieldConfig.discriminator` (`core/content/types.ts`)
   * one level down — the proving slice for a first-class `blocks` layer (ADR 0005).
   * `key` names the field holding each item's variant (set by the type-switcher,
   * not typed in place); `variants` maps each variant value to the *additional*
   * fields layered on top of `itemFields`, validated/shown only for items whose
   * `key` field holds that value. `variantsAdmin` gives the "add"/switch picker a
   * per-variant `label` + opaque `icon` string. Storage is unchanged — `array`
   * stays one JSON column; this only changes the item's field set.
   */
  discriminator?: {
    key: string;
    variants: Record<string, Record<string, SectionField>>;
    variantsAdmin?: Record<string, { label?: string; icon?: string }>;
  };
  /** Optional per-field validation, reusing the content `Rule` builder — e.g.
   *  `validation: (r) => r.required().max(120)`. Enforced server-side by
   *  {@link validateSections}. */
  validation?: ValidationBuilder;
}

export interface SectionDef {
  /** Palette label. */
  label: string;
  /** Optional palette icon (opaque string passed through). */
  icon?: string;
  /** The section's editable fields, keyed by prop name. */
  fields: Record<string, SectionField>;
  /**
   * Opt this section into the first-class **block layer** (ADR 0005) — the
   * organising layer *within* a section. Declaring this policy is what promotes
   * a section's reserved `blocks` array from ignored free-form data to a
   * validated, ordered list of polymorphic {@link BlockItem}s, each resolved
   * against the {@link BlockCatalog} passed to {@link validateSections}. This is
   * the sections analogue of `SectionField.discriminator` one level up.
   *
   * `allow` bounds which block types this section accepts (any block in the
   * catalog when omitted); `min` / `max` bound the block count. Storage is
   * unchanged — `blocks` rides in the same `sections` JSON column.
   */
  blocks?: { allow?: string[]; min?: number; max?: number };
  /**
   * Named layout variants for this section (ADR 0005 §5), surfaced in the
   * inspector rail as a picker. A stored {@link SectionItem._layout} must be one
   * of these keys. Louise stores only the chosen **token** — the site component
   * maps it to actual grid/flex/CSS, so layout stays 100% site-owned.
   */
  layouts?: Record<string, { label: string }>;
  /**
   * Non-inline **settings** fields (background, spacing, columns, alignment …),
   * edited in the inspector rail rather than in place (ADR 0005 §5). Reuse
   * {@link SectionField}, so they validate exactly like regular fields; their
   * values live under {@link SectionItem._settings}. Louise stores tokens/values
   * only, never CSS — the site component reads them and switches its own styles.
   */
  settings?: Record<string, SectionField>;
  /**
   * Where this section's CONTENT truth lives, when it isn't the page (ADR 0010
   * Phase B). `"external"` marks a section that mirrors a system the site
   * doesn't own — a Square-backed product grid — so the editor rings it yellow
   * and its wrench configures the mirror (category, filters, hidden items),
   * never the mirrored content itself. Omitted means the page owns it, which
   * is every section that existed before Phase B.
   */
  source?: "external";
  /**
   * Site-settings keys this section READS when it renders — e.g.
   * `["addressStreet", "hours"]` for a location panel. The coupling is
   * otherwise invisible (it lives inside the site's Astro component), and it
   * is what the shared-value editor counts to say "used in N surfaces"
   * before a green-ring edit changes every one of them.
   */
  consumes?: string[];
}

/** The site's catalog of preconfigured section types (schema only — the bespoke
 *  render components live on the site). */
export type SectionCatalog = Record<string, SectionDef>;

/** One block type's schema (label/icon + fields) — the block-level analogue of
 *  {@link SectionDef}. Block fields reuse {@link SectionField} verbatim, so a
 *  block validates exactly like a section's field set: the same `Rule` chain and
 *  the same `array` / `discriminator` support, no separate path. */
export interface BlockDef {
  label: string;
  icon?: string;
  fields: Record<string, SectionField>;
  /** Inspector-rail settings for this block (ADR 0005 §5) — the block-level
   *  analogue of {@link SectionDef.settings}; values live under
   *  {@link BlockItem._settings}. Blocks carry settings but not layouts. */
  settings?: Record<string, SectionField>;
}

/** The site's catalog of block types (schema only — bespoke renders live on the
 *  site), the block-level analogue of {@link SectionCatalog} (ADR 0005). */
export type BlockCatalog = Record<string, BlockDef>;

/** One stored block: a `_type` discriminant plus its field values — the
 *  block-level analogue of {@link SectionItem}. Flat and ordered; blocks do not
 *  nest blocks in v1 (named slots / cross-section moves are deferred). */
export interface BlockItem {
  _type: string;
  /** Inspector-rail setting values for this block (ADR 0005 §5), validated
   *  against {@link BlockDef.settings}. Tokens/values only, never CSS. */
  _settings?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One stored section: a `_type` discriminant plus its field values. */
export interface SectionItem {
  _type: string;
  /**
   * The optional organising layer *within* this section (ADR 0005): an ordered
   * list of polymorphic blocks. Reserved structural key — a section opts into
   * validation by declaring {@link SectionDef.blocks}. Additive: absent on every
   * pre-block section, and a section may carry both direct fields and blocks
   * during a transition.
   */
  blocks?: BlockItem[];
  /**
   * A named layout token (ADR 0005 §5) — one of {@link SectionDef.layouts}'
   * keys. Louise stores only the token; the site component maps it to CSS.
   */
  _layout?: string;
  /**
   * Inspector-rail setting values for this section (ADR 0005 §5), validated
   * against {@link SectionDef.settings}. Tokens/values only, never CSS.
   */
  _settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ValidateSectionsOptions {
  operation: "create" | "update";
  /**
   * The site's `MEDIA_URL` base. When set, an `image` field whose value is a
   * non-empty string that isn't served from this base is a violation —
   * enforcing that section images come from the media library, not an external
   * hotlink. Omit to skip the origin check (image fields still validate as
   * strings). See {@link isMediaUrl}.
   */
  mediaBase?: string;
  /**
   * The site's {@link BlockCatalog} (ADR 0005). Required to validate any
   * section that opts into the block layer via {@link SectionDef.blocks}: each
   * block's `_type` resolves to a {@link BlockDef} here and its fields validate
   * like a section's. Omit when no section uses blocks; a block whose `_type`
   * isn't in the catalog is rejected as unknown.
   */
  blockCatalog?: BlockCatalog;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a page's `sections` value against a catalog, returning every
 * violation (errors and warnings). Checks, in order:
 *  - the value is an array;
 *  - each item is an object with a `_type` present in the catalog;
 *  - each declared field's value has the right primitive shape (text/textarea →
 *    string, array → array of objects whose `itemFields` are validated in turn);
 *  - for a section that declares a `blocks` policy, its `blocks` array (count vs.
 *    `min`/`max`, each block's `_type` against the policy `allow` + the
 *    `blockCatalog`, then that block's fields — ADR 0005);
 *  - `_layout` (must be a declared layout token) and `_settings` (validated
 *    against the def's `settings` fields), on sections and blocks — ADR 0005 §5;
 *  - any field's `validation` Rule chain (reused from the content validator).
 * Absent/`undefined` (the field wasn't part of a partial update) is a no-op —
 * presence is the route allowlist's job, not this validator's.
 */
export async function validateSections(
  catalog: SectionCatalog,
  value: unknown,
  options: ValidateSectionsOptions = { operation: "update" },
): Promise<ValidationViolation[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return [{ path: "sections", message: "sections must be an array", severity: "error" }];
  }

  const violations: ValidationViolation[] = [];
  for (let i = 0; i < value.length; i++) {
    const at = `sections[${i}]`;
    const item = value[i];
    if (!isPlainObject(item)) {
      violations.push({ path: at, message: `${at} must be an object`, severity: "error" });
      continue;
    }
    const type = item._type;
    const def = typeof type === "string" ? catalog[type] : undefined;
    if (!def) {
      violations.push({
        path: `${at}._type`,
        message: `${at} has an unknown section type ${JSON.stringify(type)}`,
        severity: "error",
      });
      continue;
    }
    for (const [key, field] of Object.entries(def.fields)) {
      violations.push(
        ...(await validateSectionField(field, item[key], `${at}.${key}`, item, options)),
      );
    }
    // The first-class block layer (ADR 0005). Only sections that declare a
    // `blocks` policy validate their `blocks` array; for everything else the key
    // is ignored free-form data (same forgiveness as any undeclared key).
    if (def.blocks) {
      violations.push(...(await validateBlocks(def.blocks, item.blocks, `${at}.blocks`, options)));
    }
    // Layout token + inspector settings (ADR 0005 §5).
    violations.push(...validateLayout(def.layouts, item._layout, `${at}._layout`));
    violations.push(
      ...(await validateSettings(def.settings, item._settings, `${at}._settings`, options)),
    );
  }
  return violations;
}

/**
 * A stored `_layout` must be one of the section's declared {@link SectionDef.layouts}
 * (ADR 0005 §5) — an unknown/undeclared layout is rejected like an unknown section
 * `_type`. Absent `_layout` is a no-op; Louise stores the token, the site owns the CSS.
 */
function validateLayout(
  layouts: Record<string, { label: string }> | undefined,
  value: unknown,
  path: string,
): ValidationViolation[] {
  if (value === undefined || value === null) return [];
  const ok = typeof value === "string" && !!layouts && Object.hasOwn(layouts, value);
  return ok
    ? []
    : [
        {
          path,
          message: `${path} has an unknown layout ${JSON.stringify(value)}`,
          severity: "error",
        },
      ];
}

/**
 * Validate an item's `_settings` object against a def's `settings` field map
 * (ADR 0005 §5) — the same {@link validateSectionField} machinery as regular
 * fields, one level in. Undeclared setting keys are ignored (like undeclared
 * fields); absent `_settings` is a no-op. Shared by sections and blocks.
 */
async function validateSettings(
  settings: Record<string, SectionField> | undefined,
  value: unknown,
  path: string,
  options: ValidateSectionsOptions,
): Promise<ValidationViolation[]> {
  if (value === undefined || value === null) return [];
  if (!isPlainObject(value)) {
    return [{ path, message: `${path} must be an object`, severity: "error" }];
  }
  const out: ValidationViolation[] = [];
  for (const [key, field] of Object.entries(settings ?? {})) {
    out.push(...(await validateSectionField(field, value[key], `${path}.${key}`, value, options)));
  }
  return out;
}

/**
 * Validate one section's {@link SectionItem.blocks} array against its
 * {@link SectionDef.blocks} policy and the {@link ValidateSectionsOptions.blockCatalog}.
 * Mirrors the top-level section pass one level down: the array shape, then each
 * block's `_type` (allowed by policy and present in the catalog), then each of
 * that block's declared fields via {@link validateSectionField}. An absent
 * `blocks` is a no-op (presence is the route allowlist's job); an empty/short
 * array is measured against `min`/`max`.
 */
async function validateBlocks(
  policy: NonNullable<SectionDef["blocks"]>,
  value: unknown,
  path: string,
  options: ValidateSectionsOptions,
): Promise<ValidationViolation[]> {
  if (value === undefined || value === null) return [];
  const out: ValidationViolation[] = [];
  if (!Array.isArray(value)) {
    out.push({ path, message: `${path} must be an array`, severity: "error" });
    return out;
  }
  if (policy.min !== undefined && value.length < policy.min) {
    out.push({
      path,
      message: `${path} must have at least ${policy.min} block${policy.min === 1 ? "" : "s"}`,
      severity: "error",
    });
  }
  if (policy.max !== undefined && value.length > policy.max) {
    out.push({
      path,
      message: `${path} must have at most ${policy.max} block${policy.max === 1 ? "" : "s"}`,
      severity: "error",
    });
  }

  const catalog = options.blockCatalog ?? {};
  for (let j = 0; j < value.length; j++) {
    const at = `${path}[${j}]`;
    const block = value[j];
    if (!isPlainObject(block)) {
      out.push({ path: at, message: `${at} must be an object`, severity: "error" });
      continue;
    }
    const type = block._type;
    if (policy.allow && (typeof type !== "string" || !policy.allow.includes(type))) {
      out.push({
        path: `${at}._type`,
        message: `${at} has a block type ${JSON.stringify(type)} not allowed in this section`,
        severity: "error",
      });
      continue;
    }
    const def = typeof type === "string" ? catalog[type] : undefined;
    if (!def) {
      out.push({
        path: `${at}._type`,
        message: `${at} has an unknown block type ${JSON.stringify(type)}`,
        severity: "error",
      });
      continue;
    }
    for (const [key, field] of Object.entries(def.fields)) {
      out.push(...(await validateSectionField(field, block[key], `${at}.${key}`, block, options)));
    }
    // Block inspector settings (ADR 0005 §5) — blocks carry `_settings`, not `_layout`.
    out.push(
      ...(await validateSettings(def.settings, block._settings, `${at}._settings`, options)),
    );
  }
  return out;
}

async function validateSectionField(
  field: SectionField,
  value: unknown,
  path: string,
  document: Record<string, unknown>,
  options: ValidateSectionsOptions,
): Promise<ValidationViolation[]> {
  const out: ValidationViolation[] = [];
  const ctx: ValidationFieldContext = { document, path, operation: options.operation };

  if (field.type === "array") {
    if (value !== undefined && value !== null) {
      if (!Array.isArray(value)) {
        out.push({ path, message: `${path} must be an array`, severity: "error" });
      } else {
        const disc = field.discriminator;
        for (let j = 0; j < value.length; j++) {
          const subPath = `${path}[${j}]`;
          const sub = value[j];
          if (!isPlainObject(sub)) {
            out.push({ path: subPath, message: `${subPath} must be an object`, severity: "error" });
            continue;
          }
          // Base fields (shared by every variant). With a discriminator, the
          // item's `key` value selects a variant whose fields layer on top; an
          // absent or unknown variant is rejected (like an unknown section `_type`).
          let itemFields = field.itemFields ?? {};
          if (disc) {
            const variant = sub[disc.key];
            const variantFields = typeof variant === "string" ? disc.variants[variant] : undefined;
            if (!variantFields) {
              out.push({
                path: `${subPath}.${disc.key}`,
                message: `${subPath} has an unknown variant ${JSON.stringify(variant)}`,
                severity: "error",
              });
              continue;
            }
            itemFields = { ...itemFields, ...variantFields };
          }
          for (const [subKey, subField] of Object.entries(itemFields)) {
            out.push(
              ...(await validateSectionField(
                subField,
                sub[subKey],
                `${subPath}.${subKey}`,
                sub,
                options,
              )),
            );
          }
        }
      }
    }
  } else {
    // Every non-structural type is the registry's business (ADR 0010 A2). What
    // was an if/else ladder here — one arm per type, and a fallthrough that
    // quietly covered text/textarea/richText — is now one lookup, so adding a
    // type never means remembering to come back and edit this function.
    out.push(...validateFieldType(value, { field, path, mediaBase: options.mediaBase }));
  }

  // Per-field declared rules (required/min/max/custom…), reusing the content Rule
  // evaluator so sections and collection fields validate identically.
  out.push(...(await validateValue(field.validation, value, ctx)));
  return out;
}

/**
 * Run {@link validateSections} and throw {@link LouiseValidationError} if any
 * error-severity violations are found (warnings are returned, never thrown).
 * Mirrors {@link assertValid} so the pages route can reject an invalid
 * `sections` write with a 422 carrying the per-field violations.
 */
export async function assertValidSections(
  catalog: SectionCatalog,
  value: unknown,
  options: ValidateSectionsOptions = { operation: "update" },
): Promise<ValidationViolation[]> {
  const violations = await validateSections(catalog, value, options);
  const errors = violations.filter((v) => v.severity === "error");
  if (errors.length > 0) {
    throw new LouiseValidationError(
      `Invalid sections: ${errors.map((v) => v.message).join("; ")}`,
      violations,
    );
  }
  return violations;
}

/** Sanitize the `richText` string fields of one section/block item against its
 *  field defs, leaving everything else untouched.
 *
 *  Recurses into `array` fields via their `itemFields`. That is not a nicety:
 *  `SectionField` lets an `array` declare a `richText` item field, and a catalog
 *  promptly did — Astroid's `faq.items[].answer` is richText and is rendered with
 *  `set:html`. One level of walking meant it was stored exactly as typed, so the
 *  "never store raw HTML" invariant held everywhere except the one place a
 *  catalog author would naturally reach for it, with CSP as the only remaining
 *  defence. Anything the schema can express, this has to cover. */
function sanitizeItemRichText(
  item: Record<string, unknown>,
  fields: Record<string, SectionField> | undefined,
  sanitize: (html: string) => string,
): Record<string, unknown> {
  if (!fields) return item;
  let out = item;
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "richText" && typeof out[key] === "string") {
      out = { ...out, [key]: sanitize(out[key] as string) };
      continue;
    }
    // An `array` field holds rows shaped by `itemFields`, which may themselves
    // declare richText. Nested arrays recurse the same way.
    if (field.type === "array" && field.itemFields && Array.isArray(out[key])) {
      const rows = out[key] as unknown[];
      out = {
        ...out,
        [key]: rows.map((row) =>
          isPlainObject(row) ? sanitizeItemRichText(row, field.itemFields, sanitize) : row,
        ),
      };
    }
  }
  return out;
}

/**
 * Return a copy of a page's `sections` with every `richText` field — section-level
 * and block-level — run through `sanitize`. A richText field stores HTML (edited
 * in place with the light ProseKit editor, #182), so it must be sanitized on write
 * just like the page body; call this from the collection's `beforeChange` next to
 * the body sanitize. Non-array input and unknown `_type`s pass through untouched.
 *
 * `array` item fields ARE recursed, at any depth: a catalog can declare richText
 * inside `itemFields`, so anything the schema can express must be covered here.
 */
export function sanitizeSectionsRichText(
  sections: unknown,
  catalog: SectionCatalog,
  sanitize: (html: string) => string,
  blockCatalog: BlockCatalog = {},
): unknown {
  if (!Array.isArray(sections)) return sections;
  return sections.map((section) => {
    if (!isPlainObject(section)) return section;
    let out = sanitizeItemRichText(section, catalog[String(section._type)]?.fields, sanitize);
    if (Array.isArray(out.blocks)) {
      out = {
        ...out,
        blocks: out.blocks.map((block) =>
          isPlainObject(block)
            ? sanitizeItemRichText(block, blockCatalog[String(block._type)]?.fields, sanitize)
            : block,
        ),
      };
    }
    return out;
  });
}
