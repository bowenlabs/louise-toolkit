// The field-type registry (ADR 0010 Phase A2, #342).
//
// The claim under test is the one the slice exists to make: a field type is ONE
// registration. The `defineFieldType` case below adds a type and asserts it
// validates through `validateSections` and reports its own inline-ness, with no
// other file edited — which is what the five scattered edit sites cost before.
//
// The per-type behaviour is covered in depth by sections-validation.test.ts; this
// file covers the registry itself, and the two invariants that keep it importable
// from the client.

import { describe, expect, it } from "vitest";
import {
  defineFieldType,
  fieldTypeNames,
  getFieldType,
  isInlineField,
  unknownFieldTypes,
  validateFieldType,
} from "../../src/core/content/field-types.js";
import type { SectionCatalog, SectionField } from "../../src/core/content/sections.js";
import { validateSections } from "../../src/core/content/sections.js";
import { isMediaUrl } from "../../src/core/media/storage.js";

/** Build a field whose `type` is any string.
 *
 *  Slice 1 needed a cast here, because `SectionFieldType` was closed and a type
 *  registered at runtime couldn't be written into it. Slice 2 widened it, so this
 *  is now ordinary typed code — the `slug` case below compiles because a site's
 *  own type is authorable, which is the whole point of a registry. */
const field = (f: Partial<SectionField> & { type: string }): SectionField => f;
const ctx = (f: SectionField, path = "x") => ({ field: f, path });

describe("the registry", () => {
  it("registers every built-in from BOTH former systems", () => {
    // Sections had 8, the settings drawer had 6, overlapping on four. One list
    // now — `color` and `links` came from the drawer, the rest from sections.
    expect(fieldTypeNames().sort()).toEqual(
      [
        "array",
        "color",
        "image",
        "link",
        "links",
        "richText",
        "select",
        "text",
        "textarea",
        "toggle",
      ].sort(),
    );
  });

  it("re-registering a name replaces it, so a site can sharpen a built-in", () => {
    const original = getFieldType("text");
    try {
      defineFieldType({
        name: "text",
        inline: true,
        validate: (v, c) =>
          typeof v === "string" && v.length <= 3
            ? undefined
            : [{ path: c.path, message: "too long", severity: "error" }],
      });
      expect(validateFieldType("abcd", ctx(field({ type: "text" })))).toHaveLength(1);
    } finally {
      if (original) defineFieldType(original); // registry is module state — restore it
    }
  });
});

describe("isInlineField", () => {
  it("takes the answer from the type", () => {
    expect(isInlineField(field({ type: "text" }))).toBe(true);
    expect(isInlineField(field({ type: "richText" }))).toBe(true);
    expect(isInlineField(field({ type: "link" }))).toBe(false);
    expect(isInlineField(field({ type: "array" }))).toBe(false);
  });

  it("lets the field override its type", () => {
    // A heading with no visible node to click — the escape hatch that existed
    // before the registry and still has to work.
    expect(isInlineField(field({ type: "text", inline: false }))).toBe(false);
    expect(isInlineField(field({ type: "image", inline: true }))).toBe(true);
  });

  it("treats an unknown type as non-inline", () => {
    // The safe default: an unrecognised field goes to the inspector rather than
    // being made contenteditable on the live page.
    expect(isInlineField(field({ type: "wat" }))).toBe(false);
  });
});

describe("validateFieldType", () => {
  it("skips absent values, leaving presence to the rule chain", () => {
    // Every validator would otherwise repeat the same two guards, and one of them
    // would eventually forget.
    expect(validateFieldType(undefined, ctx(field({ type: "toggle" })))).toEqual([]);
    expect(validateFieldType(null, ctx(field({ type: "toggle" })))).toEqual([]);
  });

  it("passes an unregistered type rather than failing it", () => {
    // A catalog may name a type this build doesn't know — mid-migration, or a
    // site's own. Its `validation` chain still runs; the type just adds nothing.
    expect(validateFieldType("anything", ctx(field({ type: "wat" })))).toEqual([]);
  });

  it("hands the field to the validator, so a closed choice can read its options", () => {
    const f = field({ type: "select", options: [{ value: "a" }, { value: "b" }] });
    expect(validateFieldType("a", ctx(f))).toEqual([]);
    expect(validateFieldType("c", ctx(f))[0]?.message).toContain("expected a | b");
  });
});

describe("a new field type is one registration", () => {
  it("validates through validateSections and reports its inline-ness", async () => {
    // The whole point of the slice. Nothing below touches the SectionFieldType
    // union, the validator, or any inline list — this call is the entire change.
    defineFieldType({
      name: "slug",
      inline: false,
      validate: (value, { path }) =>
        typeof value === "string" && /^[a-z0-9-]+$/.test(value)
          ? undefined
          : [{ path, message: `${path} must be a slug`, severity: "error" }],
    });

    const catalog: SectionCatalog = {
      post: { label: "Post", fields: { handle: { type: "slug" } } },
    };

    expect(await validateSections(catalog, [{ _type: "post", handle: "hello-world" }])).toEqual([]);

    const bad = await validateSections(catalog, [{ _type: "post", handle: "Hello World" }]);
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("must be a slug");

    // And the editor knows where to put it without being told separately.
    expect(isInlineField(field({ type: "slug" }))).toBe(false);
  });
});

