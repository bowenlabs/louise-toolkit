// happy-dom coverage for the on-canvas chrome marker contract (#182 Phases 1–2):
// the render stamps `data-louise-section="<i>"` per section and
// `data-louise-block="<i>.blocks.<j>"` per block; the chrome resolves those
// markers to elements (ordered by index), hit-tests a node to its nearest
// enclosing section/block (deepest wins), draws the two-layer ring + toolbar, and
// re-stamps both layers through instant reorder/delete.

import { afterEach, describe, expect, it } from "vitest";
import {
  BLOCK_MARKER_ATTR,
  type BlockRef,
  blockRefOf,
  deleteBlockElement,
  deleteSectionElement,
  insertSectionElement,
  moveBlockElement,
  moveSectionElement,
  mountSectionChrome,
  parseBlockMarker,
  readBlockMarkers,
  readSectionMarkers,
  replaceSectionElement,
  restampBlock,
  restampSection,
  SECTION_MARKER_ATTR,
  sectionIndexOf,
} from "../../src/client/chrome.js";

/** Sections with an inner `<h1 data-louise-sfield="<i>.title">` so restamping of
 *  both the section marker and its field paths is observable. */
function hostWithFields(count: number): HTMLElement {
  const el = document.createElement("div");
  for (let i = 0; i < count; i++) {
    const sec = document.createElement("section");
    sec.setAttribute(SECTION_MARKER_ATTR, String(i));
    const h = document.createElement("h1");
    h.setAttribute("data-louise-sfield", `${i}.title`);
    h.textContent = `Title ${i}`;
    sec.appendChild(h);
    el.appendChild(sec);
  }
  document.body.appendChild(el);
  return el;
}

/** A host with one marked `<section>` per given marker value (each wrapping a
 *  `<p>` so descendant hit-testing has something to resolve from). */
function host(markers: (number | string)[]): HTMLElement {
  const el = document.createElement("div");
  for (const m of markers) {
    const sec = document.createElement("section");
    sec.setAttribute(SECTION_MARKER_ATTR, String(m));
    const p = document.createElement("p");
    p.textContent = `s${m}`;
    sec.appendChild(p);
    el.appendChild(sec);
  }
  document.body.appendChild(el);
  return el;
}

afterEach(() => document.body.replaceChildren());

