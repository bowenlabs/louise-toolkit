// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms—validate + coerce a submission against a form's fields.
// Reuses the shared `Rule`/`validateValue` engine (louise-toolkit/content) so the client
// mirror and the server run exactly the same checks—plus per-type built-ins
// (email/url format, select allowlist, number coercion) and the `required` flag.

import { type Rule, type ValidationBuilder, validateValue } from "../content/rule.js";
import type { ValidationViolation } from "../errors.js";
import { standardValidate } from "../schema/index.js";
import type { FormConfig, FormField } from "./types.js";

// A loose URL check (scheme + host); the input `type=url` mirrors it client-side.
const URL_RE = /^https?:\/\/[^\s.]+\.\S+$/i;

/** How a field reads what people type. */
export interface CoerceOptions {
  /**
   * The site's BCP 47 locale, from `FormConfig.locale`. With it, a `number`
   * field reads that locale's grouping and decimal separators, so `1,000` is
   * one thousand in `en-US` and `1.000,5` is a thousand and a half in `de-DE`.
   * Without it, a number must be written as `Number()` reads it.
   */
  locale?: string;
}

/**
 * Add `https://` to a web address typed without a scheme, such as
 * `example.com/menu`, when what comes before the first `/` looks like a host: a
 * dot inside it, no spaces. Anything else comes back unchanged for the check to
 * judge.
 */
function withScheme(value: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  const bare = value.startsWith("//") ? value.slice(2) : value;
  const host = bare.split(/[/?#]/, 1)[0] as string;
  return !/\s/.test(bare) && /^[^.]+\.[^.]/.test(host) ? `https://${bare}` : value;
}

/** Read a number written with `locale`'s grouping and decimal separators. */
function localeNumber(text: string, locale: string): number {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === "group")?.value ?? "";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  let normalized = text;
  // A space-like group separator (U+00A0, U+202F) is typed as a plain space.
  if (group && /\s/.test(group)) normalized = normalized.replace(/\s/g, "");
  else if (group) normalized = normalized.split(group).join("");
  if (decimal !== ".") normalized = normalized.split(decimal).join(".");
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(normalized) ? Number(normalized) : Number.NaN;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Coerce a raw submitted value to the field's stored shape: numbers to `number`,
 * checkboxes to `boolean`, everything else to a trimmed string (or `null` when
 * blank so an optional field stores NULL, not `""`). A `url` typed without a
 * scheme gains `https://`, and a `number` reads the grouping separators of
 * `options.locale` when there is one.
 */
export function coerceFormValue(
  field: FormField,
  raw: unknown,
  options: CoerceOptions = {},
): unknown {
  if (field.type === "checkbox") {
    // HTML checkboxes submit "on"/absent; JSON may send a real boolean.
    return raw === true || raw === "on" || raw === "true" || raw === "1";
  }
  if (isEmpty(raw)) return null;
  if (field.type === "number") {
    const text = String(raw).trim();
    const n = options.locale ? localeNumber(text, options.locale) : Number(text);
    return Number.isNaN(n) ? text : n; // keep raw string if unparseable → NaN check flags it
  }
  if (field.type === "url") return withScheme(String(raw).trim());
  return String(raw).trim();
}

/**
 * The effective validation for a field: the type's built-in check (email/url
 * format) composed with the author's `validation` chain, as independent Rule
 * chains. Returns `undefined` when the field has neither.
 */
function fieldValidation(field: FormField): ValidationBuilder | undefined {
  const parts: ValidationBuilder[] = [];
  if (field.type === "email") parts.push((r) => r.email());
  if (field.validation) parts.push(field.validation);
  if (parts.length === 0) return undefined;
  return (r) =>
    parts.flatMap((p) => {
      const built = p(r);
      return Array.isArray(built) ? built : [built];
    }) as Rule[];
}

export interface SubmissionResult {
  /** Coerced values keyed by field name (ready to store). */
  values: Record<string, unknown>;
  /** All validation violations (errors + warnings). */
  violations: ValidationViolation[];
}

/**
 * Validate one already-coerced field value: the `required` flag, the per-type
 * built-in checks (email/url format, select allowlist, number), and the field's
 * `validation` chain (via {@link validateValue}). `data` is the whole submission
 * (for cross-field custom validators). Shared by {@link validateSubmission} and
 * the TanStack Form adapter, so both run identical rules.
 */
export async function validateField(
  key: string,
  field: FormField,
  value: unknown,
  data: Record<string, unknown> = {},
): Promise<ValidationViolation[]> {
  if (field.required && isEmpty(value)) {
    return [{ path: key, message: `${field.label} is required`, severity: "error" }];
  }
  // Worded as the fix, with an example of what works.
  if (field.type === "number" && typeof value === "string" && value !== "") {
    return [{ path: key, message: "Enter a number, like 1200.", severity: "error" }];
  }
  if (field.type === "url" && typeof value === "string" && value !== "" && !URL_RE.test(value)) {
    return [{ path: key, message: "Enter a web address, like example.com.", severity: "error" }];
  }
  if (
    field.type === "select" &&
    !isEmpty(value) &&
    field.options &&
    !field.options.includes(String(value))
  ) {
    return [{ path: key, message: `${field.label} is not a valid choice`, severity: "error" }];
  }
  const violations = await validateValue(fieldValidation(field), value, {
    document: data,
    path: key,
    operation: "create",
  });
  // A consumer-supplied Standard Schema runs alongside the `Rule` chain, on the
  // coerced value. Skipped when empty so an optional blank field stays valid
  // (the `required` flag / a `.required()` rule already guards presence).
  if (field.schema && !isEmpty(value)) {
    const parsed = await standardValidate(field.schema, value, key);
    if (!parsed.ok) violations.push(...parsed.violations);
  }
  return violations;
}

/**
 * Validate + coerce a raw submission (`data`) against a form's fields. Runs the
 * `required` flag, the per-type built-in checks, the select allowlist, and each
 * field's `validation` chain (via {@link validateValue}). Unknown keys in `data`
 * are ignored—only declared fields are read and stored.
 */
export async function validateSubmission(
  config: FormConfig,
  data: Record<string, unknown>,
): Promise<SubmissionResult> {
  const values: Record<string, unknown> = {};
  const violations: ValidationViolation[] = [];

  for (const [key, field] of Object.entries(config.fields)) {
    const value = coerceFormValue(field, data[key], { locale: config.locale });
    values[key] = value;
    violations.push(...(await validateField(key, field, value, data)));
  }

  return { values, violations };
}
