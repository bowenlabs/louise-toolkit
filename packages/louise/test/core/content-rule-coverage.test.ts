// core/content/rule—the chainable Rule builder and the pure check evaluator
// (#695).
import { describe, expect, it, vi } from "vitest";
import {
  type Check,
  type DbBackedChecks,
  defineField,
  evaluateCheck,
  isEmpty,
  resolveChecks,
  Rule,
  rule,
  type ValidationFieldContext,
  validateValue,
} from "../../src/core/content/rule.js";
import type { FieldConfig } from "../../src/core/content/types.js";

const ctx: ValidationFieldContext = { document: {}, path: "title", operation: "create" };
const field = { type: "text" } as FieldConfig;

/** Run one chain's checks against a value and return the messages. */
async function messages(build: (r: Rule) => Rule | Rule[], value: unknown) {
  return (await validateValue(build, value, ctx)).map((v) => v.message);
}

describe("Rule builder", () => {
  it("is immutable: each call returns a new rule and leaves the base alone", () => {
    const base = rule().required();
    const longer = base.min(2);
    expect(base.toChecks()).toEqual([{ kind: "required" }]);
    expect(longer.toChecks()).toEqual([{ kind: "required" }, { kind: "min", n: 2 }]);
    expect(longer).not.toBe(base);
  });

  it("applies error and warning to the most recent check only", () => {
    const r = rule().required().error("Enter a title").max(5).warning("Keep it short");
    expect(r.toChecks()).toEqual([
      { kind: "required", message: "Enter a title", severity: "error" },
      { kind: "max", n: 5, message: "Keep it short", severity: "warning" },
    ]);
  });

  it("demotes to a warning without replacing the message when none is given", () => {
    expect(rule().integer().warning().toChecks()).toEqual([
      { kind: "integer", severity: "warning" },
    ]);
  });

  it("returns the same rule when error or warning has no check to modify", () => {
    const empty = rule();
    expect(empty.error("x")).toBe(empty);
    expect(empty.warning()).toBe(empty);
  });

  it("records every check kind", () => {
    const fn = () => true;
    const kinds = new Rule()
      .length(3)
      .regex(/x/)
      .email()
      .slug()
      .integer()
      .positive()
      .unique()
      .reference()
      .custom(fn)
      .toChecks()
      .map((c) => c.kind);
    expect(kinds).toEqual([
      "length",
      "regex",
      "regex",
      "regex",
      "integer",
      "positive",
      "unique",
      "reference",
      "custom",
    ]);
  });
});

describe("defineField and resolveChecks", () => {
  it("returns the field unchanged", () => {
    const f = { type: "text" } as FieldConfig;
    expect(defineField(f)).toBe(f);
  });

  it("returns no checks for a field without validation", () => {
    expect(resolveChecks({ type: "text" } as FieldConfig)).toEqual([]);
  });

  it("flattens a single chain or several chains", () => {
    const single = { type: "text", validation: (r: Rule) => r.required() } as FieldConfig;
    expect(resolveChecks(single)).toEqual([{ kind: "required" }]);
    const many = {
      type: "text",
      validation: (r: Rule) => [r.required(), r.max(3)],
    } as FieldConfig;
    expect(resolveChecks(many)).toEqual([{ kind: "required" }, { kind: "max", n: 3 }]);
  });
});

describe("isEmpty", () => {
  it("treats undefined, null, and the empty string as empty, and nothing else", () => {
    expect([undefined, null, ""].every(isEmpty)).toBe(true);
    expect([0, false, " ", [], {}].some(isEmpty)).toBe(false);
  });
});

