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
export type SectionFieldType = "text" | "textarea" | "array" | "image";

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
}

/** The site's catalog of preconfigured section types (schema only — the bespoke
 *  render components live on the site). */
export type SectionCatalog = Record<string, SectionDef>;

/** One stored section: a `_type` discriminant plus its field values. */
export interface SectionItem {
  _type: string;
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
  }
  return violations;
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
