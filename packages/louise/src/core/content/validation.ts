// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import { and, eq, ne } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { LouiseValidationError, type ValidationViolation } from "../errors.js";
import { standardValidate } from "../schema/index.js";
import type { ContentRegistry } from "./localApi.js";
import type { CollectionConfig, FieldConfig } from "./types.js";
import { flattenDoc, flattenFields } from "./types.js";

// Mirrors localApi.ts's own local alias — drizzle's default table generic.
// oxlint-disable-next-line typescript/no-explicit-any -- matches drizzle-orm's own SQLiteTableWithColumns default generic usage
type AnyTable = SQLiteTableWithColumns<any>;

/**
 * Chainable field validation for Louise (issue #16) — adopts Sanity's
 * `defineField`/`Rule` validation API (pattern, not code). A field declares
 * `validation: (rule) => rule.required().min(2).custom(...)`; this module
 * turns that chain into a list of declarative checks and evaluates them at
 * write time (server-side, in createLocalApi) as well as anywhere the editor
 * wants synchronous feedback.
 *
 * Design notes:
 * - The builder is **immutable** — every method returns a new {@link Rule}
 *   with one more check appended, so a shared base rule can't be mutated by
 *   a consumer's chain (mirrors Sanity).
 * - Most checks are synchronous and pure (min/max/regex/custom over the
 *   value alone). Two — `unique` and `reference` — need the database and so
 *   only run where {@link validateDocument} is given a `db` (i.e. the Local
 *   API); they're skipped (not failed) in a pure client-side pass.
 */

export type ValidationSeverity = "error" | "warning";

/**
 * What a {@link CustomValidator} may return:
 * - `true` / `undefined` → valid
 * - `false` → invalid, generic message
 * - `string` → invalid, that message
 * - `{ message, severity? }` → invalid, that message at the given severity
 */
export type CustomValidatorResult =
  | boolean
  | undefined
  | string
  | { message: string; severity?: ValidationSeverity };

export interface ValidationFieldContext {
  /** The whole document being validated (nested shape, post-hooks). */
  document: Record<string, unknown>;
  /** This field's flattened key (e.g. `slug`, `shippingAddress_city`). */
  path: string;
  /** Whether this is a create or an update. */
  operation: "create" | "update";
  /** The document's id on update — lets `unique` exclude the row itself. */
  id?: number;
}

export type CustomValidator = (
  value: unknown,
  context: ValidationFieldContext,
) => CustomValidatorResult | Promise<CustomValidatorResult>;

// Internal check descriptors. `message`/`severity` are per-check overrides
// applied by `.error()`/`.warning()` to the most recently added check.
type Check = (
  | { kind: "required" }
  | { kind: "min"; n: number }
  | { kind: "max"; n: number }
  | { kind: "length"; n: number }
  | { kind: "regex"; re: RegExp; label: string }
  | { kind: "integer" }
  | { kind: "positive" }
  | { kind: "unique" }
  | { kind: "reference" }
  | { kind: "custom"; fn: CustomValidator }
) & { message?: string; severity?: ValidationSeverity };

// Pre-baked formats so consumers don't hand-roll the same regexes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Lowercase kebab slug: letters/digits separated by single hyphens.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Immutable, chainable rule builder — the value a field's `validation`
 * function receives and returns. Build a `Rule` with the module-level
 * {@link rule} factory, or accept the one passed to your `validation`
 * callback.
 */
export class Rule {
  // Frozen on construction; every builder method returns a fresh Rule.
  private readonly checks: readonly Check[];

  constructor(checks: readonly Check[] = []) {
    this.checks = checks;
  }

  private add(check: Check): Rule {
    return new Rule([...this.checks, check]);
  }

  /** Override the message of the most recently added check. */
  error(message: string): Rule {
    return this.withLast({ message, severity: "error" });
  }

  /**
   * Demote the most recently added check to a warning (non-blocking),
   * optionally with a message. Sanity's `Rule.warning()` analogue.
   */
  warning(message?: string): Rule {
    return this.withLast({
      severity: "warning",
      ...(message ? { message } : {}),
    });
  }

