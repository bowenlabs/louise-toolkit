// The generic on-canvas chrome (ADR 0010).
//
// The property under test is that the chrome has NO per-kind knowledge: given a
// descriptor it draws the matching ring and buttons, and given a nesting it lights
// the deepest node — without anything in it knowing what a section, block, or link
// is. Every case below drives it purely through `resolve`.
//
// It also pins the defect that motivated the model: a container with zero children
// must offer a way to add the first one. Pre-0010 the `+` lived only on a child's
// own toolbar, so an empty block-capable section was a dead end.

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNodePath, type NodeDescriptor, type NodePath } from "../../src/client/node.js";
import { mountNodeChrome } from "../../src/client/node-chrome.js";

const noopActions = {
  onMove: () => {},
  onDelete: () => {},
  onAddSibling: () => {},
  onAddChild: () => {},
  onInspect: () => {},
};

/** section 0 → block 1 → the block's href field. */
function tree(): { section: HTMLElement; block: HTMLElement; field: HTMLElement } {
  const section = document.createElement("div");
  section.setAttribute("data-louise-node", "0");
  const block = document.createElement("div");
  block.setAttribute("data-louise-node", "0.blocks.1");
  const field = document.createElement("a");
  field.setAttribute("data-louise-node", "0.blocks.1.href");
  field.textContent = "Shop";
  block.appendChild(field);
  section.appendChild(block);
  document.body.appendChild(section);
  return { section, block, field };
}

/** A resolve that mirrors today's three kinds, chosen purely by path shape — the
 *  editor's job, which is exactly the point. */
const resolveLikeToday = (path: NodePath): NodeDescriptor | null => {
  const s = formatNodePath(path);
  if (s === "0") {
    return {
      ordered: { index: 0, count: 3 },
      children: { count: 1 },
      fields: true,
      tone: "section",
      label: "Hero",
    };
  }
  if (s === "0.blocks.1") {
    // Mid-list on purpose, so both move buttons are enabled here; the end-of-list
    // disabling is pinned by its own case below.
    return { ordered: { index: 1, count: 3 }, fields: true, tone: "block", label: "block" };
  }
  if (s === "0.blocks.1.href") return { fields: true, tone: "value", label: "link" };
  return null;
};

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const toolbar = () => document.querySelector<HTMLElement>(".louise-chrome-toolbar");
const shownButtons = () =>
  [...(toolbar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .filter((b) => b.style.display !== "none")
    .map((b) => b.getAttribute("aria-label"));
const ringed = () => document.querySelector("[data-louise-node].louise-node-active");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.restoreAllMocks();
});

describe("mountNodeChrome — deepest wins, with no per-kind knowledge", () => {
  it("lights the deepest node and suppresses its ancestors", () => {
    const { section, block, field } = tree();
    dispose = mountNodeChrome({ ...noopActions, resolve: resolveLikeToday });

    over(field);
    expect(ringed()).toBe(field);
    expect(section.classList.contains("louise-node-active")).toBe(false);
    expect(block.classList.contains("louise-node-active")).toBe(false);
  });

  it("falls back outward as the pointer leaves the deeper node", () => {
    const { section, block, field } = tree();
    dispose = mountNodeChrome({ ...noopActions, resolve: resolveLikeToday });

    over(field);
    over(block);
    expect(ringed()).toBe(block);
    over(section);
    expect(ringed()).toBe(section);
    // Exactly one at a time — the old chrome needed 24 hand-written cross-clears
    // to hold this invariant; here it is a single assignment.
    expect(document.querySelectorAll(".louise-node-active")).toHaveLength(1);
  });

  it("treats a node the editor doesn't recognise as unmarked", () => {
    const { field } = tree();
    dispose = mountNodeChrome({ ...noopActions, resolve: () => null });

    over(field);
    expect(ringed()).toBeNull();
    expect(toolbar()?.dataset.open).toBe("0");
  });
});

