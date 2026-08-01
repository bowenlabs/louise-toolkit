// Edit mode's navigation guard, and the two ways it can be wrong.
//
// The guard exists so a stray click can't lose an edit session: clicking a CTA
// you are editing should edit its label, not leave the page. It used to block
// EVERY `a[href]` outside the editor's own chrome — which also blocked the
// site's header nav, footer, brand mark and skip link, so an editor could not
// reach another page at all without first leaving edit mode. That is the worse
// failure of the two: a lost edit is recoverable, an unreachable page is not.
//
// So both directions matter, and both are pinned here:
//   too little → a click inside the region being edited navigates away
//   too much   → the editor is stranded on one page
import { describe, expect, it } from "vitest";
import { isEditableSurfaceLink } from "../../src/client/index.js";

/** Build a detached tree and return the element to "click". */
function clickTarget(html: string, selector: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  const el = host.querySelector(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el;
}

describe("links INSIDE an editing surface stay inert", () => {
  it("a marked node's own link", () => {
    const el = clickTarget(`<a href="/work" data-louise-node="0.ctaLabel">Work</a>`, "a");
    expect(isEditableSurfaceLink(el)).toBe(true);
  });

  it("a link nested inside a marked node", () => {
    const el = clickTarget(
      `<div data-louise-node="0.body"><p><a href="/x" id="t">inline</a></p></div>`,
      "#t",
    );
    expect(isEditableSurfaceLink(el)).toBe(true);
  });

  it("a click on a child of an editable link (the icon inside a CTA)", () => {
    const el = clickTarget(
      `<a href="/x" data-louise-node="1.ctaLabel"><span id="t">Go</span></a>`,
      "#t",
    );
    expect(isEditableSurfaceLink(el)).toBe(true);
  });

  it("any link inside the sections host", () => {
    const el = clickTarget(
      `<div data-louise-sections="7"><section><a href="/work" id="t">Tile</a></section></div>`,
      "#t",
    );
    expect(isEditableSurfaceLink(el)).toBe(true);
  });

  it("a link inside a legacy inline field", () => {
    const el = clickTarget(
      `<div data-louise-field="settings:1:body"><a href="/x" id="t">link</a></div>`,
      "#t",
    );
    expect(isEditableSurfaceLink(el)).toBe(true);
  });
});

describe("site chrome must keep navigating — the regression this fixes", () => {
  it("header nav", () => {
    const el = clickTarget(`<nav class="site-nav"><a href="/work" id="t">Work</a></nav>`, "#t");
    expect(isEditableSurfaceLink(el)).toBe(false);
  });

  it("the brand mark", () => {
    const el = clickTarget(`<header><a href="/" id="t">Brand</a></header>`, "#t");
    expect(isEditableSurfaceLink(el)).toBe(false);
  });

  it("footer links", () => {
    const el = clickTarget(`<footer><a href="/shop" id="t">Shop</a></footer>`, "#t");
    expect(isEditableSurfaceLink(el)).toBe(false);
  });

  it("the skip link — an accessibility affordance, never page content", () => {
    const el = clickTarget(`<a href="#main" class="skip" id="t">Skip to content</a>`, "#t");
    expect(isEditableSurfaceLink(el)).toBe(false);
  });

  it("a marked node that is NOT a link leaves neighbouring chrome alone", () => {
    // The footer carries `settings.footerBlurb` markers (shared values); the
    // footer's LINKS are still chrome and must navigate.
    const el = clickTarget(
      `<footer><p data-louise-node="settings.footerBlurb">blurb</p><a href="/about" id="t">About</a></footer>`,
      "#t",
    );
    expect(isEditableSurfaceLink(el)).toBe(false);
  });
});

describe("non-link clicks", () => {
  it("a bare element is never blocked", () => {
    const el = clickTarget(`<div data-louise-node="0.heading" id="t">Heading</div>`, "#t");
    expect(isEditableSurfaceLink(el)).toBe(false);
  });

  it("a null target is safe", () => {
    expect(isEditableSurfaceLink(null)).toBe(false);
  });
});