  private withLast(patch: Partial<Check>): Rule {
    if (this.checks.length === 0) return this;
    const next = this.checks.slice();
    next[next.length - 1] = { ...next[next.length - 1], ...patch } as Check;
    return new Rule(next);
  }

  required(): Rule {
    return this.add({ kind: "required" });
  }

  /** Minimum string length / array length / numeric value. */
  min(n: number): Rule {
    return this.add({ kind: "min", n });
  }

  /** Maximum string length / array length / numeric value. */
  max(n: number): Rule {
    return this.add({ kind: "max", n });
  }

  /** Exact string/array length. */
  length(n: number): Rule {
    return this.add({ kind: "length", n });
  }

  regex(re: RegExp, label = "match the required format"): Rule {
    return this.add({ kind: "regex", re, label });
  }

  email(): Rule {
    return this.add({ kind: "regex", re: EMAIL_RE, label: "be a valid email" });
  }

  /** Lowercase kebab-case slug format. Pair with `.unique()` for slugs. */
  slug(): Rule {
    return this.add({
      kind: "regex",
      re: SLUG_RE,
      label: "be a lowercase, hyphen-separated slug",
    });
  }

  integer(): Rule {
    return this.add({ kind: "integer" });
  }

  positive(): Rule {
    return this.add({ kind: "positive" });
  }

  /**
   * Value must be unique across the collection (DB-backed; skipped in a
   * pure client-side pass). A first-class rule rather than the hand-rolled
   * column `unique` flag, so the failure is a clear field message instead of
   * a raw UNIQUE-constraint write error.
   */
  unique(): Rule {
    return this.add({ kind: "unique" });
  }

  /**
   * For a `relationship` field: the referenced id must exist in the related
   * collection (DB-backed; skipped client-side).
   */
  reference(): Rule {
    return this.add({ kind: "reference" });
  }

  custom(fn: CustomValidator): Rule {
    return this.add({ kind: "custom", fn });
  }

  /** Internal: the accumulated checks, read by {@link validateDocument}. */
  toChecks(): readonly Check[] {
    return this.checks;
  }
}

/** Fresh, empty rule — the root of a chain. */
export function rule(): Rule {
  return new Rule();
}

/**
 * A field's `validation` value: a function from a fresh Rule to the
 * configured chain (Sanity's signature). Returning an array lets a field
 * carry several independent rule chains.
 */
export type ValidationBuilder = (r: Rule) => Rule | Rule[];

/**
 * Identity helper mirroring Sanity's `defineField` — returns the field
 * config unchanged but gives editors autocomplete and a single, greppable
 * call site for field definitions. Optional: a plain object literal is still
 * a valid field.
 */
export function defineField<T extends FieldConfig>(field: T): T {
  return field;
}

function resolveChecks(field: FieldConfig): readonly Check[] {
  if (!field.validation) return [];
  const built = field.validation(new Rule());
  const rules = Array.isArray(built) ? built : [built];
  return rules.flatMap((r) => r.toChecks());
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length === 0);
}

function sizeOf(value: unknown): { size: number; unit: string } | null {
  if (typeof value === "string") return { size: value.length, unit: "character" };
  if (Array.isArray(value)) return { size: value.length, unit: "item" };
  if (typeof value === "number") return { size: value, unit: "" };
  return null;
}

export interface ValidateDocumentOptions {
  operation: "create" | "update";
  /** Document id (update only) — passed to `unique`/custom validators. */
  id?: number;
  /**
   * Restrict validation to these flattened field keys. Used by update(),
   * which only receives a partial document — validating absent fields would
   * spuriously fail their rules. Omit to validate every field (create).
   */
  onlyFields?: ReadonlySet<string>;
  /**
   * Database handle for DB-backed rules (`unique`, `reference`). When
   * omitted, those rules are skipped — so the same function powers a pure
   * client-side validation pass.
   */
  db?: BaseSQLiteDatabase<"async", unknown>;
  /** This collection's own table (for `unique`). */
  table?: AnyTable;
  /** Registry of tables by slug (for `reference` target lookups). */
  registry?: ContentRegistry;
}