describe("chrome — section marker resolver (#182 Phase 1)", () => {
  it("returns marked sections ordered by stamped index, not DOM order", () => {
    const el = host([2, 0, 1]); // DOM order 2, 0, 1
    const marks = readSectionMarkers(el as unknown as ParentNode);
    expect(marks.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(marks.every((m) => m.el.tagName === "SECTION")).toBe(true);
  });

  it("skips missing / negative / non-integer markers", () => {
    const el = host([0, "x", -1, 1, "2.5"]);
    expect(readSectionMarkers(el as unknown as ParentNode).map((m) => m.index)).toEqual([0, 1]);
  });

  it("defaults its root to the whole document", () => {
    host([0]);
    expect(readSectionMarkers().map((m) => m.index)).toEqual([0]);
  });

  it("resolves a descendant element to its nearest enclosing section", () => {
    const el = host([0, 1]);
    const inner = el.querySelectorAll("p")[1]; // inside section index 1
    expect(sectionIndexOf(inner)).toBe(1);
  });

  it("resolves a text node via its parent element", () => {
    const el = host([3]);
    const text = el.querySelector("p")?.firstChild ?? null; // a Text node
    expect(sectionIndexOf(text)).toBe(3);
  });

  it("returns null outside every section (and for null)", () => {
    host([0]);
    const orphan = document.createElement("div");
    document.body.appendChild(orphan);
    expect(sectionIndexOf(orphan)).toBeNull();
    expect(sectionIndexOf(null)).toBeNull();
  });
});

describe("chrome — on-canvas section toolbar (#182 Phase 1)", () => {
  let dispose: (() => void) | undefined;
  const calls = { up: [] as number[], down: [] as number[], del: [] as number[] };

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    calls.up = [];
    calls.down = [];
    calls.del = [];
    document.body.replaceChildren();
    document.getElementById("louise-chrome-style")?.remove();
  });

  const setup = (n: number): HTMLElement => {
    const el = host(Array.from({ length: n }, (_, i) => i));
    dispose = mountSectionChrome({
      onMoveUp: (i) => calls.up.push(i),
      onMoveDown: (i) => calls.down.push(i),
      onDelete: (i) => calls.del.push(i),
    });
    return el;
  };
  const toolbar = () => document.querySelector<HTMLElement>(".louise-chrome-toolbar");
  const buttons = () => [...(toolbar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
  const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));

  it("opens the toolbar and rings the section on hover", () => {
    const el = setup(3);
    expect(toolbar()?.dataset.open).toBe("0");
    over(el.querySelectorAll("p")[1]);
    expect(toolbar()?.dataset.open).toBe("1");
    expect(el.querySelectorAll("section")[1].classList.contains("louise-chrome-active")).toBe(true);
  });

  it("wires the toolbar buttons to the actions with the active index", () => {
    const el = setup(3);
    over(el.querySelectorAll("p")[1]);
    const [up, down, del] = buttons();
    del.click();
    down.click();
    up.click();
    expect(calls).toEqual({ up: [1], down: [1], del: [1] });
  });

  it("disables move-up on the first section, move-down on the last", () => {
    const el = setup(3);
    over(el.querySelectorAll("p")[0]);
    expect(buttons()[0].disabled).toBe(true); // up disabled at first
    expect(buttons()[1].disabled).toBe(false);
    over(el.querySelectorAll("p")[2]);
    expect(buttons()[0].disabled).toBe(false);
    expect(buttons()[1].disabled).toBe(true); // down disabled at last
  });

  it("keeps the section active over the toolbar, closes off any section", () => {
    const el = setup(2);
    over(el.querySelectorAll("p")[0]);
    const tb = toolbar();
    if (!tb) throw new Error("no toolbar");
    over(tb); // hovering the toolbar keeps it open
    expect(tb.dataset.open).toBe("1");
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    over(outside);
    expect(tb.dataset.open).toBe("0");
  });

  it("dispose removes the toolbar + style and detaches the listener", () => {
    const el = setup(2);
    over(el.querySelectorAll("p")[0]);
    dispose?.();
    dispose = undefined;
    expect(document.querySelector(".louise-chrome-toolbar")).toBeNull();
    expect(document.getElementById("louise-chrome-style")).toBeNull();
    over(el.querySelectorAll("p")[0]); // no listener → nothing recreated
    expect(document.querySelector(".louise-chrome-toolbar")).toBeNull();
  });
});

