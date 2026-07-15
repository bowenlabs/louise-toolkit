// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms — validate + coerce a submission against a form's fields.
// Reuses the shared `Rule`/`validateValue` engine (louise-toolkit/content) so the client
// mirror and the server run exactly the same checks — plus per-type built-ins
// (email/url format, select allowlist, number coercion) and the `required` flag.

import { type Rule, type ValidationBuilder, validateValue } from "../content/validation.js";
import type { ValidationViolation } from "../errors.js";
import { standardValidate } from "../schema/index.js";
import type { FormConfig, FormField } from "./types.js";

// A loose URL check (scheme + host); the input `type=url` mirrors it client-side.
const URL_RE = /^https?:\/\/[^\s.]+\.\S+$/i;

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Coerce a raw submitted value to the field's stored shape: numbers to `number`,
 * checkboxes to `boolean`, everything else to a trimmed string (or `null` when
 * blank so an optional field stores NULL, not `""`).
 */
export function coerceFormValue(field: FormField, raw: unknown): unknown {
  if (field.type === "checkbox") {
    // HTML checkboxes submit "on"/absent; JSON may send a real boolean.
    return raw === true || raw === "on" || raw === "true" || raw === "1";
  }
  if (isEmpty(raw)) return null;
  if (field.type === "number") {
    const n = Number(String(raw).trim());
    return Number.isNaN(n) ? String(raw).trim() : n; // keep raw string if unparseable → NaN check flags it
  }
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
  if (field.type === "url") parts.push((r) => r.regex(URL_RE, "be a valid URL"));
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
  if (field.type === "number" && typeof value === "string" && value !== "") {
    return [{ path: key, message: `${field.label} must be a number`, severity: "error" }];
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
 * are ignored — only declared fields are read and stored.
 */
export async function validateSubmission(
  config: FormConfig,
  data: Record<string, unknown>,
): Promise<SubmissionResult> {
  const values: Record<string, unknown> = {};
  const violations: ValidationViolation[] = [];

  for (const [key, field] of Object.entries(config.fields)) {
    const value = coerceFormValue(field, data[key]);
    values[key] = value;
    violations.push(...(await validateField(key, field, value, data)));
  }

  return { values, violations };
}
