// Instant structural ops on the node model (ADR 0010).
//
// The invariant every case here defends: after any structural change, every
// surviving marker must still address the item it renders. Markers drive the
// store-write paths, so a drift here doesn't throw — it silently writes an edit
// into the wrong item.
//
// The point of the rewrite is that sections and blocks are the SAME code at
// different depths, so each op is exercised at both.

import { describe, expect, it, afterEach } from "vitest";
import {
  deleteNodeElement,
  insertNodeElement,
  moveNodeElement,
  replaceNodeElement,
  siblingsAt,
} from "../../src/client/node-ops.js";

afterEach(() => document.body.replaceChildren());

/** A container of `n` sections, each holding `blocksPer` blocks, each block
 *  holding one inline-editable field. */
function page(n: number, blocksPer = 0): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const sec = document.createElement("section");
    sec.setAttribute("data-louise-node", String(i));
    const heading = document.createElement("h2");
    heading.setAttribute("data-louise-node", `${i}.heading`);
    sec.appendChild(heading);
    for (let j = 0; j < blocksPer; j++) {
      const b = document.createElement("div");
      b.setAttribute("data-louise-node", `${i}.blocks.${j}`);
      const f = document.createElement("span");
      f.setAttribute("data-louise-node", `${i}.blocks.${j}.body`);
      b.appendChild(f);
      sec.appendChild(b);
    }
    root.appendChild(sec);
  }
  document.body.appendChild(root);
  return root;
}

const markers = (root: Element) =>
  [...root.querySelectorAll("[data-louise-node]")].map((e) => e.getAttribute("data-louise-node"));
/** CONTAINER markers — sections and blocks. One attribute covers fields too
 *  since A2, and the two are told apart by what the path ends in: a container
 *  ends at a position, a field at a key. */
const nodes = (root: Element) => markers(root).filter((p) => /\d+$/.test(p ?? ""));
/** The FIELD markers — one family now (ADR 0010 A2), so they're told from
 *  container markers by their path ending in a key rather than an index. */
const sfields = (root: Element) => markers(root).filter((p) => !/\d+$/.test(p ?? ""));

describe("siblingsAt", () => {
  it("finds an ordered list at any depth", () => {
    const root = page(2, 3);
    expect(siblingsAt([], root)).toHaveLength(2);
    expect(siblingsAt([1, "blocks"], root)).toHaveLength(3);
  });

  it("does not mistake one section's blocks for another's", () => {
    const root = page(3, 2);
    expect(siblingsAt([2, "blocks"], root).map((e) => e.getAttribute("data-louise-node"))).toEqual([
      "2.blocks.0",
      "2.blocks.1",
    ]);
  });
});

describe("moveNodeElement", () => {
  it("reorders sections and re-stamps the fields inside them", () => {
    const root = page(3);
    moveNodeElement([], 2, 0, root);

    expect(nodes(root)).toEqual(["0", "1", "2"]);
    // The heading that was section 2's is now section 0's, and its marker must
    // have followed — otherwise an edit to it writes into the wrong item. One
    // family since A2, so this is the prefix rewrite doing its job at depth.
    expect(sfields(root)).toEqual(["0.heading", "1.heading", "2.heading"]);
  });

  it("reorders blocks within one section, leaving the other section alone", () => {
    const root = page(2, 2);
    moveNodeElement([1, "blocks"], 0, 1, root);

    expect(nodes(root)).toEqual(["0", "0.blocks.0", "0.blocks.1", "1", "1.blocks.0", "1.blocks.1"]);
    expect(sfields(root)).toEqual([
      "0.heading",
      "0.blocks.0.body",
      "0.blocks.1.body",
      "1.heading",
      "1.blocks.0.body",
      "1.blocks.1.body",
    ]);
  });

  it("carries a section's blocks with it", () => {
    const root = page(2, 1);
    const movedBlockField = root.querySelectorAll('[data-louise-node="1.blocks.0.body"]')[0];
    moveNodeElement([], 1, 0, root);

    // Same element, new address — the whole subtree was re-stamped by prefix.
    expect(movedBlockField.getAttribute("data-louise-node")).toBe("0.blocks.0.body");
  });

  it("is a no-op for an out-of-range or identical index", () => {
    const root = page(2);
    moveNodeElement([], 0, 0, root);
    moveNodeElement([], 5, 0, root);
    moveNodeElement([], 0, -1, root);
    expect(nodes(root)).toEqual(["0", "1"]);
  });
});

describe("deleteNodeElement", () => {
  it("removes a section and closes the gap", () => {
    const root = page(3);
    deleteNodeElement([], 1, root);

    expect(nodes(root)).toEqual(["0", "1"]);
    expect(sfields(root)).toEqual(["0.heading", "1.heading"]);
  });

  it("removes a block and closes the gap within its section", () => {
    const root = page(2, 3);
    deleteNodeElement([0, "blocks"], 1, root);

    expect(siblingsAt([0, "blocks"], root).map((e) => e.getAttribute("data-louise-node"))).toEqual([
      "0.blocks.0",
      "0.blocks.1",
    ]);
    // The untouched section keeps its own numbering.
    expect(siblingsAt([1, "blocks"], root)).toHaveLength(3);
  });

  it("is a no-op when the index doesn't exist", () => {
    const root = page(2);
    deleteNodeElement([], 9, root);
    expect(nodes(root)).toEqual(["0", "1"]);
  });
});

describe("insertNodeElement", () => {
  /** What the fragment route returns: stamped at its own index 0. */
  const rendered = (): HTMLElement => {
    const el = document.createElement("section");
    el.setAttribute("data-louise-node", "0");
    const h = document.createElement("h2");
    h.setAttribute("data-louise-node", "0.heading");
    el.appendChild(h);
    return el;
  };

  it("places a rendered section and fixes every index around it", () => {
    const root = page(2);
    insertNodeElement(rendered(), [], 1, root);

    expect(nodes(root)).toEqual(["0", "1", "2"]);
    // The inserted element arrives stamped at 0 and must be corrected to 1 —
    // otherwise two sections claim index 0 and edits collide.
    expect(sfields(root)).toEqual(["0.heading", "1.heading", "2.heading"]);
  });

  it("appends when the index is past the end", () => {
    const root = page(2);
    insertNodeElement(rendered(), [], 9, root);
    expect(nodes(root)).toEqual(["0", "1", "2"]);
  });
});

describe("replaceNodeElement", () => {
  it("swaps a section in place and re-stamps only it", () => {
    const root = page(3);
    const el = document.createElement("section");
    el.setAttribute("data-louise-node", "0"); // as the fragment route stamps it
    const f = document.createElement("span");
    f.setAttribute("data-louise-node", "0.body");
    el.appendChild(f);

    replaceNodeElement([], 1, el, root);

    expect(nodes(root)).toEqual(["0", "1", "2"]);
    expect(el.getAttribute("data-louise-node")).toBe("1");
    expect(f.getAttribute("data-louise-node")).toBe("1.body");
  });

  it("is a no-op when the index doesn't exist", () => {
    const root = page(1);
    const el = document.createElement("section");
    el.setAttribute("data-louise-node", "0");
    replaceNodeElement([], 4, el, root);
    expect(nodes(root)).toEqual(["0"]);
  });
});