describe("chrome — instant structural ops (#182 Phase 1)", () => {
  const domTitles = () => [...document.querySelectorAll("section h1")].map((h) => h.textContent);
  const domMarkers = () =>
    [...document.querySelectorAll("section")].map((s) => s.getAttribute(SECTION_MARKER_ATTR));
  const sfieldOf = (title: string) =>
    [...document.querySelectorAll("section")]
      .find((s) => s.querySelector("h1")?.textContent === title)
      ?.querySelector("h1")
      ?.getAttribute("data-louise-sfield");

  it("restampSection re-stamps the marker and inner sfield leading index", () => {
    const el = hostWithFields(3);
    const sec = el.querySelectorAll("section")[2];
    restampSection(sec, 0);
    expect(sec.getAttribute(SECTION_MARKER_ATTR)).toBe("0");
    expect(sec.querySelector("h1")?.getAttribute("data-louise-sfield")).toBe("0.title");
  });

  it("moveSectionElement relocates the node and re-stamps 0…n-1 in the new order", () => {
    hostWithFields(3); // Title 0, 1, 2
    moveSectionElement(0, 2);
    expect(domTitles()).toEqual(["Title 1", "Title 2", "Title 0"]);
    expect(domMarkers()).toEqual(["0", "1", "2"]); // stamped by new position
    expect(sfieldOf("Title 0")).toBe("2.title"); // moved section's field re-pathed
    expect(sfieldOf("Title 1")).toBe("0.title");
  });

  it("moveSectionElement handles an adjacent swap (move up)", () => {
    hostWithFields(3);
    moveSectionElement(2, 1); // move the last up one
    expect(domTitles()).toEqual(["Title 0", "Title 2", "Title 1"]);
    expect(sfieldOf("Title 2")).toBe("1.title");
  });

  it("deleteSectionElement removes the node and re-stamps survivors gaplessly", () => {
    hostWithFields(3);
    deleteSectionElement(1); // remove Title 1
    expect(domTitles()).toEqual(["Title 0", "Title 2"]);
    expect(domMarkers()).toEqual(["0", "1"]);
    expect(sfieldOf("Title 2")).toBe("1.title"); // shifted 2 → 1
  });

  it("out-of-range ops are no-ops", () => {
    hostWithFields(2);
    moveSectionElement(0, 5);
    moveSectionElement(-1, 0);
    deleteSectionElement(9);
    expect(domTitles()).toEqual(["Title 0", "Title 1"]);
  });

  /** A fragment-route section element (stamped at 0, as the route renders it). */
  const fragment = (title: string): HTMLElement => {
    const sec = document.createElement("section");
    sec.setAttribute(SECTION_MARKER_ATTR, "0");
    const h = document.createElement("h1");
    h.setAttribute("data-louise-sfield", "0.title");
    h.textContent = title;
    sec.appendChild(h);
    return sec;
  };

  it("insertSectionElement splices at an index and re-stamps 0…n", () => {
    const host = hostWithFields(2); // Title 0, Title 1
    insertSectionElement(fragment("Inserted"), 1, host);
    expect(domTitles()).toEqual(["Title 0", "Inserted", "Title 1"]);
    expect(domMarkers()).toEqual(["0", "1", "2"]);
    expect(sfieldOf("Inserted")).toBe("1.title"); // stamped to its new index
    expect(sfieldOf("Title 1")).toBe("2.title"); // shifted 1 → 2
  });

  it("insertSectionElement appends when index is past the end", () => {
    const host = hostWithFields(2);
    insertSectionElement(fragment("Appended"), 2, host);
    expect(domTitles()).toEqual(["Title 0", "Title 1", "Appended"]);
    expect(domMarkers()).toEqual(["0", "1", "2"]);
    expect(sfieldOf("Appended")).toBe("2.title");
  });

  it("insertSectionElement adds the first section of an empty container", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    insertSectionElement(fragment("First"), 0, host);
    expect(domTitles()).toEqual(["First"]);
    expect(domMarkers()).toEqual(["0"]);
  });

  it("replaceSectionElement swaps the section at an index in place, re-stamped", () => {
    hostWithFields(3); // Title 0, 1, 2
    replaceSectionElement(1, fragment("Replaced"));
    expect(domTitles()).toEqual(["Title 0", "Replaced", "Title 2"]);
    expect(domMarkers()).toEqual(["0", "1", "2"]);
    expect(sfieldOf("Replaced")).toBe("1.title"); // fragment stamped 0 → 1
  });

  it("replaceSectionElement is a no-op when the index isn't found", () => {
    hostWithFields(2);
    replaceSectionElement(9, fragment("Nope"));
    expect(domTitles()).toEqual(["Title 0", "Title 1"]);
  });
});

/** Sections, each carrying `blocksPer` marked blocks. A section has an `<h1>`
 *  section field and each block a `<div data-louise-block="<i>.blocks.<j>">`
 *  wrapping an `<h2 data-louise-sfield="<i>.blocks.<j>.heading">` — so both marker
 *  layers and their field paths are observable through restamps. */
function hostWithBlocks(sections: number, blocksPer: number): HTMLElement {
  const el = document.createElement("div");
  for (let i = 0; i < sections; i++) {
    const sec = document.createElement("section");
    sec.setAttribute(SECTION_MARKER_ATTR, String(i));
    const h1 = document.createElement("h1");
    h1.setAttribute("data-louise-sfield", `${i}.title`);
    h1.textContent = `S${i}`;
    sec.appendChild(h1);
    for (let j = 0; j < blocksPer; j++) {
      const blk = document.createElement("div");
      blk.setAttribute(BLOCK_MARKER_ATTR, `${i}.blocks.${j}`);
      const h2 = document.createElement("h2");
      h2.setAttribute("data-louise-sfield", `${i}.blocks.${j}.heading`);
      h2.textContent = `S${i}B${j}`;
      blk.appendChild(h2);
      sec.appendChild(blk);
    }
    el.appendChild(sec);
  }
  document.body.appendChild(el);
  return el;
}

