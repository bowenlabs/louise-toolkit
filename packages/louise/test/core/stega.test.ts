import { describe, expect, it } from "vitest";
import {
  defaultStegaFilter,
  encodeDocument,
  stegaClean,
  stegaDecode,
  stegaEncode,
} from "../../src/core/content/stega.js";
import type { JsonValue } from "../../src/core/content/types.js";
import { cleanCopiedStega } from "../../src/core/content/visual-editing.js";

const ref = { collection: "pages", id: 7, field: "title" };

describe("stegaEncode / stegaDecode", () => {
  it("round-trips an EditRef through invisible payload while preserving visible text", () => {
    const encoded = stegaEncode(ref, "Welcome");
    expect(encoded).not.toBe("Welcome"); // payload appended
    expect(encoded.length).toBeGreaterThan("Welcome".length);
    expect(stegaClean(encoded)).toBe("Welcome"); // visible text intact
    expect(stegaDecode(encoded)).toEqual(ref);
  });

  it("returns null for a string with no Louise payload", () => {
    expect(stegaDecode("just text")).toBeNull();
  });
});

describe("stegaClean", () => {
  it("fully strips the payload back to the visible text", () => {
    const cleaned = stegaClean(stegaEncode(ref, "Hello"));
    expect(cleaned).toBe("Hello");
    expect(cleaned).toHaveLength(5); // no residual zero-width chars
  });

  it("is a no-op on clean strings", () => {
    expect(stegaClean("nothing to strip")).toBe("nothing to strip");
  });
});

describe("cleanCopiedStega", () => {
  it("strips the payload from copied text and flags the change", () => {
    const result = cleanCopiedStega(stegaEncode(ref, "Welcome"), "");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("Welcome");
  });

  it("strips a payload hiding in the copied HTML", () => {
    const html = `<h1>${stegaEncode(ref, "Welcome")}</h1>`;
    const result = cleanCopiedStega("Welcome", html);
    expect(result.changed).toBe(true);
    expect(result.html).toBe("<h1>Welcome</h1>");
  });

  it("reports no change and leaves clean text/html untouched (native copy)", () => {
    const result = cleanCopiedStega("Welcome", "<h1>Welcome</h1>");
    expect(result.changed).toBe(false);
    expect(result.text).toBe("Welcome");
    expect(result.html).toBe("<h1>Welcome</h1>");
  });
});

describe("defaultStegaFilter", () => {
  it("skips non-display fields (URLs, ids, dates, structural keys)", () => {
    for (const f of [
      "slug",
      "url",
      "href",
      "id",
      "email",
      "date",
      "_key",
      "type",
      "status",
      "meta",
      "created_at",
      "createdAt",
      "updatedAt",
    ]) {
      expect(defaultStegaFilter(f)).toBe(false);
    }
  });

  it("encodes display prose fields", () => {
    for (const f of ["title", "body", "heading", "caption", "subtitle"]) {
      expect(defaultStegaFilter(f)).toBe(true);
    }
  });
});

describe("encodeDocument", () => {
  const doc = (): Record<string, JsonValue> => ({
    title: "Home",
    slug: "home",
    blocks: [{ _key: "a1", type: "hero", heading: "Welcome" }],
  });

  it("encodes eligible display fields and skips filtered ones", () => {
    const out = encodeDocument("pages", 5, doc());
    expect(stegaDecode(out.title as string)).toEqual({
      collection: "pages",
      id: 5,
      field: "title",
    });
    // slug is filtered → untouched, no payload leaks into the URL-ish field.
    expect(out.slug).toBe("home");
    expect(stegaDecode(out.slug as string)).toBeNull();
  });

  it("recurses into keyed blocks, addressing sub-fields by _key", () => {
    const out = encodeDocument("pages", 5, doc());
    const block = (out.blocks as Array<Record<string, JsonValue>>)[0];
    expect(stegaDecode(block.heading as string)).toEqual({
      collection: "pages",
      id: 5,
      field: "blocks.a1.heading",
    });
    expect(block._key).toBe("a1"); // structural key untouched
    expect(block.type).toBe("hero"); // filtered field untouched
  });
});
