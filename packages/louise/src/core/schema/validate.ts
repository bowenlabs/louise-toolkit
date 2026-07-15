// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/schema — run any Standard Schema and fold its result into
// Louise's own {@link ValidationViolation} shape, so a consumer-supplied
// validator (Zod/Valibot/ArkType) and the built-in `s.*` builder surface
// identical, per-field error data everywhere validation already flows.

import { LouiseValidationError, type ValidationViolation } from "../errors.js";
import type { StandardSchemaV1 } from "./standard.js";

/**
 * The outcome of {@link standardValidate}: the typed value on success, or the
 * violations on failure. Standard Schema has no notion of a non-blocking
 * warning, so every mapped violation is `"error"` severity.
 */
export type StandardParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; violations: ValidationViolation[] };

/** A Standard Schema path segment is either a bare key or a `{ key }` object. */
function segmentKey(segment: PropertyKey | StandardSchemaV1.PathSegment): string {
  return String(typeof segment === "object" ? segment.key : segment);
}

/**
 * Turn a Standard Schema issue path into a flattened, dotted string, optionally
 * under `basePath` — so a field-level schema's issues land at the field's key
 * (e.g. `slug`), and a nested issue at `slug.0`. Matches how the rest of the
 * codebase carries a single `path` string on each violation.
 */
function joinPath(
  basePath: string | undefined,
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): string {
  const parts = path ? path.map(segmentKey) : [];
  if (basePath) parts.unshift(basePath);
  return parts.join(".");
}

/** Map Standard Schema issues to {@link ValidationViolation}s under `basePath`. */
export function issuesToViolations(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
  basePath?: string,
): ValidationViolation[] {
  return issues.map((issue) => ({
    path: joinPath(basePath, issue.path),
    message: issue.message,
    severity: "error" as const,
  }));
}

/**
 * Validate `input` against any Standard Schema, awaiting an async validator.
 * Returns the typed value or the violations — never throws for a validation
 * failure (only a schema that itself throws would propagate). `basePath`
 * prefixes every violation path, so a caller validating one field's value can
 * anchor the issues at that field's key.
 */
export async function standardValidate<Schema extends StandardSchemaV1>(
  schema: Schema,
  input: unknown,
  basePath?: string,
): Promise<StandardParseResult<StandardSchemaV1.InferOutput<Schema>>> {
  let result = schema["~standard"].validate(input);
  if (result instanceof Promise) result = await result;
  if (result.issues) {
    return { ok: false, violations: issuesToViolations(result.issues, basePath) };
  }
  return { ok: true, value: result.value };
}

/**
 * Validate `input` and return the typed value, throwing
 * {@link LouiseValidationError} (carrying the structured violations) on
 * failure. For call sites that want an exception rather than a result branch —
 * e.g. sharing the same `instanceof LouiseValidationError → 422` mapping the
 * `Rule` engine already uses.
 */
export async function parseOrThrow<Schema extends StandardSchemaV1>(
  schema: Schema,
  input: unknown,
): Promise<StandardSchemaV1.InferOutput<Schema>> {
  const result = await standardValidate(schema, input);
  if (!result.ok) {
    const summary = result.violations.map((v) => v.message).join("; ");
    throw new LouiseValidationError(`Validation failed: ${summary}`, result.violations);
  }
  return result.value;
}