/**
 * Evaluate every field's validation rules against `doc`, returning all
 * violations (both errors and warnings). `doc` is the nested document; field
 * values are read from its flattened form so group subfields validate too.
 */
export async function validateDocument(
  config: CollectionConfig,
  doc: Record<string, unknown>,
  options: ValidateDocumentOptions,
): Promise<ValidationViolation[]> {
  const flatFields = flattenFields(config.fields);
  const flatDoc = flattenDocShallow(config, doc);
  const violations: ValidationViolation[] = [];

  for (const [path, field] of Object.entries(flatFields)) {
    if (options.onlyFields && !options.onlyFields.has(path)) continue;
    const checks = resolveChecks(field);
    if (checks.length === 0 && !field.schema) continue;

    const value = flatDoc[path];
    const ctx: ValidationFieldContext = {
      document: doc,
      path,
      operation: options.operation,
      ...(options.id !== undefined ? { id: options.id } : {}),
    };

    for (const check of checks) {
      const violation = await evaluateCheck(check, value, field, ctx, options);
      if (violation) violations.push(violation);
    }

    // A consumer-supplied Standard Schema runs after the `Rule` chain, on the
    // same flattened value. Skipped when empty so an optional field stays valid
    // (`required` guards presence). Pure (no db), so it runs client-side too.
    if (field.schema && !isEmpty(value)) {
      const parsed = await standardValidate(field.schema, value, path);
      if (!parsed.ok) violations.push(...parsed.violations);
    }
  }

  return violations;
}

// Reuse the Local API's own flattening so a group subfield's value is read
// from the same `<key>_<subKey>` shape it's stored under. Skip the round
// trip when the collection has no group fields (the common case).
function flattenDocShallow(
  config: CollectionConfig,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const hasGroup = Object.values(config.fields).some((f) => f.type === "group");
  return hasGroup ? flattenDoc(config.fields, doc) : doc;
}

async function evaluateCheck(
  check: Check,
  value: unknown,
  field: FieldConfig,
  ctx: ValidationFieldContext,
  options: ValidateDocumentOptions,
): Promise<ValidationViolation | null> {
  const fail = (defaultMessage: string): ValidationViolation => ({
    path: ctx.path,
    message: check.message ?? `${ctx.path} must ${defaultMessage}`,
    severity: check.severity ?? "error",
  });

  switch (check.kind) {
    case "required":
      return isEmpty(value) ? fail("not be empty") : null;

    case "min": {
      if (isEmpty(value)) return null;
      const s = sizeOf(value);
      if (s && s.size < check.n) {
        return fail(
          s.unit
            ? `have at least ${check.n} ${s.unit}${check.n === 1 ? "" : "s"}`
            : `be at least ${check.n}`,
        );
      }
      return null;
    }

    case "max": {
      if (isEmpty(value)) return null;
      const s = sizeOf(value);
      if (s && s.size > check.n) {
        return fail(
          s.unit
            ? `have at most ${check.n} ${s.unit}${check.n === 1 ? "" : "s"}`
            : `be at most ${check.n}`,
        );
      }
      return null;
    }

    case "length": {
      if (isEmpty(value)) return null;
      const s = sizeOf(value);
      if (s?.unit && s.size !== check.n) {
        return fail(`be exactly ${check.n} ${s.unit}${check.n === 1 ? "" : "s"}`);
      }
      return null;
    }

    case "regex": {
      if (isEmpty(value)) return null;
      if (typeof value !== "string" || !check.re.test(value)) {
        return fail(check.label);
      }
      return null;
    }

    case "integer":
      if (isEmpty(value)) return null;
      return typeof value === "number" && Number.isInteger(value) ? null : fail("be an integer");

    case "positive":
      if (isEmpty(value)) return null;
      return typeof value === "number" && value > 0 ? null : fail("be a positive number");

    case "unique":
      return evaluateUnique(value, ctx, options, check);

    case "reference":
      return evaluateReference(value, field, ctx, options, check);

    case "custom": {
      const result = await check.fn(value, ctx);
      if (result === true || result === undefined) return null;
      if (result === false) return fail("be valid");
      if (typeof result === "string") {
        return {
          path: ctx.path,
          message: result,
          severity: check.severity ?? "error",
        };
      }
      return {
        path: ctx.path,
        message: result.message,
        severity: result.severity ?? check.severity ?? "error",
      };
    }
  }
}