describe("chrome — block marker resolver (#182 Phase 2)", () => {
  afterEach(() => document.body.replaceChildren());

  it("parses a well-formed block marker and rejects malformed ones", () => {
    expect(parseBlockMarker("2.blocks.3")).toEqual({ section: 2, block: 3 });
    expect(parseBlockMarker(null)).toBeNull();
    expect(parseBlockMarker("2.items.3")).toBeNull(); // wrong middle segment
    expect(parseBlockMarker("2.blocks")).toBeNull(); // too few parts
    expect(parseBlockMarker("2.blocks.3.4")).toBeNull(); // too many
    expect(parseBlockMarker("-1.blocks.0")).toBeNull(); // negative
    expect(parseBlockMarker("x.blocks.0")).toBeNull(); // non-numeric
  });

  it("returns marked blocks ordered by (section, block), not DOM order", () => {
    const el = document.createElement("div");
    for (const m of ["1.blocks.1", "0.blocks.1", "1.blocks.0", "0.blocks.0"]) {
      const d = document.createElement("div");
      d.setAttribute(BLOCK_MARKER_ATTR, m);
      el.appendChild(d);
    }
    document.body.appendChild(el);
    expect(
      readBlockMarkers(el as unknown as ParentNode).map((b) => `${b.section}.${b.block}`),
    ).toEqual(["0.0", "0.1", "1.0", "1.1"]);
  });

  it("skips malformed block markers", () => {
    const el = document.createElement("div");
    for (const m of ["0.blocks.0", "0.items.0", "0.blocks.x"]) {
      const d = document.createElement("div");
      d.setAttribute(BLOCK_MARKER_ATTR, m);
      el.appendChild(d);
    }
    document.body.appendChild(el);
    expect(readBlockMarkers(el as unknown as ParentNode)).toHaveLength(1);
  });

  it("resolves a descendant to its nearest enclosing block (deepest wins)", () => {
    const el = hostWithBlocks(2, 2);
    const inner = el.querySelectorAll("h2")[3]; // S1B1
    expect(blockRefOf(inner)).toEqual({ section: 1, block: 1 });
  });

  it("returns null for a node inside a section but outside any block", () => {
    const el = hostWithBlocks(1, 1);
    expect(blockRefOf(el.querySelector("h1"))).toBeNull(); // section field, not a block
    expect(blockRefOf(null)).toBeNull();
  });
});

