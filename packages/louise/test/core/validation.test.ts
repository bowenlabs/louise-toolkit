import { describe, expect, it } from "vitest";
import { LouiseValidationError } from "../../src/core/errors.js";
import type { CollectionConfig } from "../../src/core/content/types.js";
import { assertValid, rule, validateDocument } from "../../src/core/content/validation.js";
import { s } from "../../src/core/schema/index.js";

const posts: CollectionConfig = {
  slug: "posts",
  fields: {
    title: { type: "text", validation: (r) => r.required().min(3) },
    slug: { type: "text", validation: (r) => r.slug() },
    priority: { type: "number", validation: (r) => r.integer().positive() },
    email: { type: "text", validation: (r) => r.email() },
  },
};

describe("Rule builder", () => {
  it("is immutable — each method returns a fresh Rule", () => {
    const base = rule().required();
    const extended = base.min(5);
    expect(base.toChecks()).toHaveLength(1);
    expect(extended.toChecks()).toHaveLength(2);
  });
});

describe("validateDocument", () => {
  it("returns no violations for a valid document", async () => {
    const violations = await validateDocument(
      posts,
      { title: "Hello", slug: "hello-world", priority: 3, email: "a@b.com" },
      { operation: "create" },
    );
    expect(violations).toEqual([]);
  });

  it("flags required/format/number failures with their field paths", async () => {
    const violations = await validateDocument(
      posts,
      { title: "", slug: "Not A Slug", priority: -2.5, email: "nope" },
      { operation: "create" },
    );
    const paths = new Set(violations.map((v) => v.path));
    expect(paths).toContain("title");
    expect(paths).toContain("slug");
    expect(paths).toContain("priority");
    expect(paths).toContain("email");
    expect(violations.every((v) => v.severity === "error")).toBe(true);
  });

  // #98: a collection field may carry a Standard Schema, run in the same pass
  // as the Rule chain (here via the built-in `s.*` builder).
  it("runs a field's Standard Schema and paths its issues to the field", async () => {
    const catalog: CollectionConfig = {
      slug: "products",
      fields: {
        sku: { type: "text", validation: (r) => r.required(), schema: s.string({ min: 6 }) },
      },
    };
    expect(await validateDocument(catalog, { sku: "ABC123" }, { operation: "create" })).toEqual([]);

    const violations = await validateDocument(catalog, { sku: "ABC" }, { operation: "create" });
    expect(violations.some((v) => v.path === "sku")).toBe(true);
  });

  it("skips a field's Standard Schema when the value is empty", async () => {
    const catalog: CollectionConfig = {
      slug: "products2",
      fields: { note: { type: "text", schema: s.string({ min: 6 }) } },
    };
    expect(await validateDocument(catalog, {}, { operation: "create" })).toEqual([]);
  });

  it("skips DB-backed rules (unique) when no db handle is given", async () => {
    const pages: CollectionConfig = {
      slug: "pages",
      fields: { slug: { type: "text", validation: (r) => r.slug().unique() } },
    };
    const violations = await validateDocument(pages, { slug: "ok-slug" }, { operation: "create" });
    expect(violations).toEqual([]);
  });

  it("carries warning-severity violations through without erroring", async () => {
    const soft: CollectionConfig = {
      slug: "bios",
      fields: {
        bio: { type: "text", validation: (r) => r.max(3).warning("Keep it short") },
      },
    };
    const violations = await validateDocument(
      soft,
      { bio: "way too long" },
      { operation: "create" },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.severity).toBe("warning");
  });

  it("validates only onlyFields on a partial update", async () => {
    const violations = await validateDocument(
      posts,
      { title: "" },
      {
        operation: "update",
        onlyFields: new Set(["title"]),
      },
    );
    expect(violations.map((v) => v.path)).toEqual(["title"]);
  });
});

describe("assertValid", () => {
  it("throws LouiseValidationError on error-severity violations", async () => {
    await expect(
      assertValid(
        posts,
        { title: "" },
        {
          operation: "create",
          onlyFields: new Set(["title"]),
        },
      ),
    ).rejects.toBeInstanceOf(LouiseValidationError);
  });

  it("returns warnings without throwing", async () => {
    const soft: CollectionConfig = {
      slug: "bios",
      fields: { bio: { type: "text", validation: (r) => r.max(3).warning() } },
    };
    const warnings = await assertValid(soft, { bio: "long" }, { operation: "create" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe("warning");
  });
});
