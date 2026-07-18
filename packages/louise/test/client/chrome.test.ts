// happy-dom coverage for the on-canvas chrome marker contract (#182 Phase 1):
// the render stamps `data-louise-section="<i>"` per section; the chrome resolves
// those markers to elements (ordered by index) and hit-tests a node to its
// nearest enclosing section.

import { afterEach, describe, expect, it } from "vitest";
import {
  readSectionMarkers,
  SECTION_MARKER_ATTR,
  sectionIndexOf,
} from "../../src/client/chrome.js";

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