describe("validateValue checks", () => {
  it("returns nothing without a builder", async () => {
    expect(await validateValue(undefined, "x", ctx)).toEqual([]);
  });

  it("required", async () => {
    expect(await messages((r) => r.required(), "")).toEqual(["title must not be empty"]);
    expect(await messages((r) => r.required(), "Alex")).toEqual([]);
  });

  it("min over strings, arrays, and numbers, with singular units", async () => {
    expect(await messages((r) => r.min(3), "ab")).toEqual([
      "title must have at least 3 characters",
    ]);
    expect(await messages((r) => r.min(1), [])).toEqual(["title must have at least 1 item"]);
    expect(await messages((r) => r.min(10), 4)).toEqual(["title must be at least 10"]);
    expect(await messages((r) => r.min(3), "abc")).toEqual([]);
    expect(await messages((r) => r.min(3), null)).toEqual([]);
    // A value with no size, such as an object, passes.
    expect(await messages((r) => r.min(3), { a: 1 })).toEqual([]);
  });

  it("max over strings, arrays, and numbers", async () => {
    expect(await messages((r) => r.max(2), "abc")).toEqual([
      "title must have at most 2 characters",
    ]);
    expect(await messages((r) => r.max(1), [1, 2])).toEqual(["title must have at most 1 item"]);
    expect(await messages((r) => r.max(5), 9)).toEqual(["title must be at most 5"]);
    expect(await messages((r) => r.max(5), 5)).toEqual([]);
    expect(await messages((r) => r.max(5), undefined)).toEqual([]);
  });

  it("length over strings and arrays, ignoring numbers", async () => {
    expect(await messages((r) => r.length(2), "abc")).toEqual([
      "title must be exactly 2 characters",
    ]);
    expect(await messages((r) => r.length(1), [1, 2])).toEqual(["title must be exactly 1 item"]);
    expect(await messages((r) => r.length(2), "ab")).toEqual([]);
    expect(await messages((r) => r.length(2), 12345)).toEqual([]);
    expect(await messages((r) => r.length(2), "")).toEqual([]);
  });

  it("regex, email, and slug", async () => {
    expect(await messages((r) => r.regex(/^\d+$/), "12a")).toEqual([
      "title must match the required format",
    ]);
    expect(await messages((r) => r.regex(/^\d+$/, "be digits"), 12)).toEqual([
      "title must be digits",
    ]);
    expect(await messages((r) => r.email(), "alex@example.com")).toEqual([]);
    expect(await messages((r) => r.email(), "alex@example")).toEqual([
      "title must be a valid email",
    ]);
    expect(await messages((r) => r.slug(), "my-page-2")).toEqual([]);
    expect(await messages((r) => r.slug(), "My--Page")).toEqual([
      "title must be a lowercase, hyphen-separated slug",
    ]);
    expect(await messages((r) => r.slug(), "")).toEqual([]);
  });

  it("integer and positive", async () => {
    expect(await messages((r) => r.integer(), 1.5)).toEqual(["title must be an integer"]);
    expect(await messages((r) => r.integer(), "3")).toEqual(["title must be an integer"]);
    expect(await messages((r) => r.integer(), 3)).toEqual([]);
    expect(await messages((r) => r.integer(), null)).toEqual([]);
    expect(await messages((r) => r.positive(), 0)).toEqual(["title must be a positive number"]);
    expect(await messages((r) => r.positive(), 0.1)).toEqual([]);
    expect(await messages((r) => r.positive(), "")).toEqual([]);
  });

  it("skips unique and reference without database handlers", async () => {
    expect(await messages((r) => r.unique().reference(), "x")).toEqual([]);
  });

  it("collects violations across several chains in order", async () => {
    expect(await messages((r) => [r.min(5), r.regex(/^\d+$/)], "ab")).toEqual([
      "title must have at least 5 characters",
      "title must match the required format",
    ]);
  });
});

describe("custom checks", () => {
  it("passes on true or undefined", async () => {
    expect(await messages((r) => r.custom(() => true), "x")).toEqual([]);
    expect(await messages((r) => r.custom(() => undefined), "x")).toEqual([]);
  });

  it("fails with a generic message on false", async () => {
    expect(await messages((r) => r.custom(() => false), "x")).toEqual(["title must be valid"]);
  });

  it("uses a returned string as the message at the check's severity", async () => {
    const out = await validateValue(
      (r) => r.custom(async () => "Pick another").warning(),
      "x",
      ctx,
    );
    expect(out).toEqual([{ path: "title", message: "Pick another", severity: "warning" }]);
  });

  it("prefers a returned object's severity, then the check's, then error", async () => {
    const withOwn = await validateValue(
      (r) => r.custom(() => ({ message: "Heads up", severity: "warning" })).error("ignored"),
      "x",
      ctx,
    );
    expect(withOwn).toEqual([{ path: "title", message: "Heads up", severity: "warning" }]);
    const fromCheck = await validateValue(
      (r) => r.custom(() => ({ message: "Soft" })).warning(),
      "x",
      ctx,
    );
    expect(fromCheck[0].severity).toBe("warning");
    const fallback = await validateValue((r) => r.custom(() => ({ message: "Hard" })), "x", ctx);
    expect(fallback[0].severity).toBe("error");
  });

  it("receives the value and the field context", async () => {
    const fn = vi.fn(() => true);
    const withId = { ...ctx, operation: "update" as const, id: 4 };
    await validateValue((r) => r.custom(fn), "Kai", withId);
    expect(fn).toHaveBeenCalledWith("Kai", withId);
  });
});

describe("evaluateCheck with database handlers", () => {
  it("delegates unique and reference to the injected handlers", async () => {
    const violation = { path: "title", message: "Taken", severity: "error" as const };
    const db: DbBackedChecks = {
      unique: vi.fn(async () => violation),
      reference: vi.fn(async () => null),
    };
    const unique: Check = { kind: "unique" };
    const reference: Check = { kind: "reference" };
    expect(await evaluateCheck(unique, "a", field, ctx, db)).toBe(violation);
    expect(db.unique).toHaveBeenCalledWith("a", ctx, unique);
    expect(await evaluateCheck(reference, 7, field, ctx, db)).toBeNull();
    expect(db.reference).toHaveBeenCalledWith(7, field, ctx, reference);
  });

  it("applies a check's own message and severity to a pure failure", async () => {
    const check: Check = { kind: "required", message: "Add a name", severity: "warning" };
    expect(await evaluateCheck(check, null, field, ctx)).toEqual({
      path: "title",
      message: "Add a name",
      severity: "warning",
    });
  });
});
