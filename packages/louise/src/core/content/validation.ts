// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The drizzle-dependent half of the content validator: the document-level
// {@link validateDocument} / {@link assertValid} entry points and the two
// DB-backed checks (`unique`, `reference`) whose queries need `drizzle-orm`.
//
// The pure Rule engine — the `Rule` builder, `validateValue`, and the
// synchronous check evaluation — lives in `./rule.ts` (imported here and its
// public API re-exported below, so `louise-toolkit/content` still surfaces the
// whole API). That split is deliberate: `drizzle-orm` is an *optional* peer, and
// ESM is eager, so a module that only needs the pure engine (`content/sections.ts`,
// `forms/validate.ts`) must import it from `./rule.ts` — never from here — to
// avoid dragging drizzle in. See rule.ts's header and `content/define.ts`.

import { and, eq, ne } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { LouiseValidationError, type ValidationViolation } from "../errors.js";
import { standardValidate } from "../schema/index.js";
import type { ContentRegistry } from "./localApi.js";
import {
  type Check,
  type DbBackedChecks,
  evaluateCheck,
  isEmpty,
  resolveChecks,
  type ValidationFieldContext,
} from "./rule.js";
import type { CollectionConfig, FieldConfig } from "./types.js";
import { flattenDoc, flattenFields } from "./types.js";

// The pure Rule engine is part of this module's public surface (the content
// barrel re-exports `./validation.js`). Re-export exactly the names that were
// public before the drizzle-free `./rule.ts` split, so consumers importing from
// `louise-toolkit/content` see no change.
export {
  type CustomValidator,
  type CustomValidatorResult,
  defineField,
  Rule,
  rule,
  type ValidationBuilder,
  type ValidationFieldContext,
  type ValidationSeverity,
  validateValue,
} from "./rule.js";

// Mirrors localApi.ts's own local alias — drizzle's default table generic.
// oxlint-disable-next-line typescript/no-explicit-any -- matches drizzle-orm's own SQLiteTableWithColumns default generic usage
type AnyTable = SQLiteTableWithColumns<any>;

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

  // Build the DB-backed check handlers once, only when a `db` is supplied; they
  // close over `options` and keep the drizzle queries here, so the shared
  // {@link evaluateCheck} in rule.ts stays free of `drizzle-orm`. No `db` → no
  // handlers → `unique`/`reference` no-op (the pure client-side pass).
  const db: DbBackedChecks | undefined = options.db
    ? {
        unique: (value, ctx, check) => evaluateUnique(value, ctx, options, check),
        reference: (value, field, ctx, check) =>
          evaluateReference(value, field, ctx, options, check),
      }
    : undefined;

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
      const violation = await evaluateCheck(check, value, field, ctx, db);
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