// The two systems overlapped on four types and diverged on the rest, so a type
// added to one was silently missing from the other. That had teeth: settings had
// a `links` type and no `link` type, which is why there was nowhere for a scheme
// check to live and stored nav destinations went unvalidated.
describe("the settings types, now on the same registry", () => {
  it("validates `links` rows — including the href that had no check", () => {
    const f = field({ type: "links" });
    expect(validateFieldType([{ label: "Shop", href: "/shop" }], ctx(f, "navLinks"))).toEqual([]);

    const v = validateFieldType(
      [
        { label: "ok", href: "/a" },
        { label: "bad", href: "javascript:alert(1)" },
      ],
      ctx(f, "navLinks"),
    );
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe("navLinks[1].href");
  });

  it("reports a malformed links row rather than throwing on it", () => {
    const v = validateFieldType(["not-an-object"], ctx(field({ type: "links" }), "navLinks"));
    expect(v[0]?.path).toBe("navLinks[0]");
    expect(validateFieldType("nope", ctx(field({ type: "links" })))).toHaveLength(1);
  });

  it("accepts the colour notations a brand setting actually uses", () => {
    const f = field({ type: "color" });
    for (const v of ["#1481ef", "rgb(20, 129, 239)", "hsl(210 90% 51%)", "rebeccapurple", ""]) {
      expect(validateFieldType(v, ctx(f)), v || "(empty)").toEqual([]);
    }
  });

  it("rejects a colour carrying markup or a URL", () => {
    // The check that matters — the value lands in a CSS custom property.
    for (const v of ["<script>", "url(javascript:1)", "red;}body{display:none"]) {
      expect(validateFieldType(v, ctx(field({ type: "color" }))), v).toHaveLength(1);
    }
  });

  it("gives the section path a type the drawer used to own alone", () => {
    // The unification, stated as a behaviour: `color` was settings-only, and a
    // section catalog can now declare it and have it validated.
    expect(isInlineField(field({ type: "color" }))).toBe(false);
    expect(validateFieldType("#fff", ctx(field({ type: "color" })))).toEqual([]);
  });
});

describe("unknownFieldTypes", () => {
  it("names the types nothing registered, so a typo can still fail early", () => {
    // The widened FieldTypeName trades the union's typo check for extensibility.
    // This is that check, opt-in — and it covers site-registered types, which the
    // closed union never could.
    expect(unknownFieldTypes([{ type: "text" }, { type: "links" }])).toEqual([]);
    expect(unknownFieldTypes([{ type: "txet" }, { type: "text" }])).toEqual(["txet"]);
  });

  it("reports each unknown once", () => {
    expect(unknownFieldTypes([{ type: "nope" }, { type: "nope" }])).toEqual(["nope"]);
  });
});

describe("the duplicated predicates agree with their originals", () => {
  // Both are copied rather than imported, to keep this module free of a heavy
  // dependency — it is imported by the CLIENT, which is what makes that matter.
  // Copies drift; these are the tests that stop it.

  it("the inlined isMediaUrl matches core/media/storage", async () => {
    const base = "https://cdn.example.com/media";
    const cases = [
      `${base}/a.png`,
      "https://evil.example.com/a.png",
      "/media/a.png",
      "",
      `${base}`,
    ];
    for (const value of cases) {
      const viaRegistry = validateFieldType(value, {
        field: field({ type: "image" }),
        path: "img",
        mediaBase: base,
      });
      // The registry rejects exactly when storage.ts says it isn't a media URL
      // (empty string is "cleared", which neither treats as a hotlink).
      const expected = value !== "" && !isMediaUrl(base, value);
      expect(viaRegistry.length > 0, `${value || "(empty)"}`).toBe(expected);
    }
  });

  it("the link allowlist matches the HTML sanitizer's", async () => {
    const { sanitizeRichHtml } = await import("../../src/core/security/sanitize.js");
    for (const href of [
      "https://example.com",
      "mailto:hi@example.com",
      "/shop",
      "#top",
      "javascript:alert(1)",
      "  javascript:alert(1)",
    ]) {
      const rejectedByField =
        validateFieldType(href, ctx(field({ type: "link" }), "href")).length > 0;
      const strippedBySanitizer = !sanitizeRichHtml(
        `<a href="${href.replace(/"/g, "&quot;")}">x</a>`,
      ).includes("href=");
      expect(rejectedByField, href).toBe(strippedBySanitizer);
    }
  });
});
