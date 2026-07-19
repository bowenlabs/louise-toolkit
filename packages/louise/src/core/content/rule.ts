// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/content` Rule engine — the drizzle-free half of the content
// validator. Everything here evaluates a field's chainable `validation` rules
// against a value with pure, synchronous logic (required/min/max/regex/custom
// …); none of it touches a database.
//
// Why this is its own file. The two DB-backed checks — `unique` and
// `reference` — need `drizzle-orm` to build their queries, and drizzle-orm is
// an *optional* peer of louise-toolkit. ESM is eager, so any module that
// imported the evaluator resolved drizzle-orm at import time even when it only
// wanted the pure checks. `content/sections.ts` (the structured-sections
// validator) and `forms/validate.ts` both reuse this engine via
// {@link validateValue} and must stay drizzle-free — the same class of bug
// `content/define.ts` was carved out to fix. So the pure machinery lives here;
// the drizzle-dependent uniqueness / reference queries stay in `validation.ts`,
// which injects them into {@link evaluateCheck} via its optional `db` handlers
// and re-exports the pure public API so the `louise-toolkit/content` barrel is
// unchanged.
//
// Design notes:
// - The builder is **immutable** — every method returns a new {@link Rule}
//   with one more check appended, so a shared base rule can't be mutated by
//   a consumer's chain (mirrors Sanity).
// - Most checks are synchronous and pure (min/max/regex/custom over the
//   value alone). Two — `unique` and `reference` — need the database and so
//   only run where {@link validateDocument} (in validation.ts) supplies its
//   `db` handlers to {@link evaluateCheck}; they no-op in a pure pass.

import type { ValidationViolation } from "../errors.js";
import type { FieldConfig } from "./types.js";

/**
 * Chainable field validation for Louise (issue #16) — adopts Sanity's
 * `defineField`/`Rule` validation API (pattern, not code). A field declares
 * `validation: (rule) => rule.required().min(2).custom(...)`; this module
 * turns that chain into a list of declarative checks and evaluates them at
 * write time (server-side, in createLocalApi) as well as anywhere the editor
 * wants synchronous feedback.
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
export type Check = (
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

/** Resolve a field's `validation` builder(s) to a flat list of checks. */
export function resolveChecks(field: FieldConfig): readonly Check[] {
  if (!field.validation) return [];
  const built = field.validation(new Rule());
  const rules = Array.isArray(built) ? built : [built];
  return rules.flatMap((r) => r.toChecks());
}

export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length === 0);
}

function sizeOf(value: unknown): { size: number; unit: string } | null {
  if (typeof value === "string") return { size: value.length, unit: "character" };
  if (Array.isArray(value)) return { size: value.length, unit: "item" };
  if (typeof value === "number") return { size: value, unit: "" };
  return null;
}

/**
 * The two DB-backed checks (`unique`, `reference`) build drizzle queries, so
 * they're implemented in `validation.ts` and injected into
 * {@link evaluateCheck} as this handler pair. Keeping them out of this module
 * is the whole point of the split (see the header): `rule.ts` must never import
 * `drizzle-orm`. When no handlers are supplied both checks no-op — exactly the
 * pure client-side / sections / forms pass.
 */
export interface DbBackedChecks {
  unique(
    value: unknown,
    ctx: ValidationFieldContext,
    check: Check,
  ): Promise<ValidationViolation | null>;
  reference(
    value: unknown,
    field: FieldConfig,
    ctx: ValidationFieldContext,
    check: Check,
  ): Promise<ValidationViolation | null>;
}

/**
 * Evaluate one {@link Check} against a value, returning a violation or `null`.
 * The pure checks (required/min/max/length/regex/integer/positive/custom) run
 * here; the DB-backed `unique`/`reference` checks are delegated to the injected
 * `db` handlers and no-op when they're absent (see {@link DbBackedChecks}).
 */
export async function evaluateCheck(
  check: Check,
  value: unknown,
  field: FieldConfig,
  ctx: ValidationFieldContext,
  db?: DbBackedChecks,
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
      return db ? db.unique(value, ctx, check) : null;

    case "reference":
      return db ? db.reference(value, field, ctx, check) : null;

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

/**
 * Evaluate a single value against a field's `validation` chain, returning its
 * violations. Reuses the same {@link Rule} builder and check semantics as
 * {@link validateDocument}, but for one value in isolation — so schemas that
 * aren't a `CollectionConfig` (e.g. the structured-sections catalog) can run
 * the exact same rules. DB-backed checks (`unique`/`reference`) are inapplicable
 * here and no-op (no `db` handlers passed to {@link evaluateCheck}), so this
 * entry point — and every module that reuses it (`content/sections.ts`,
 * `forms/validate.ts`) — stays free of `drizzle-orm`.
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
  // `unique` no-ops without `db` handlers, so only the pure/custom checks run.
  const field = { type: "text" } as unknown as FieldConfig;
  const out: ValidationViolation[] = [];
  for (const check of checks) {
    const violation = await evaluateCheck(check, value, field, ctx);
    if (violation) out.push(violation);
  }
  return out;
}
