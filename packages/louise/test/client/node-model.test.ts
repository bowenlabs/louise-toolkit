// The editable-node model (ADR 0010) — one path grammar replacing four.
//
// Everything the chrome does hangs off these functions, so they carry the
// defensiveness the three old readers each implemented separately: a malformed
// marker must be skipped, never thrown on, or one bad stamp takes down editing
// for the whole page.

import { describe, expect, it } from "vitest";
import {
  formatNodePath,
  NODE_MARKER_ATTR,
  nodeAt,
  parseNodePath,
  readNodeMarkers,
  restampNode,
  samePath,
} from "../../src/client/node.js";

describe("parseNodePath", () => {
  it.each([
    ["a section", "0", [0]],
    ["a block", "0.blocks.1", [0, "blocks", 1]],
    ["a section field", "2.ctaHref", [2, "ctaHref"]],
    ["a block field", "0.blocks.1.href", [0, "blocks", 1, "href"]],
    ["a deeply nested node", "0.blocks.1.items.2.label", [0, "blocks", 1, "items", 2, "label"]],
  ])("parses %s", (_label, value, expected) => {
    expect(parseNodePath(value)).toEqual(expected);
  });

  it("distinguishes indices from keys by type, not position", () => {
    // This is what lets one grammar cover all four old ones: nothing is special
    // about "blocks" or about segment 0 — a number is an index, a word is a key.
    expect(parseNodePath("0.blocks.1")).toEqual([0, "blocks", 1]);
    expect(parseNodePath("0.rows.1.cells.2")).toEqual([0, "rows", 1, "cells", 2]);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["a trailing dot", "0."],
    ["a leading dot", ".0"],
    ["a doubled dot", "0..blocks"],
    ["a negative index", "-1.ctaHref"],
    ["a leading-zero index", "01.ctaHref"],
    ["a numeric-leading key", "0.2fields"],
  ])("rejects %s", (_label, value) => {
    expect(parseNodePath(value)).toBeNull();
  });

  it("round-trips through formatNodePath", () => {
    for (const v of ["0", "0.blocks.1", "2.ctaHref", "0.blocks.1.href"]) {
      expect(formatNodePath(parseNodePath(v) as never)).toBe(v);
    }
  });
});

describe("samePath", () => {
  it("compares by value, and does not confuse an index with its string form", () => {
    expect(samePath([0, "blocks", 1], [0, "blocks", 1])).toBe(true);
    expect(samePath([0, "blocks", 1], [0, "blocks", 2])).toBe(false);
    expect(samePath([0], [0, "blocks"])).toBe(false);
    // "0" as a key would be a different node from index 0 — the type carries meaning.
    expect(samePath([0], ["0"])).toBe(false);
  });
});

/** section 0 → block 1 → the block's href field, the full nesting. */
function tree(): { section: HTMLElement; block: HTMLElement; field: HTMLElement } {
  const section = document.createElement("div");
  section.setAttribute(NODE_MARKER_ATTR, "0");
  const block = document.createElement("div");
  block.setAttribute(NODE_MARKER_ATTR, "0.blocks.1");
  const field = document.createElement("a");
  field.setAttribute(NODE_MARKER_ATTR, "0.blocks.1.href");
  block.appendChild(field);
  section.appendChild(block);
  document.body.appendChild(section);
  return { section, block, field };
}

describe("nodeAt — deepest wins", () => {
  it("returns the nearest marked ancestor, so depth ordering is structural", () => {
    const { section, block, field } = tree();
    // No hand-ordered ladder decides this — `closest` does, because there is only
    // one attribute to match.
    expect(nodeAt(field)?.path).toEqual([0, "blocks", 1, "href"]);
    expect(nodeAt(block)?.path).toEqual([0, "blocks", 1]);
    expect(nodeAt(section)?.path).toEqual([0]);
    document.body.replaceChildren();
  });

  it("resolves from a text node inside a marked element", () => {
    const { field } = tree();
    field.textContent = "Shop";
    expect(nodeAt(field.firstChild)?.path).toEqual([0, "blocks", 1, "href"]);
    document.body.replaceChildren();
  });

  it("returns null outside any marked element", () => {
    const loose = document.createElement("div");
    document.body.appendChild(loose);
    expect(nodeAt(loose)).toBeNull();
    document.body.replaceChildren();
  });

  it("returns null for a malformed marker rather than throwing", () => {
    const el = document.createElement("div");
    el.setAttribute(NODE_MARKER_ATTR, "not..a..path");
    document.body.appendChild(el);
    expect(nodeAt(el)).toBeNull();
    document.body.replaceChildren();
  });
});

describe("readNodeMarkers", () => {
  it("collects every marked node and skips malformed ones", () => {
    const { section } = tree();
    const bad = document.createElement("div");
    bad.setAttribute(NODE_MARKER_ATTR, "0.");
    section.appendChild(bad);

    expect(readNodeMarkers().map((n) => formatNodePath(n.path))).toEqual([
      "0",
      "0.blocks.1",
      "0.blocks.1.href",
    ]);
    document.body.replaceChildren();
  });
});

describe("restampNode", () => {
  it("rewrites a node and every descendant by prefix", () => {
    const { section, block, field } = tree();
    // Section 0 moves to 2 — its block and the block's field must follow without
    // either of them knowing its own depth. This one function replaces the
    // separate section and block re-stampers.
    restampNode(section, [0], [2]);

    expect(section.getAttribute(NODE_MARKER_ATTR)).toBe("2");
    expect(block.getAttribute(NODE_MARKER_ATTR)).toBe("2.blocks.1");
    expect(field.getAttribute(NODE_MARKER_ATTR)).toBe("2.blocks.1.href");
    document.body.replaceChildren();
  });

  it("re-stamps a block within its section, leaving the section alone", () => {
    const { section, block, field } = tree();
    restampNode(block, [0, "blocks", 1], [0, "blocks", 0]);

    expect(section.getAttribute(NODE_MARKER_ATTR)).toBe("0");
    expect(block.getAttribute(NODE_MARKER_ATTR)).toBe("0.blocks.0");
    expect(field.getAttribute(NODE_MARKER_ATTR)).toBe("0.blocks.0.href");
    document.body.replaceChildren();
  });

  it("does not rewrite a sibling that merely shares a prefix string", () => {
    // "0.blocks.10" starts with the characters of "0.blocks.1" — matching on the
    // raw string without the segment boundary would corrupt it.
    const a = document.createElement("div");
    a.setAttribute(NODE_MARKER_ATTR, "0.blocks.1");
    const b = document.createElement("div");
    b.setAttribute(NODE_MARKER_ATTR, "0.blocks.10");
    a.appendChild(b);
    document.body.appendChild(a);

    restampNode(a, [0, "blocks", 1], [0, "blocks", 5]);

    expect(a.getAttribute(NODE_MARKER_ATTR)).toBe("0.blocks.5");
    expect(b.getAttribute(NODE_MARKER_ATTR)).toBe("0.blocks.10");
    document.body.replaceChildren();
  });

  it("is a no-op when the path is unchanged", () => {
    const { block } = tree();
    restampNode(block, [0, "blocks", 1], [0, "blocks", 1]);
    expect(block.getAttribute(NODE_MARKER_ATTR)).toBe("0.blocks.1");
    document.body.replaceChildren();
  });
});