describe("mountNodeChrome — the toolbar is a function of capabilities", () => {
  it("gives an ordered container move/delete/add and a wrench", () => {
    const { section } = tree();
    dispose = mountNodeChrome({ ...noopActions, resolve: resolveLikeToday });

    over(section);
    expect(shownButtons()).toEqual([
      "Move up",
      "Move down",
      "Delete Hero",
      "Add Hero after",
      "Layout & settings",
    ]);
  });

  it("gives a fields-only node a wrench and nothing else", () => {
    const { field } = tree();
    dispose = mountNodeChrome({ ...noopActions, resolve: resolveLikeToday });

    over(field);
    // The pre-0010 link layer hand-built a separate wrench-only toolbar to get
    // this. Here it is the absence of `ordered` and `children`.
    expect(shownButtons()).toEqual(["Layout & settings"]);
  });

  it("disables move at the ends of the list", () => {
    const el = document.createElement("div");
    el.setAttribute("data-louise-node", "0");
    document.body.appendChild(el);
    dispose = mountNodeChrome({
      ...noopActions,
      resolve: () => ({ ordered: { index: 0, count: 1 }, tone: "section" }),
    });

    over(el);
    const [up, down] = [...(toolbar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });

  it("draws the tone the editor asked for, on both ring and bar", () => {
    const { field, section } = tree();
    dispose = mountNodeChrome({ ...noopActions, resolve: resolveLikeToday });

    over(section);
    expect(section.getAttribute("data-louise-tone")).toBe("section");
    expect(toolbar()?.getAttribute("data-louise-tone")).toBe("section");

    over(field);
    expect(field.getAttribute("data-louise-tone")).toBe("value");
    // The bar re-tones with the node — the defect that shipped in 0.20.0 was a
    // link bar stuck on the section palette.
    expect(toolbar()?.getAttribute("data-louise-tone")).toBe("value");
  });
});

describe("mountNodeChrome — the empty-container affordance", () => {
  const emptyContainer = () => {
    const el = document.createElement("div");
    el.setAttribute("data-louise-node", "1");
    document.body.appendChild(el);
    return el;
  };

  it("offers an add-first button when a container has no children", () => {
    const el = emptyContainer();
    dispose = mountNodeChrome({
      ...noopActions,
      resolve: () => ({
        ordered: { index: 1, count: 2 },
        children: { count: 0, label: "block" },
        tone: "section",
        label: "block",
      }),
    });

    over(el);
    // Without this a freshly added block-capable section is a dead end: no child
    // exists to hover, so no `+` is reachable anywhere.
    expect(shownButtons()).toContain("Add the first block");
  });

  it("hides it once the container has children, so there is never a second +", () => {
    const el = emptyContainer();
    dispose = mountNodeChrome({
      ...noopActions,
      resolve: () => ({
        ordered: { index: 1, count: 2 },
        children: { count: 2, label: "block" },
        tone: "section",
        label: "block",
      }),
    });

    over(el);
    expect(shownButtons()).not.toContain("Add the first block");
    expect(shownButtons()).toContain("Add block after");
  });

  it("calls onAddChild, distinct from onAddSibling", () => {
    const el = emptyContainer();
    const calls: string[] = [];
    dispose = mountNodeChrome({
      ...noopActions,
      onAddChild: (p) => calls.push(`child:${formatNodePath(p)}`),
      onAddSibling: (p) => calls.push(`sibling:${formatNodePath(p)}`),
      resolve: () => ({
        ordered: { index: 1, count: 2 },
        children: { count: 0, label: "block" },
        label: "block",
      }),
    });

    over(el);
    const btns = [...(toolbar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
    btns.find((b) => b.getAttribute("aria-label") === "Add the first block")?.click();
    btns.find((b) => b.getAttribute("aria-label") === "Add block after")?.click();

    expect(calls).toEqual(["child:1", "sibling:1"]);
  });

  // Live QA on the deployed site, 2026-07-28. An empty ORDERED container shows
  // both adds at once — its own list gets a sibling `+`, its children's list gets
  // a child `+` — and they rendered as two identical glyphs, side by side,
  // separable only by tooltip. Callbacks being distinct (above) says nothing about
  // what an editor can see.
  it("draws the two adds with different glyphs, not two identical pluses", () => {
    const el = emptyContainer();
    dispose = mountNodeChrome({
      ...noopActions,
      resolve: () => ({
        ordered: { index: 1, count: 2 },
        children: { count: 0, label: "block" },
        label: "block",
      }),
    });

    over(el);
    const btns = [...(toolbar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
    const byName = (n: string) => btns.find((b) => b.getAttribute("aria-label") === n);
    const sibling = byName("Add block after");
    const child = byName("Add the first block");

    // Both on screen at once...
    expect(sibling?.style.display).not.toBe("none");
    expect(child?.style.display).not.toBe("none");
    // ...so they must not look the same.
    expect(child?.innerHTML).not.toBe(sibling?.innerHTML);
  });

  // The child button names what goes IN. `desc.label` names the container, which
  // is right for "Add <container> after" one button along and wrong here: live QA
  // read "Add the first Hero" on a hero whose children are CTAs.
  it("names the child add after the CHILD, not the container", () => {
    const el = emptyContainer();
    dispose = mountNodeChrome({
      ...noopActions,
      resolve: () => ({
        ordered: { index: 1, count: 2 },
        children: { count: 0, label: "CTA" },
        label: "Hero",
      }),
    });

    over(el);
    expect(shownButtons()).toContain("Add the first CTA");
    expect(shownButtons()).toContain("Add Hero after");
    expect(shownButtons()).not.toContain("Add the first Hero");
  });

  it("stays neutral when the container has no single kind of child", () => {
    const el = emptyContainer();
    dispose = mountNodeChrome({
      ...noopActions,
      resolve: () => ({ ordered: { index: 1, count: 2 }, children: { count: 0 }, label: "Hero" }),
    });

    over(el);
    // Better a vague name than a wrong one — the editor is about to be asked
    // which type anyway.
    expect(shownButtons()).toContain("Add the first one");
  });
});

describe("mountNodeChrome — actions carry the path", () => {
  it("passes the active node's path to every action", () => {
    const { block } = tree();
    const seen: string[] = [];
    dispose = mountNodeChrome({
      resolve: resolveLikeToday,
      onMove: (p, d) => seen.push(`move${d}:${formatNodePath(p)}`),
      onDelete: (p) => seen.push(`del:${formatNodePath(p)}`),
      onAddSibling: (p) => seen.push(`add:${formatNodePath(p)}`),
      onAddChild: () => {},
      onInspect: (p) => seen.push(`inspect:${formatNodePath(p)}`),
    });

    over(block);
    const byLabel = (l: string) =>
      [...(toolbar()?.querySelectorAll("button") ?? [])].find(
        (b) => b.getAttribute("aria-label") === l,
      ) as HTMLButtonElement;
    byLabel("Move up").click();
    byLabel("Move down").click();
    byLabel("Delete block").click();
    byLabel("Add block after").click();
    byLabel("Layout & settings").click();

    // Paths, not indices — nothing here needs re-deriving after a re-stamp.
    expect(seen).toEqual([
      "move-1:0.blocks.1",
      "move1:0.blocks.1",
      "del:0.blocks.1",
      "add:0.blocks.1",
      "inspect:0.blocks.1",
    ]);
  });

  it("removes its toolbar, styles and keyboard affordances on dispose", () => {
    const { section } = tree();
    const off = mountNodeChrome({ ...noopActions, resolve: resolveLikeToday });
    expect(section.getAttribute("tabindex")).toBe("0");

    off();
    expect(toolbar()).toBeNull();
    expect(document.getElementById("louise-chrome-style")).toBeNull();
    expect(section.hasAttribute("tabindex")).toBe(false);
  });
});
