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
import { isMediaUrl } from "../media/storage.js";
import {
  type ValidationBuilder,
  type ValidationFieldContext,
  validateValue,
} from "./validation.js";

// `image` is a media URL (string), edited in the dock via an upload/clear control
// rather than in place; it validates as a string like text/textarea.
//
// `richText` is inline-editable prose stored as a sanitized HTML string (like the
// page body) — edited in place with the light ProseKit editor (#182), so it
// carries bold/italic/link/brand-colour marks. It validates as a string; the save
// path sanitizes it (see `sanitizeSectionsRichText`).
export type SectionFieldType = "text" | "textarea" | "richText" | "array" | "image";

export interface SectionField {
  type: SectionFieldType;
  label?: string;
  placeholder?: string;
  /** Whether this field is edited in place on the bespoke render (a visible text
   *  node) vs. in the dock (a value you can't point at, e.g. a link URL).
   *  Defaults to `true` for text/textarea, `false` for `array`. */
  inline?: boolean;
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
  } else if (field.type === "image") {
    // A media URL (string). With `mediaBase`, a non-empty value must be served
    // from the media library — an external hotlink is rejected.
    if (value !== undefined && value !== null) {
      if (typeof value !== "string") {
        out.push({ path, message: `${path} must be a string`, severity: "error" });
      } else if (value !== "" && options.mediaBase && !isMediaUrl(options.mediaBase, value)) {
        out.push({
          path,
          message: `${path} must be an uploaded media asset, not an external URL`,
          severity: "error",
        });
      }
    }
  } else if (value !== undefined && value !== null && typeof value !== "string") {
    // text / textarea — a string (or absent). Empty string is allowed.
    out.push({ path, message: `${path} must be a string`, severity: "error" });
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
 *  field defs, leaving everything else untouched. */
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
 * (Array item fields are not recursed — richText is a top-level section/block field.)
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
