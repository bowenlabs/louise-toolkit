import { describe, expect, it } from "vitest";
import type { BlockCatalog, SectionCatalog } from "../../src/core/content/sections.js";
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
  // A discriminated array *field* (named `items` — `blocks` is reserved for the
  // first-class block layer, ADR 0005): each item is one of several variants,
  // keyed by `kind`. `itemFields` (caption) is shared; each variant layers its own.
  gallery: {
    label: "Gallery",
    fields: {
      items: {
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
  // Opts into the first-class block layer (ADR 0005): `blocks` on a `page` item
  // is a validated, ordered list of catalog blocks (heading | image), bounded to
  // 1..3. Coexists with `gallery`, whose discriminated *field* is named `items`
  // (not `blocks`) — the field path and the block layer never collide.
  page: {
    label: "Page",
    fields: { title: { type: "text" } },
    blocks: { allow: ["heading", "image"], min: 1, max: 3 },
  },
  // Opts in with no `allow` → every catalog block type is permitted (and no
  // count bound).
  flexPage: {
    label: "Flex page",
    fields: {},
    blocks: {},
  },
  // Layout + inspector settings (ADR 0005 §5): `_layout` must be one of `layouts`;
  // `_settings` validates against `settings` (reusing SectionField rules).
  panel: {
    label: "Panel",
    fields: { heading: { type: "text" } },
    layouts: { wide: { label: "Wide" }, boxed: { label: "Boxed" } },
    settings: {
      background: { type: "text", inline: false },
      columns: { type: "text", inline: false, validation: (r) => r.required() },
    },
  },
};

// The site's block palette (schema only) resolved against by the `page` section.
const blockCatalog: BlockCatalog = {
  heading: {
    label: "Heading",
    fields: { text: { type: "text", validation: (r) => r.required().max(120) } },
    // Block-level inspector settings (ADR 0005 §5) — `align` is required.
    settings: { align: { type: "text", inline: false, validation: (r) => r.required() } },
  },
  image: {
    label: "Image",
    fields: {
      url: { type: "image", validation: (r) => r.required() },
      caption: { type: "text" },
    },
  },
  // A block whose own field is a discriminated array — proves block fields reuse
  // `SectionField` verbatim (nested `array` + `discriminator` still validated).
  carousel: {
    label: "Carousel",
    fields: {
      slides: {
        type: "array",
        itemFields: { caption: { type: "text" } },
        discriminator: {
          key: "kind",
          variants: { photo: { src: { type: "image", validation: (r) => r.required() } } },
        },
      },
    },
  },
};

const errors = async (value: unknown) =>
  (await validateSections(catalog, value)).filter((v) => v.severity === "error");

const blockErrors = async (value: unknown) =>
  (await validateSections(catalog, value, { operation: "update", blockCatalog })).filter(
    (v) => v.severity === "error",
  );

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

describe("validateSections — discriminated array (items)", () => {
  it("accepts items of any declared variant, validating base + variant fields", async () => {
    const v = await validateSections(catalog, [
      {
        _type: "gallery",
        items: [
          { kind: "image", caption: "A", url: "/media/x.jpg" },
          { kind: "quote", text: "Hello", author: "Ada" },
        ],
      },
    ]);
    expect(v).toEqual([]);
  });

  it("rejects an item whose variant key is unknown", async () => {
    const e = await errors([{ _type: "gallery", items: [{ kind: "video", src: "x" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].items[0].kind");
    expect(e[0].message).toContain("unknown variant");
  });

  it("rejects an item with no variant key", async () => {
    const e = await errors([{ _type: "gallery", items: [{ caption: "orphan" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].items[0].kind");
  });

  it("enforces the selected variant's own field rules", async () => {
    // The image variant requires `url`; omit it → a required violation on that field.
    const e = await errors([{ _type: "gallery", items: [{ kind: "image", caption: "x" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].items[0].url");
  });

  it("does not apply another variant's fields", async () => {
    // `text` is the quote variant's required field; on an image item it's out of
    // scope, so its absence is not a violation.
    const e = await errors([{ _type: "gallery", items: [{ kind: "image", url: "/media/x.jpg" }] }]);
    expect(e).toEqual([]);
  });

  it("validates the shared itemFields regardless of variant", async () => {
    // caption is shared across variants; a non-string caption is rejected on any.
    const e = await errors([
      { _type: "gallery", items: [{ kind: "image", url: "/media/x.jpg", caption: 42 }] },
    ]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].items[0].caption");
  });
});

describe("validateSections — first-class blocks layer (ADR 0005)", () => {
  it("accepts a section's blocks, validating each against the block catalog", async () => {
    const e = await blockErrors([
      {
        _type: "page",
        title: "Home",
        blocks: [
          { _type: "heading", text: "Welcome" },
          { _type: "image", url: "/media/hero.jpg", caption: "Hero" },
        ],
      },
    ]);
    expect(e).toEqual([]);
  });

  it("ignores the blocks array when the section declares no block policy", async () => {
    // `hero` opts out; a stray `blocks` key is undeclared free-form data, not
    // validated as a block layer (and `heading` here is a real hero field).
    const e = await blockErrors([
      { _type: "hero", heading: "Hi", blocks: [{ _type: "whatever", junk: true }] },
    ]);
    expect(e).toEqual([]);
  });

  it("rejects a block whose _type is not in the catalog", async () => {
    const e = await blockErrors([{ _type: "flexPage", blocks: [{ _type: "widget" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0]._type");
    expect(e[0].message).toContain("unknown block type");
  });

  it("rejects a block type not permitted by the section's allow list", async () => {
    // `carousel` is a real catalog block, but `page` only allows heading|image.
    const e = await blockErrors([{ _type: "page", blocks: [{ _type: "carousel" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0]._type");
    expect(e[0].message).toContain("not allowed in this section");
  });

  it("enforces the selected block's own field rules", async () => {
    // heading.text is required; omit it.
    const e = await blockErrors([{ _type: "page", blocks: [{ _type: "heading" }] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0].text");
  });

  it("enforces the min block count on a present array", async () => {
    const e = await blockErrors([{ _type: "page", blocks: [] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks");
    expect(e[0].message).toContain("at least 1 block");
  });

  it("enforces the max block count", async () => {
    const e = await blockErrors([
      {
        _type: "page",
        blocks: [
          { _type: "heading", text: "a" },
          { _type: "heading", text: "b" },
          { _type: "heading", text: "c" },
          { _type: "heading", text: "d" },
        ],
      },
    ]);
    expect(
      e.some((v) => v.path === "sections[0].blocks" && v.message.includes("at most 3 blocks")),
    ).toBe(true);
  });

  it("treats an absent blocks array as a no-op (partial update)", async () => {
    const e = await blockErrors([{ _type: "page", title: "Just a title" }]);
    expect(e).toEqual([]);
  });

  it("rejects a non-array blocks value", async () => {
    const e = await blockErrors([{ _type: "page", blocks: "nope" }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks");
    expect(e[0].message).toContain("must be an array");
  });

  it("rejects a non-object block", async () => {
    const e = await blockErrors([{ _type: "page", blocks: [42] }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0]");
    expect(e[0].message).toContain("must be an object");
  });

  it("validates a discriminated array field nested inside a block (reuse)", async () => {
    // carousel.slides is an array with a discriminator; the photo variant needs src.
    const ok = await blockErrors([
      {
        _type: "flexPage",
        blocks: [{ _type: "carousel", slides: [{ kind: "photo", src: "/media/1.jpg" }] }],
      },
    ]);
    expect(ok).toEqual([]);

    const e = await blockErrors([
      { _type: "flexPage", blocks: [{ _type: "carousel", slides: [{ kind: "photo" }] }] },
    ]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0].slides[0].src");
  });

  it("treats every block as unknown when no block catalog is supplied", async () => {
    // A section opts into blocks but the caller omits `blockCatalog` — surfaces
    // the misconfiguration rather than silently passing.
    const e = (
      await validateSections(catalog, [
        { _type: "page", blocks: [{ _type: "heading", text: "x" }] },
      ])
    ).filter((v) => v.severity === "error");
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0]._type");
    expect(e[0].message).toContain("unknown block type");
  });
});

describe("validateSections — layout token (#182 Phase 4 / ADR 0005 §5)", () => {
  it("accepts a declared layout and treats absent as a no-op", async () => {
    expect(await errors([{ _type: "panel", _layout: "wide" }])).toEqual([]);
    expect(await errors([{ _type: "panel", _layout: "boxed" }])).toEqual([]);
    expect(await errors([{ _type: "panel" }])).toEqual([]);
  });

  it("rejects an unknown layout", async () => {
    const e = await errors([{ _type: "panel", _layout: "nope" }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0]._layout");
    expect(e[0].message).toContain("unknown layout");
  });

  it("rejects a layout on a section that declares none", async () => {
    const e = await errors([{ _type: "hero", heading: "x", _layout: "wide" }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0]._layout");
  });
});

describe("validateSections — inspector settings (#182 Phase 4 / ADR 0005 §5)", () => {
  it("validates declared setting fields, reusing their rules", async () => {
    // `columns` is required; present + valid → ok.
    expect(
      await errors([{ _type: "panel", _settings: { background: "dark", columns: "3" } }]),
    ).toEqual([]);
    // `columns` missing → the required rule fires under the settings path.
    const e = await errors([{ _type: "panel", _settings: { background: "dark" } }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0]._settings.columns");
  });

  it("rejects a non-object _settings", async () => {
    const e = await errors([{ _type: "panel", _settings: "nope" }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0]._settings");
    expect(e[0].message).toContain("must be an object");
  });

  it("ignores undeclared setting keys and a section with no settings declared", async () => {
    // Unknown `foo` ignored (columns still present); hero declares no settings at
    // all, so any `_settings` is ignored free-form data.
    expect(await errors([{ _type: "panel", _settings: { foo: "x", columns: "3" } }])).toEqual([]);
    expect(await errors([{ _type: "hero", heading: "x", _settings: { anything: 1 } }])).toEqual([]);
  });

  it("treats an absent _settings as a no-op (required setting only fires when present)", async () => {
    expect(await errors([{ _type: "panel" }])).toEqual([]);
  });

  it("validates a block's _settings against its block def", async () => {
    // heading block declares a required `align` setting.
    const ok = await blockErrors([
      { _type: "page", blocks: [{ _type: "heading", text: "Hi", _settings: { align: "center" } }] },
    ]);
    expect(ok).toEqual([]);
    const e = await blockErrors([
      { _type: "page", blocks: [{ _type: "heading", text: "Hi", _settings: { other: "x" } }] },
    ]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].blocks[0]._settings.align");
    // No `_settings` at all → the required setting isn't enforced (no-op).
    expect(
      await blockErrors([{ _type: "page", blocks: [{ _type: "heading", text: "Hi" }] }]),
    ).toEqual([]);
  });
});

describe("validateSections — select (closed choice)", () => {
  const selectCatalog: SectionCatalog = {
    band: {
      label: "Band",
      fields: {
        tone: {
          type: "select",
          options: [
            { value: "brand", label: "Brand" },
            { value: "base", label: "Base" },
          ],
        },
      },
      settings: {
        align: { type: "select", options: [{ value: "start" }, { value: "center" }] },
      },
    },
  };
  const selErrors = async (value: unknown) =>
    (await validateSections(selectCatalog, value)).filter((v) => v.severity === "error");

  it("accepts a declared option", async () => {
    expect(await selErrors([{ _type: "band", tone: "brand" }])).toEqual([]);
  });

  it("rejects a value outside the option set, naming what was expected", async () => {
    // The failure this type exists to prevent: as `text`, a typo was not an
    // error at all — it degraded silently to a default at render time.
    const e = await selErrors([{ _type: "band", tone: "chartreuse" }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0].tone");
    expect(e[0].message).toContain("unknown value");
    expect(e[0].message).toContain("brand | base");
  });

  it("rejects a non-string value", async () => {
    expect(await selErrors([{ _type: "band", tone: 3 }])).toHaveLength(1);
  });

  it("treats absent as a no-op and empty string as cleared", async () => {
    // Absent = the field wasn't part of a partial update. Empty = the picker's
    // blank option, handing the choice back to the component's own default.
    expect(await selErrors([{ _type: "band" }])).toEqual([]);
    expect(await selErrors([{ _type: "band", tone: "" }])).toEqual([]);
  });

  it("applies to _settings the same way it applies to fields", async () => {
    expect(await selErrors([{ _type: "band", _settings: { align: "center" } }])).toEqual([]);
    const e = await selErrors([{ _type: "band", _settings: { align: "sideways" } }]);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe("sections[0]._settings.align");
  });

  it("rejects everything when a select declares no options", async () => {
    // A select with no options can't accept any value — better a loud rejection
    // than silently behaving like a text field.
    const empty: SectionCatalog = { x: { label: "X", fields: { k: { type: "select" } } } };
    const e = (await validateSections(empty, [{ _type: "x", k: "anything" }])).filter(
      (v) => v.severity === "error",
    );
    expect(e).toHaveLength(1);
  });
});
