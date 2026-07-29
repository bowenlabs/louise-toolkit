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
  validateFieldType,
} from "../../src/core/content/field-types.js";
import type { SectionCatalog, SectionField } from "../../src/core/content/sections.js";
import { validateSections } from "../../src/core/content/sections.js";
import { isMediaUrl } from "../../src/core/media/storage.js";

/** Build a field whose `type` is any string.
 *
 *  The cast is load-bearing, not laziness: `SectionFieldType` is a closed union,
 *  so a type registered at runtime — a site's own, or the `slug` below — cannot be
 *  written into it. That gap is real and is A2 slice 2's to close (#343); until
 *  then this helper is where the test acknowledges it. */
const field = (f: { type: string } & Partial<Omit<SectionField, "type">>) =>
  f as unknown as SectionField;
const ctx = (f: SectionField, path = "x") => ({ field: f, path });

describe("the registry", () => {
  it("registers every built-in the authoring union names", () => {
    // If these drift apart, a catalog can name a type that validates as nothing.
    expect(fieldTypeNames().sort()).toEqual(
      ["array", "image", "link", "richText", "select", "text", "textarea", "toggle"].sort(),
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

    const catalog = {
      post: { label: "Post", fields: { handle: { type: "slug" } } },
    } as unknown as SectionCatalog;

    expect(await validateSections(catalog, [{ _type: "post", handle: "hello-world" }])).toEqual([]);

    const bad = await validateSections(catalog, [{ _type: "post", handle: "Hello World" }]);
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("must be a slug");

    // And the editor knows where to put it without being told separately.
    expect(isInlineField(field({ type: "slug" }))).toBe(false);
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