async function evaluateUnique(
  value: unknown,
  ctx: ValidationFieldContext,
  options: ValidateDocumentOptions,
  check: Check,
): Promise<ValidationViolation | null> {
  if (isEmpty(value) || !options.db || !options.table) return null;
  const column = (options.table as Record<string, unknown>)[ctx.path];
  if (!column) return null;
  // On update, exclude the row itself so re-saving an unchanged value passes.
  const where =
    ctx.id !== undefined
      ? and(eq(column as never, value as never), ne(options.table.id, ctx.id))
      : eq(column as never, value as never);
  const existing = await options.db
    .select({ id: options.table.id })
    .from(options.table as never)
    .where(where)
    .limit(1);
  if (existing.length > 0) {
    return {
      path: ctx.path,
      message: check.message ?? `${ctx.path} "${String(value)}" is already taken`,
      severity: check.severity ?? "error",
    };
  }
  return null;
}

async function evaluateReference(
  value: unknown,
  field: FieldConfig,
  ctx: ValidationFieldContext,
  options: ValidateDocumentOptions,
  check: Check,
): Promise<ValidationViolation | null> {
  if (isEmpty(value) || !options.db || !options.registry) return null;
  if (field.type !== "relationship") return null;
  const target = options.registry.tables[field.relationTo];
  if (!target) return null;
  const found = await options.db
    .select({ id: target.id })
    .from(target as never)
    .where(eq(target.id, value as never))
    .limit(1);
  if (found.length === 0) {
    return {
      path: ctx.path,
      message:
        check.message ?? `${ctx.path} references a "${field.relationTo}" that does not exist`,
      severity: check.severity ?? "error",
    };
  }
  return null;
}

/**
 * Evaluate a single value against a field's `validation` chain, returning its
 * violations. Reuses the same {@link Rule} builder and check semantics as
 * {@link validateDocument}, but for one value in isolation — so schemas that
 * aren't a `CollectionConfig` (e.g. the structured-sections catalog) can run
 * the exact same rules. DB-backed checks (`unique`/`reference`) are inapplicable
 * here and no-op (no `db`/`table` in scope).
 */
export async function validateValue(
  builder: ValidationBuilder | undefined,
  value: unknown,
  ctx: ValidationFieldContext,
): Promise<ValidationViolation[]> {
  if (!builder) return [];
  const built = builder(new Rule());
  const checks = (Array.isArray(built) ? built : [built]).flatMap((r) => r.toChecks());
  // A synthetic non-relationship field: `reference` short-circuits on it, and
  // `unique` no-ops without a `table`, so only the pure/custom checks run.
  const field = { type: "text" } as unknown as FieldConfig;
  const out: ValidationViolation[] = [];
  for (const check of checks) {
    const violation = await evaluateCheck(check, value, field, ctx, { operation: ctx.operation });
    if (violation) out.push(violation);
  }
  return out;
}

/**
 * Run {@link validateDocument} and throw {@link LouiseValidationError} if any
 * `"error"`-severity violations are found. Warnings are returned (never
 * thrown) so a caller can still surface them. The thrown error's message is
 * a readable, joined summary of every blocking violation.
 */
export async function assertValid(
  config: CollectionConfig,
  doc: Record<string, unknown>,
  options: ValidateDocumentOptions,
): Promise<ValidationViolation[]> {
  const violations = await validateDocument(config, doc, options);
  const errors = violations.filter((v) => v.severity === "error");
  if (errors.length > 0) {
    const summary = errors.map((v) => v.message).join("; ");
    throw new LouiseValidationError(
      `Validation failed for collection "${config.slug}": ${summary}`,
      violations,
    );
  }
  return violations;
}
