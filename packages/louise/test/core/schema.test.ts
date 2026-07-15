import { describe, expect, it } from "vitest";
import { LouiseValidationError } from "../../src/core/errors.js";
import type { StandardSchemaV1 } from "../../src/core/schema/index.js";
import {
  issuesToViolations,
  parseOrThrow,
  s,
  standardValidate,
} from "../../src/core/schema/index.js";

// A minimal async Standard Schema, to prove the runner awaits and that the
// sync `s.*` builders reject async children rather than mis-validating them.
const asyncString: StandardSchemaV1<unknown, string> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: async (value) =>
      typeof value === "string" ? { value } : { issues: [{ message: "not a string" }] },
  },
};

describe("s.* builders", () => {
  it("validates primitives and passes the typed value through", async () => {
    expect(await standardValidate(s.string(), "hi")).toEqual({ ok: true, value: "hi" });
    expect(await standardValidate(s.number(), 3)).toEqual({ ok: true, value: 3 });
    expect(await standardValidate(s.boolean(), true)).toEqual({ ok: true, value: true });
    expect(await standardValidate(s.unknown(), { any: "thing" })).toEqual({
      ok: true,
      value: { any: "thing" },
    });
  });

  it("rejects wrong primitive types with a violation", async () => {
    const r = await standardValidate(s.string(), 42);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.violations).toEqual([{ path: "", message: "Expected a string", severity: "error" }]);
  });

  it("enforces string length + pattern and number bounds", async () => {
    expect((await standardValidate(s.string({ min: 2 }), "a")).ok).toBe(false);
    expect((await standardValidate(s.string({ max: 2 }), "abc")).ok).toBe(false);
    expect((await standardValidate(s.string({ pattern: /^x/ }), "yz")).ok).toBe(false);
    expect((await standardValidate(s.number({ int: true }), 1.5)).ok).toBe(false);
    expect((await standardValidate(s.number({ min: 1 }), 0)).ok).toBe(false);
    expect((await standardValidate(s.number({ max: 1 }), 2)).ok).toBe(false);
    expect(Number.isNaN(NaN) && (await standardValidate(s.number(), NaN)).ok).toBe(false);
  });

  it("enumOf accepts allowed values and rejects others", async () => {
    const status = s.enumOf("draft", "published");
    expect(await standardValidate(status, "draft")).toEqual({ ok: true, value: "draft" });
    expect((await standardValidate(status, "archived")).ok).toBe(false);
  });

  it("object() keeps declared keys, drops unknown ones, re-paths issues", async () => {
    const body = s.object({ collection: s.string(), field: s.string(), value: s.unknown() });
    const ok = await standardValidate(body, {
      collection: "posts",
      field: "title",
      value: "<b>hi</b>",
      injected: "should be dropped",
    });
    expect(ok).toEqual({
      ok: true,
      value: { collection: "posts", field: "title", value: "<b>hi</b>" },
    });

    const bad = await standardValidate(body, { collection: 1, field: "title" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.violations).toContainEqual({
        path: "collection",
        message: "Expected a string",
        severity: "error",
      });
    }
  });

  it("object() rejects non-objects", async () => {
    const body = s.object({ a: s.string() });
    expect((await standardValidate(body, null)).ok).toBe(false);
    expect((await standardValidate(body, [1, 2])).ok).toBe(false);
    expect((await standardValidate(body, "x")).ok).toBe(false);
  });

  it("optional() allows undefined but still validates a present value", async () => {
    const body = s.object({ versionId: s.optional(s.number({ int: true })) });
    expect(await standardValidate(body, {})).toEqual({ ok: true, value: { versionId: undefined } });
    expect(await standardValidate(body, { versionId: 7 })).toEqual({
      ok: true,
      value: { versionId: 7 },
    });
    expect((await standardValidate(body, { versionId: "7" })).ok).toBe(false);
  });

  it("record() validates each value and re-paths issues by key", async () => {
    const patch = s.record(s.string());
    expect(await standardValidate(patch, { a: "1", b: "2" })).toEqual({
      ok: true,
      value: { a: "1", b: "2" },
    });
    const bad = await standardValidate(patch, { a: "1", b: 2 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.violations[0]?.path).toBe("b");
  });
});

describe("standardValidate runner", () => {
  it("awaits an async Standard Schema", async () => {
    expect(await standardValidate(asyncString, "ok")).toEqual({ ok: true, value: "ok" });
    expect((await standardValidate(asyncString, 1)).ok).toBe(false);
  });

  it("reports an async child inside a sync builder as an issue (not silently valid)", async () => {
    const body = s.object({ name: asyncString });
    const r = await standardValidate(body, { name: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.message).toMatch(/[Aa]synchronous/);
  });

  it("prefixes a basePath onto issue paths", () => {
    const violations = issuesToViolations([{ message: "bad", path: [0] }], "items");
    expect(violations).toEqual([{ path: "items.0", message: "bad", severity: "error" }]);
  });
});

describe("parseOrThrow", () => {
  it("returns the value on success", async () => {
    await expect(parseOrThrow(s.string(), "hi")).resolves.toBe("hi");
  });

  it("throws LouiseValidationError carrying the violations on failure", async () => {
    await expect(parseOrThrow(s.number(), "nope")).rejects.toBeInstanceOf(LouiseValidationError);
    try {
      await parseOrThrow(s.object({ a: s.number() }), { a: "x" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LouiseValidationError);
      expect((err as LouiseValidationError).violations[0]?.path).toBe("a");
    }
  });
});
