// happy-dom coverage for the on-canvas chrome marker contract (#182 Phase 1):
// the render stamps `data-louise-section="<i>"` per section; the chrome resolves
// those markers to elements (ordered by index) and hit-tests a node to its
// nearest enclosing section.

import { afterEach, describe, expect, it } from "vitest";
import {
  deleteSectionElement,
  moveSectionElement,
  mountSectionChrome,
  readSectionMarkers,
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
});
