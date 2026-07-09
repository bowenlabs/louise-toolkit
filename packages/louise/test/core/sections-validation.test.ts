import { describe, expect, it } from "vitest";
import type { SectionCatalog } from "../../src/core/cms/sections.js";
import { assertValidSections, validateSections } from "../../src/core/cms/sections.js";
import { LouiseValidationError } from "../../src/core/errors.js";

const catalog: SectionCatalog = {
  hero: {
    label: "Hero",
    fields: {
      heading: { type: "text", validation: (r) => r.required().max(80) },
      tagline: { type: "textarea" },
      ctaHref: { type: "text", inline: false },
      logo: { type: "image" },
    },
  },
  featureGrid: {
    label: "Feature grid",
    fields: {
      heading: { type: "text" },
      items: {
        type: "array",
        itemLabel: "Feature",
        itemFields: {
          title: { type: "text", validation: (r) => r.required() },
          body: { type: "textarea" },
        },
      },
    },
  },
};

const errors = async (value: unknown) =>
  (await validateSections(catalog, value)).filter((v) => v.severity === "error");

describe("validateSections — structure", () => {
  it("accepts a well-formed sections array", async () => {
    const v = await validateSections(catalog, [
      { _type: "hero", heading: "Hi", tagline: "", ctaHref: "/x" },
      { _type: "featureGrid", heading: "", items: [{ title: "A", body: "b" }] },
    ]);
    expect(v).toEqual([]);
  });

  it("no-ops on absent value (partial update)", async () => {
    expect(await validateSections(catalog, undefined)).toEqual([]);
    expect(await validateSections(catalog, null)).toEqual([]);
  });

  it("rejects a non-array", async () => {
    const e = await errors({ _type: "hero" });
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections");
  });

  it("rejects a non-object item", async () => {
    expect((await errors([42]))[0].path).toBe("sections[0]");
  });

  it("rejects an unknown _type", async () => {
    const e = await errors([{ _type: "banner", heading: "x" }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0]._type");
    expect(e[0].message).toContain("unknown section type");
  });

  it("rejects a missing or non-string _type", async () => {
    expect((await errors([{ heading: "x" }]))[0].path).toBe("sections[0]._type");
    expect((await errors([{ _type: 5 }]))[0].path).toBe("sections[0]._type");
  });
});

describe("validateSections — field types", () => {
  it("rejects a non-string text field", async () => {
    const e = await errors([{ _type: "hero", heading: { nope: true } }]);
    expect(e.some((x) => x.path === "sections[0].heading" && x.message.includes("string"))).toBe(
      true,
    );
  });

  it("rejects a non-array array field", async () => {
    const e = await errors([{ _type: "featureGrid", items: "nope" }]);
    expect(e.some((x) => x.path === "sections[0].items" && x.message.includes("array"))).toBe(true);
  });

  it("rejects a non-object array item", async () => {
    expect((await errors([{ _type: "featureGrid", items: ["x"] }]))[0].path).toBe(
      "sections[0].items[0]",
    );
  });

  it("validates array item subfields by type", async () => {
    const e = await errors([{ _type: "featureGrid", items: [{ title: 3, body: "b" }] }]);
    expect(e.some((x) => x.path === "sections[0].items[0].title")).toBe(true);
  });

  it("rejects a non-string image field but accepts a URL string", async () => {
    const bad = await errors([{ _type: "hero", heading: "ok", logo: 123 }]);
    expect(bad.some((x) => x.path === "sections[0].logo" && x.message.includes("string"))).toBe(
      true,
    );
    expect(await errors([{ _type: "hero", heading: "ok", logo: "/media/x.png" }])).toEqual([]);
  });
});

describe("validateSections — per-field rules (reuse the cms Rule builder)", () => {
  it("enforces required", async () => {
    expect((await errors([{ _type: "hero", heading: "" }]))[0].path).toBe("sections[0].heading");
  });

  it("enforces max length", async () => {
    const e = await errors([{ _type: "hero", heading: "x".repeat(200) }]);
    expect(e.some((x) => x.path === "sections[0].heading" && x.message.includes("at most"))).toBe(
      true,
    );
  });

  it("enforces rules on array item subfields", async () => {
    const e = await errors([{ _type: "featureGrid", items: [{ title: "", body: "b" }] }]);
    expect(e.some((x) => x.path === "sections[0].items[0].title")).toBe(true);
  });
});

describe("assertValidSections", () => {
  it("throws LouiseValidationError (with violations) on an error", async () => {
    await expect(assertValidSections(catalog, [{ _type: "nope" }])).rejects.toBeInstanceOf(
      LouiseValidationError,
    );
    try {
      await assertValidSections(catalog, [{ _type: "nope" }]);
    } catch (err) {
      expect((err as LouiseValidationError).violations.length).toBeGreaterThan(0);
    }
  });

  it("resolves with no violations for valid sections", async () => {
    await expect(assertValidSections(catalog, [{ _type: "hero", heading: "ok" }])).resolves.toEqual(
      [],
    );
  });
});
