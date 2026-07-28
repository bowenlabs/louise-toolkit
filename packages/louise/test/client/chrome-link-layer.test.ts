// The link chrome layer (coracle.coffee#38).
//
// A CTA is the third marked layer, and it nests INSIDE the other two — an <a> in
// a block in a section. So the load-bearing property is ordering: hovering a link
// must light the link and suppress both the block and the section around it, or
// two rings show at once and the wrench you click belongs to the wrong thing.
//
// The link layer is wrench-only on purpose: position and existence belong to the
// container, so move/delete here would either duplicate the block's buttons or
// imply a CTA can be reordered independently of the copy around it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { type LinkRef, mountSectionChrome, parseLinkMarker } from "../../src/client/chrome.js";

const noop = () => {};
const baseActions = { onMoveUp: noop, onMoveDown: noop, onDelete: noop };

/** A section containing a block, which contains a marked CTA — the full nesting. */
function page(): { section: HTMLElement; block: HTMLElement; link: HTMLElement } {
  const section = document.createElement("div");
  section.setAttribute("data-louise-section", "0");
  const block = document.createElement("div");
  block.setAttribute("data-louise-block", "0.blocks.1");
  const link = document.createElement("a");
  link.setAttribute("data-louise-link", "0.blocks.1.href");
  link.textContent = "Shop";
  block.appendChild(link);
  section.appendChild(block);
  document.body.appendChild(section);
  return { section, block, link };
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const linkToolbar = () => document.querySelector(".louise-link-toolbar");
const ringed = (el: Element, cls: string) => el.classList.contains(cls);

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.restoreAllMocks();
});

describe("parseLinkMarker", () => {
  it("parses a section-level CTA", () => {
    expect(parseLinkMarker("2.ctaHref")).toEqual({ section: 2, key: "ctaHref" });
  });

  it("parses a CTA inside a block", () => {
    expect(parseLinkMarker("0.blocks.3.href")).toEqual({ section: 0, block: 3, key: "href" });
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["no key", "0"],
    ["a bare block marker", "0.blocks.1"],
    ["a non-numeric section", "x.ctaHref"],
    ["a negative index", "-1.ctaHref"],
    ["an empty key", "0."],
    ["an unknown middle segment", "0.items.1.href"],
  ])("rejects %s", (_label, value) => {
    expect(parseLinkMarker(value)).toBeNull();
  });
});

describe("mountSectionChrome — link layer", () => {
  it("lights the link and suppresses the block and section around it", () => {
    const { section, block, link } = page();
    dispose = mountSectionChrome({
      ...baseActions,
      blocks: baseActions,
      links: { onInspect: noop },
    });

    over(link);

    expect(ringed(link, "louise-link-active")).toBe(true);
    // Exactly one layer active — otherwise two rings show and the wrench is ambiguous.
    expect(ringed(block, "louise-block-active")).toBe(false);
    expect(ringed(section, "louise-chrome-active")).toBe(false);
  });

  it("falls back to the block when hovering the block outside its link", () => {
    const { section, block, link } = page();
    dispose = mountSectionChrome({
      ...baseActions,
      blocks: baseActions,
      links: { onInspect: noop },
    });

    over(block);

    expect(ringed(block, "louise-block-active")).toBe(true);
    expect(ringed(link, "louise-link-active")).toBe(false);
    expect(ringed(section, "louise-chrome-active")).toBe(false);
  });

  it("clears the link ring when moving from the link out to the section", () => {
    const { section, link } = page();
    dispose = mountSectionChrome({
      ...baseActions,
      blocks: baseActions,
      links: { onInspect: noop },
    });

    over(link);
    expect(ringed(link, "louise-link-active")).toBe(true);
    over(section);

    expect(ringed(link, "louise-link-active")).toBe(false);
    expect(ringed(section, "louise-chrome-active")).toBe(true);
  });

  it("offers a wrench and nothing else — no move, no delete", () => {
    page();
    dispose = mountSectionChrome({
      ...baseActions,
      blocks: baseActions,
      links: { onInspect: noop },
    });

    const labels = [...(linkToolbar()?.querySelectorAll("button") ?? [])].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Link destination"]);
  });

  it("passes the parsed ref to onInspect", () => {
    const { link } = page();
    const seen: LinkRef[] = [];
    dispose = mountSectionChrome({
      ...baseActions,
      blocks: baseActions,
      links: { onInspect: (r) => seen.push(r) },
    });

    over(link);
    linkToolbar()
      ?.querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(seen).toEqual([{ section: 0, block: 1, key: "href" }]);
  });

  it("resolves a section-level CTA to its section, with no block", () => {
    const section = document.createElement("div");
    section.setAttribute("data-louise-section", "3");
    const link = document.createElement("a");
    link.setAttribute("data-louise-link", "3.ctaHref");
    section.appendChild(link);
    document.body.appendChild(section);

    const seen: LinkRef[] = [];
    dispose = mountSectionChrome({ ...baseActions, links: { onInspect: (r) => seen.push(r) } });

    over(link);
    linkToolbar()
      ?.querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(seen).toEqual([{ section: 3, key: "ctaHref" }]);
  });

  it("skips a malformed marker rather than crashing the chrome", () => {
    const section = document.createElement("div");
    section.setAttribute("data-louise-section", "0");
    const link = document.createElement("a");
    link.setAttribute("data-louise-link", "not-a-marker");
    section.appendChild(link);
    document.body.appendChild(section);

    dispose = mountSectionChrome({ ...baseActions, links: { onInspect: noop } });
    over(link);

    // No link ring, and the enclosing section is NOT lit either: `closest` matched
    // the malformed link element, so the hover resolves to nothing rather than
    // silently falling through to the section.
    expect(ringed(link, "louise-link-active")).toBe(false);
  });

  it("mounts no link toolbar at all when the layer isn't wired", () => {
    page();
    dispose = mountSectionChrome({ ...baseActions, blocks: baseActions });

    expect(linkToolbar()).toBeNull();
  });

  it("removes the link toolbar on dispose", () => {
    page();
    const off = mountSectionChrome({ ...baseActions, links: { onInspect: noop } });
    expect(linkToolbar()).not.toBeNull();

    off();
    expect(linkToolbar()).toBeNull();
  });
});
