import { describe, expect, it } from "vitest";
import type { SectionCatalog } from "../../src/core/content/sections.js";
import { assertValidSections, validateSections } from "../../src/core/content/sections.js";
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
  // A discriminated array: each `blocks` item is one of several variants, keyed
  // by `kind`. `itemFields` (caption) is shared; each variant layers its own.
  gallery: {
    label: "Gallery",
    fields: {
      blocks: {
        type: "array",
        itemLabel: "Block",
        itemFields: { caption: { type: "text" } },
        discriminator: {
          key: "kind",
          variants: {
            image: { url: { type: "image", validation: (r) => r.required() } },
            quote: {
              text: { type: "textarea", validation: (r) => r.required() },
              author: { type: "text" },
            },
          },
          variantsAdmin: {
            image: { label: "Image", icon: "ph ph-image" },
            quote: { label: "Quote", icon: "ph ph-quotes" },
          },
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

describe("validateSections — image media-origin (mediaBase)", () => {
  const mediaErrors = async (value: unknown) =>
    (await validateSections(catalog, value, { operation: "update", mediaBase: "/media" })).filter(
      (v) => v.severity === "error",
    );

  it("accepts an image served from the media base", async () => {
    expect(await mediaErrors([{ _type: "hero", heading: "ok", logo: "/media/web/x.png" }])).toEqual(
      [],
    );
  });

  it("accepts an empty image (unset — the site shows its placeholder)", async () => {
    expect(await mediaErrors([{ _type: "hero", heading: "ok", logo: "" }])).toEqual([]);
  });

  it("rejects an external hotlink", async () => {
    const e = await mediaErrors([
      { _type: "hero", heading: "ok", logo: "https://evil.example/x.png" },
    ]);
    expect(e.some((x) => x.path === "sections[0].logo" && x.message.includes("media asset"))).toBe(
      true,
    );
  });

  it("rejects a URL that merely contains the base but isn't served from it", async () => {
    const e = await mediaErrors([
      { _type: "hero", heading: "ok", logo: "https://evil.example/media/x.png" },
    ]);
    expect(e.some((x) => x.path === "sections[0].logo")).toBe(true);
  });

  it("does not check origin when mediaBase is omitted (back-compat)", async () => {
    expect(
      await errors([{ _type: "hero", heading: "ok", logo: "https://any.example/x.png" }]),
    ).toEqual([]);
  });
});

describe("validateSections — per-field rules (reuse the content Rule builder)", () => {
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

describe("validateSections — discriminated array (blocks)", () => {
  it("accepts items of any declared variant, validating base + variant fields", async () => {
    const v = await validateSections(catalog, [
      {
        _type: "gallery",
        blocks: [
          { kind: "image", caption: "A", url: "/media/x.jpg" },
          { kind: "quote", text: "Hello", author: "Ada" },
        ],
      },
    ]);
    expect(v).toEqual([]);
  });

  it("rejects an item whose variant key is unknown", async () => {
    const e = await errors([{ _type: "gallery", blocks: [{ kind: "video", src: "x" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0].kind");
    expect(e[0].message).toContain("unknown variant");
  });

  it("rejects an item with no variant key", async () => {
    const e = await errors([{ _type: "gallery", blocks: [{ caption: "orphan" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0].kind");
  });

  it("enforces the selected variant's own field rules", async () => {
    // The image variant requires `url`; omit it → a required violation on that field.
    const e = await errors([{ _type: "gallery", blocks: [{ kind: "image", caption: "x" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0].url");
  });

  it("does not apply another variant's fields", async () => {
    // `text` is the quote variant's required field; on an image item it's out of
    // scope, so its absence is not a violation.
    const e = await errors([
      { _type: "gallery", blocks: [{ kind: "image", url: "/media/x.jpg" }] },
    ]);
    expect(e).toEqual([]);
  });

  it("validates the shared itemFields regardless of variant", async () => {
    // caption is shared across variants; a non-string caption is rejected on any.
    const e = await errors([
      { _type: "gallery", blocks: [{ kind: "image", url: "/media/x.jpg", caption: 42 }] },
    ]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0].caption");
  });
});