describe("chrome — two-layer toolbar / deepest-boundary (#182 Phase 2)", () => {
  let dispose: (() => void) | undefined;
  const calls = {
    su: [] as number[],
    bu: [] as BlockRef[],
    bd: [] as BlockRef[],
    bdel: [] as BlockRef[],
  };

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    calls.su = [];
    calls.bu = [];
    calls.bd = [];
    calls.bdel = [];
    document.body.replaceChildren();
    document.getElementById("louise-chrome-style")?.remove();
  });

  const setup = (sections: number, blocksPer: number): HTMLElement => {
    const el = hostWithBlocks(sections, blocksPer);
    dispose = mountSectionChrome({
      onMoveUp: (i) => calls.su.push(i),
      onMoveDown: () => {},
      onDelete: () => {},
      blocks: {
        onMoveUp: (r) => calls.bu.push(r),
        onMoveDown: (r) => calls.bd.push(r),
        onDelete: (r) => calls.bdel.push(r),
      },
    });
    return el;
  };
  const sectionToolbar = () =>
    document.querySelector<HTMLElement>(".louise-chrome-toolbar:not(.louise-block-toolbar)");
  const blockToolbar = () => document.querySelector<HTMLElement>(".louise-block-toolbar");
  const blockButtons = () =>
    [...(blockToolbar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
  const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));

  it("hovering a block rings it blue and opens the block toolbar, not the section", () => {
    const el = setup(1, 2);
    const block = el.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)[1]; // S0B1
    over(block.querySelector("h2") as Node);
    expect(block.classList.contains("louise-block-active")).toBe(true);
    expect(el.querySelector("section")?.classList.contains("louise-chrome-active")).toBe(false);
    expect(blockToolbar()?.dataset.open).toBe("1");
    expect(sectionToolbar()?.dataset.open).toBe("0");
  });

  it("hovering section content outside a block rings the section, clearing any block", () => {
    const el = setup(1, 2);
    const block = el.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)[0];
    over(block.querySelector("h2") as Node); // block first
    over(el.querySelector("h1") as Node); // then the section-level field
    expect(el.querySelector("section")?.classList.contains("louise-chrome-active")).toBe(true);
    expect(block.classList.contains("louise-block-active")).toBe(false);
    expect(sectionToolbar()?.dataset.open).toBe("1");
    expect(blockToolbar()?.dataset.open).toBe("0");
  });

  it("wires the block toolbar buttons to the block actions with the hovered ref", () => {
    // A middle block (index 1 of 3) so move-up and move-down are both enabled.
    const el = setup(1, 3);
    over(el.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)[1].querySelector("h2") as Node); // S0B1
    const [up, down, del] = blockButtons();
    up.click();
    down.click();
    del.click();
    const ref = { section: 0, block: 1 };
    expect(calls.bu).toEqual([ref]);
    expect(calls.bd).toEqual([ref]);
    expect(calls.bdel).toEqual([ref]);
  });

  it("disables block move-up on the first block and move-down on the last", () => {
    const el = setup(1, 3);
    const blocks = el.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`);
    over(blocks[0].querySelector("h2") as Node);
    expect(blockButtons()[0].disabled).toBe(true); // up disabled on first
    expect(blockButtons()[1].disabled).toBe(false);
    over(blocks[2].querySelector("h2") as Node);
    expect(blockButtons()[0].disabled).toBe(false);
    expect(blockButtons()[1].disabled).toBe(true); // down disabled on last
  });

  it("keeps the block active while hovering the block toolbar", () => {
    const el = setup(1, 1);
    over(el.querySelector(`[${BLOCK_MARKER_ATTR}]`)?.querySelector("h2") as Node);
    const tb = blockToolbar();
    if (!tb) throw new Error("no block toolbar");
    over(tb);
    expect(tb.dataset.open).toBe("1");
  });

  it("a section-only chrome (no block actions) ignores block markers", () => {
    const el = hostWithBlocks(1, 1);
    dispose = mountSectionChrome({
      onMoveUp: (i) => calls.su.push(i),
      onMoveDown: () => {},
      onDelete: () => {},
    });
    expect(blockToolbar()).toBeNull(); // no block toolbar created
    over(el.querySelector(`[${BLOCK_MARKER_ATTR}]`)?.querySelector("h2") as Node);
    // Hovering a block falls back to ringing its enclosing section.
    expect(el.querySelector("section")?.classList.contains("louise-chrome-active")).toBe(true);
  });

  it("omits the block + button unless onAdd is supplied", () => {
    setup(1, 2); // block actions without onAdd
    expect(blockButtons()).toHaveLength(3); // ↑ ↓ ✕ only
  });

  it("shows a block + button when onAdd is supplied and calls it with the ref", () => {
    const added: BlockRef[] = [];
    const el = hostWithBlocks(1, 2);
    dispose = mountSectionChrome({
      onMoveUp: () => {},
      onMoveDown: () => {},
      onDelete: () => {},
      blocks: {
        onMoveUp: () => {},
        onMoveDown: () => {},
        onDelete: () => {},
        onAdd: (r) => added.push(r),
      },
    });
    over(el.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)[0].querySelector("h2") as Node); // block 0
    const buttons = blockButtons();
    expect(buttons).toHaveLength(4); // ↑ ↓ ✕ +
    expect(buttons[3].textContent).toBe("+");
    buttons[3].click();
    expect(added).toEqual([{ section: 0, block: 0 }]);
  });

  it("adds a ⚙ inspect button to both toolbars when onInspect is wired (#182 Phase 4)", () => {
    const inspectedSection: number[] = [];
    const inspectedBlock: BlockRef[] = [];
    const el = hostWithBlocks(1, 1);
    dispose = mountSectionChrome({
      onMoveUp: () => {},
      onMoveDown: () => {},
      onDelete: () => {},
      onInspect: (i) => inspectedSection.push(i),
      blocks: {
        onMoveUp: () => {},
        onMoveDown: () => {},
        onDelete: () => {},
        onInspect: (r) => inspectedBlock.push(r),
      },
    });
    // Section ⚙ — hover the section-level field (outside any block).
    over(el.querySelector("h1") as Node);
    const secCog = [...(sectionToolbar()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "⚙",
    );
    secCog?.click();
    expect(inspectedSection).toEqual([0]);
    // Block ⚙.
    over(el.querySelector(`[${BLOCK_MARKER_ATTR}]`)?.querySelector("h2") as Node);
    const blkCog = blockButtons().find((b) => b.textContent === "⚙");
    blkCog?.click();
    expect(inspectedBlock).toEqual([{ section: 0, block: 0 }]);
  });

  it("omits the ⚙ when onInspect is not wired", () => {
    setup(1, 1); // no onInspect on section or block actions
    expect(
      [...(sectionToolbar()?.querySelectorAll("button") ?? [])].some((b) => b.textContent === "⚙"),
    ).toBe(false);
    expect(blockButtons().some((b) => b.textContent === "⚙")).toBe(false);
  });
});

describe("chrome — instant block ops (#182 Phase 2)", () => {
  const blockText = (el: Element) => el.querySelector("h2")?.textContent;
  const blockMarkers = (section: number) =>
    readBlockMarkers()
      .filter((b) => b.section === section)
      .map((b) => b.el.getAttribute(BLOCK_MARKER_ATTR));
  const markerOfBlockText = (text: string) =>
    [...document.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)]
      .find((b) => b.querySelector("h2")?.textContent === text)
      ?.getAttribute(BLOCK_MARKER_ATTR);
  const sfieldOfBlockText = (text: string) =>
    [...document.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)]
      .find((b) => b.querySelector("h2")?.textContent === text)
      ?.querySelector("h2")
      ?.getAttribute("data-louise-sfield");

  afterEach(() => document.body.replaceChildren());

  it("restampBlock re-stamps the block marker and its field path", () => {
    const el = hostWithBlocks(1, 3);
    const blk = el.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)[2]; // S0B2
    restampBlock(blk as HTMLElement, 0, 0);
    expect(blk.getAttribute(BLOCK_MARKER_ATTR)).toBe("0.blocks.0");
    expect(blk.querySelector("h2")?.getAttribute("data-louise-sfield")).toBe("0.blocks.0.heading");
  });

  it("moveBlockElement relocates within the section and re-stamps 0…n-1", () => {
    hostWithBlocks(1, 3); // S0B0, S0B1, S0B2
    moveBlockElement(0, 0, 2);
    expect([...document.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)].map(blockText)).toEqual([
      "S0B1",
      "S0B2",
      "S0B0",
    ]);
    expect(blockMarkers(0)).toEqual(["0.blocks.0", "0.blocks.1", "0.blocks.2"]);
    expect(sfieldOfBlockText("S0B0")).toBe("0.blocks.2.heading"); // moved block re-pathed
  });

  it("deleteBlockElement removes the block and re-stamps survivors gaplessly", () => {
    hostWithBlocks(1, 3);
    deleteBlockElement(0, 1); // remove S0B1
    expect([...document.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)].map(blockText)).toEqual([
      "S0B0",
      "S0B2",
    ]);
    expect(blockMarkers(0)).toEqual(["0.blocks.0", "0.blocks.1"]);
    expect(sfieldOfBlockText("S0B2")).toBe("0.blocks.1.heading"); // shifted 2 → 1
  });

  it("block ops are scoped to their own section", () => {
    hostWithBlocks(2, 2); // section 0 + section 1, two blocks each
    moveBlockElement(0, 0, 1); // reorder section 0 only
    expect(markerOfBlockText("S0B0")).toBe("0.blocks.1");
    expect(markerOfBlockText("S0B1")).toBe("0.blocks.0");
    // Section 1's blocks are untouched.
    expect(markerOfBlockText("S1B0")).toBe("1.blocks.0");
    expect(markerOfBlockText("S1B1")).toBe("1.blocks.1");
  });

  it("a section reorder re-stamps its nested block markers to the new section index", () => {
    hostWithBlocks(2, 2);
    moveSectionElement(0, 1); // section 0 (S0*) moves to index 1
    expect(markerOfBlockText("S0B0")).toBe("1.blocks.0");
    expect(markerOfBlockText("S0B1")).toBe("1.blocks.1");
    expect(sfieldOfBlockText("S0B0")).toBe("1.blocks.0.heading");
    // The section that moved up to index 0 gets its blocks re-stamped too.
    expect(markerOfBlockText("S1B0")).toBe("0.blocks.0");
  });

  it("out-of-range block ops are no-ops", () => {
    hostWithBlocks(1, 2);
    moveBlockElement(0, 0, 5);
    moveBlockElement(0, -1, 0);
    deleteBlockElement(0, 9);
    deleteBlockElement(5, 0);
    expect([...document.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)].map(blockText)).toEqual([
      "S0B0",
      "S0B1",
    ]);
  });
});
