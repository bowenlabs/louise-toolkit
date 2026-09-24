// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/schema—run any Standard Schema and fold its result into
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
 * under `basePath`—so a field-level schema's issues land at the field's key
 * (for example, `slug`), and a nested issue at `slug.0`. Matches how the rest of the
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
 * Returns the typed value or the violations—never throws for a validation
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
 * failure. For call sites that want an exception rather than a result branch—for example,
 * sharing the same `instanceof LouiseValidationError → 422` mapping the
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

/** A single-issue failure at `path`, in the {@link StandardParseResult} shape. */
function parseFailure<T>(message: string, path = ""): StandardParseResult<T> {
  return { ok: false, violations: [{ path, message, severity: "error" }] };
}

/**
 * Parse a raw JSON string, then validate it against `schema`. A malformed body
 * becomes a violation (rather than a thrown `SyntaxError`), so a caller handles
 * "not JSON" and "wrong shape" through the same result branch—for example, parsing a
 * signature-verified webhook body post-verify, where the HMAC proves the sender
 * but not the payload's shape.
 */
export async function parseJson<Schema extends StandardSchemaV1>(
  schema: Schema,
  raw: string,
): Promise<StandardParseResult<StandardSchemaV1.InferOutput<Schema>>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return parseFailure("Invalid JSON");
  }
  return standardValidate(schema, value);
}

/**
 * Extract the first balanced JSON object/array embedded in `text`—tolerating
 * model prose and ```json fences around it—respecting strings and escapes so
 * a `}` inside a string value doesn't end the scan early. Returns the JSON
 * substring, or `null` when no balanced object/array is present. Replaces the
 * brittle `indexOf("{")`/`lastIndexOf("}")` slice.
 */
export function extractJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the JSON an LLM emitted (often wrapped in prose or a ```json fence) and
 * validate it against `schema`—the canonical untrusted-JSON case. Extracts
 * the first balanced object/array ({@link extractJson}) rather than slicing on
 * the first/last brace, then validates. Never throws: a missing/malformed JSON
 * blob or a shape mismatch both come back as violations, so callers keep a
 * graceful-degrade branch instead of a try/catch (#99). Pair with the model's
 * own `response_format`/JSON-schema constraint where the provider supports it.
 */
export async function parseModelJson<Schema extends StandardSchemaV1>(
  schema: Schema,
  modelText: string,
): Promise<StandardParseResult<StandardSchemaV1.InferOutput<Schema>>> {
  const json = extractJson(modelText);
  if (json === null) return parseFailure("No JSON object found in model output");
  return parseJson(schema, json);
}
