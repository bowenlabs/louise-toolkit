import { describe, expect, it } from "vitest";
import {
  applyPatch,
  computePatch,
  diffDocuments,
  type FieldChange,
  formatPath,
} from "../../src/core/cms/index.js";
import type { JsonValue } from "../../src/core/cms/types.js";

type Doc = Record<string, JsonValue>;

const block = (key: string, fields: Record<string, JsonValue>): JsonValue => ({
  _key: key,
  ...fields,
});

// A two-block page-builder document, the shape the deep diff exists for.
const base = (): Doc => ({
  title: "Home",
  blocks: [
    block("a1", { type: "hero", heading: "Welcome", sub: "hi" }),
    block("b2", { type: "text", body: "Lorem" }),
  ],
});

describe("diffDocuments — _key-aware deep diff", () => {
  it("reports a single sub-field edit at the block's key path (not a whole-blocks change)", () => {
    const after = base();
    (after.blocks as JsonValue[])[0] = block("a1", { type: "hero", heading: "Hello", sub: "hi" });
    const changes = diffDocuments(base(), after);
    expect(changes).toEqual<FieldChange[]>([
      {
        path: ["blocks", { key: "a1" }, "heading"],
        kind: "changed",
        before: "Welcome",
        after: "Hello",
      },
    ]);
  });

  it("treats a reorder with unchanged content as a no-op", () => {
    const after = base();
    after.blocks = [(base().blocks as JsonValue[])[1], (base().blocks as JsonValue[])[0]];
    expect(diffDocuments(base(), after)).toEqual([]);
  });

  it("reports an added block at its key path", () => {
    const after = base();
    (after.blocks as JsonValue[]).push(block("c3", { type: "text", body: "New" }));
    const changes = diffDocuments(base(), after);
    expect(changes).toEqual<FieldChange[]>([
      {
        path: ["blocks", { key: "c3" }],
        kind: "added",
        after: block("c3", { type: "text", body: "New" }),
      },
    ]);
  });

  it("reports a removed block at its key path", () => {
    const after = base();
    after.blocks = [(base().blocks as JsonValue[])[0]];
    const changes = diffDocuments(base(), after);
    expect(changes).toEqual<FieldChange[]>([
      {
        path: ["blocks", { key: "b2" }],
        kind: "removed",
        before: block("b2", { type: "text", body: "Lorem" }),
      },
    ]);
  });

  it("recurses into nested plain objects", () => {
    const before: Doc = { meta: { seo: { title: "old", noindex: false } } };
    const after: Doc = { meta: { seo: { title: "new", noindex: false } } };
    expect(diffDocuments(before, after)).toEqual<FieldChange[]>([
      { path: ["meta", "seo", "title"], kind: "changed", before: "old", after: "new" },
    ]);
  });

  it("preserves top-level scalar field behavior (now segmented)", () => {
    const changes = diffDocuments({ title: "Home" }, { title: "About" });
    expect(changes).toEqual<FieldChange[]>([
      { path: ["title"], kind: "changed", before: "Home", after: "About" },
    ]);
  });

  it("reports top-level added / removed fields", () => {
    expect(diffDocuments({ a: 1 }, { a: 1, b: 2 })).toEqual<FieldChange[]>([
      { path: ["b"], kind: "added", after: 2 },
    ]);
    expect(diffDocuments({ a: 1, b: 2 }, { a: 1 })).toEqual<FieldChange[]>([
      { path: ["b"], kind: "removed", before: 2 },
    ]);
  });

  it("treats a non-keyed array (scalars / mixed) as an opaque leaf change", () => {
    const changes = diffDocuments({ tags: ["a", "b"] }, { tags: ["a", "c"] });
    expect(changes).toEqual<FieldChange[]>([
      { path: ["tags"], kind: "changed", before: ["a", "b"], after: ["a", "c"] },
    ]);
  });

  it("honors ignore + fields at the top level", () => {
    const before: Doc = { id: 1, title: "a", createdAt: 10 };
    const after: Doc = { id: 2, title: "b", createdAt: 20 };
    expect(diffDocuments(before, after, { ignore: ["id", "createdAt"] })).toEqual<FieldChange[]>([
      { path: ["title"], kind: "changed", before: "a", after: "b" },
    ]);
    expect(diffDocuments(before, after, { fields: ["title"] })).toHaveLength(1);
  });
});

describe("formatPath", () => {
  it("renders object keys and keyed segments", () => {
    expect(formatPath(["title"])).toBe("title");
    expect(formatPath(["blocks", { key: "b1a2" }, "heading"])).toBe("blocks[b1a2].heading");
    expect(formatPath(["meta", "seo", "title"])).toBe("meta.seo.title");
  });
});

describe("computePatch / applyPatch — top-level write path (unchanged)", () => {
  it("round-trips: applyPatch(before, computePatch(before, after)) deep-equals after", () => {
    const after = base();
    (after.blocks as JsonValue[])[0] = block("a1", { type: "hero", heading: "Hello", sub: "hi" });
    after.title = "Landing";
    const patched = applyPatch(base(), computePatch(base(), after));
    expect(patched).toEqual(after);
  });

  it("emits a single top-level set for a changed blocks array (field-level write)", () => {
    const after = base();
    (after.blocks as JsonValue[])[1] = block("b2", { type: "text", body: "Changed" });
    const patch = computePatch(base(), after);
    expect(patch).toEqual([{ op: "set", path: "blocks", value: after.blocks }]);
  });

  it("sets added fields and unsets removed ones", () => {
    expect(computePatch({ a: 1 }, { a: 1, b: 2 })).toEqual([{ op: "set", path: "b", value: 2 }]);
    expect(computePatch({ a: 1, b: 2 }, { a: 1 })).toEqual([{ op: "unset", path: "b" }]);
  });
});
