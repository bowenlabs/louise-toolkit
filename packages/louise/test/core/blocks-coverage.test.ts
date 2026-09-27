import { describe, expect, it } from "vitest";
import {
  createBlockRegistry,
  renderBlocksToString,
  type StringBlockRenderer,
} from "../../src/core/content/index.js";

// The block renderer registry in core/content/blocks.ts (#695): lookup by a
// block's `type`, a fallback for unknown types, and string rendering of a
// block array.

type Block = { type: string; text?: string };

describe("createBlockRegistry", () => {
  it("starts empty with no seed", () => {
    const registry = createBlockRegistry<string>();
    expect(registry.types()).toEqual([]);
    expect(registry.has("hero")).toBe(false);
    expect(registry.get("hero")).toBeUndefined();
    expect(registry.resolve("hero")).toBeUndefined();
  });

  it("seeds renderers and a fallback from its arguments", () => {
    const registry = createBlockRegistry({ divider: "hr" }, { fallback: "unknown" });
    expect(registry.types()).toEqual(["divider"]);
    expect(registry.get("divider")).toBe("hr");
    expect(registry.resolve("divider")).toBe("hr");
    expect(registry.resolve("quote")).toBe("unknown");
  });

  it("registers, replaces, and lists types in registration order, chaining each call", () => {
    const registry = createBlockRegistry<string>({ a: "1" });
    const returned = registry.register("b", "2").registerMany({ c: "3", a: "replaced" });
    expect(returned).toBe(registry);
    expect(registry.types()).toEqual(["a", "b", "c"]);
    expect(registry.get("a")).toBe("replaced");
    expect(registry.has("c")).toBe(true);
  });

  it("sets or replaces the fallback, which never shadows a registered type", () => {
    const registry = createBlockRegistry<string>({ hero: "h" });
    expect(registry.setFallback("first")).toBe(registry);
    registry.setFallback("second");
    expect(registry.resolve("missing")).toBe("second");
    expect(registry.resolve("hero")).toBe("h");
    // The fallback isn't a registered type.
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.types()).toEqual(["hero"]);
  });
});

describe("renderBlocksToString", () => {
  const blocks: Block[] = [
    { type: "heading", text: "Menu" },
    { type: "divider" },
    { type: "mystery", text: "?" },
    { type: "heading", text: "Hours" },
  ];

  it("renders each block with its type's renderer and joins the output", () => {
    const registry = createBlockRegistry<StringBlockRenderer<Block>>({
      heading: (b) => `<h2>${b.text}</h2>`,
      divider: () => "<hr>",
    });
    expect(renderBlocksToString(blocks, registry)).toBe("<h2>Menu</h2><hr><h2>Hours</h2>");
  });

  it("uses the fallback for a type with no renderer", () => {
    const registry = createBlockRegistry<StringBlockRenderer<Block>>(
      { divider: () => "<hr>" },
      { fallback: (b) => `<!-- ${b.type} -->` },
    );
    expect(renderBlocksToString(blocks, registry)).toBe(
      "<!-- heading --><hr><!-- mystery --><!-- heading -->",
    );
  });

  it("returns an empty string for no blocks", () => {
    expect(renderBlocksToString([], createBlockRegistry())).toBe("");
  });
});
