// Behavior coverage for the on-canvas chrome's keyboard path in
// src/client/node-chrome.ts (#695): Enter into the toolbar, roving and Escape
// inside it, Alt+Arrow moves with their announcement, Delete with refocus, and
// the hover and focus edges.

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNodePath, type NodeDescriptor, type NodePath } from "../../src/client/node.js";
import { mountNodeChrome } from "../../src/client/node-chrome.js";

/** Three sections, each ordered, plus a value node inside the first. */
function page(): HTMLElement[] {
  return ["Hero", "Quote", "Footer"].map((name, i) => {
    const el = document.createElement("div");
    el.setAttribute("data-louise-node", String(i));
    el.textContent = name;
    if (i === 0) {
      const link = document.createElement("span");
      link.setAttribute("data-louise-node", "0.href");
      link.textContent = "Shop";
      el.appendChild(link);
    }
    document.body.appendChild(el);
    return el;
  });
}

const LABELS = ["Hero", "Quote", "Footer"];
const resolve = (path: NodePath): NodeDescriptor | null => {
  const s = formatNodePath(path);
  if (s === "0.href") return { fields: true, tone: "value", label: "Link" };
  const i = Number(s);
  if (!Number.isInteger(i) || i < 0 || i > 2) return null;
  return { ordered: { index: i, count: 3 }, fields: true, tone: "section", label: LABELS[i] };
};

const actions = () => ({
  resolve,
  onMove: vi.fn<(path: NodePath, delta: -1 | 1) => void>(),
  onDelete: vi.fn<(path: NodePath) => void>(),
  onAddSibling: vi.fn<(path: NodePath) => void>(),
  onAddChild: vi.fn<(path: NodePath) => void>(),
  onInspect: vi.fn<(path: NodePath) => void>(),
});

const press = (el: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const focusNode = (el: HTMLElement) => {
  el.focus();
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
};
const toolbar = () => document.querySelector<HTMLElement>(".louise-chrome-toolbar") as HTMLElement;
const shown = () =>
  [...toolbar().querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.style.display !== "none" && !b.disabled,
  );
const announcer = () => document.querySelector(".louise-sr-only[role='status']")?.textContent;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.restoreAllMocks();
});

describe("mountNodeChrome—keyboard", () => {
  it("moves into the toolbar on Enter or F2, roves with the arrows, and steps back on Escape", () => {
    const [hero] = page();
    dispose = mountNodeChrome(actions());
    focusNode(hero);
    expect(toolbar().dataset.open).toBe("1");

    expect(press(hero, "Enter").defaultPrevented).toBe(true);
    const buttons = shown();
    expect(document.activeElement).toBe(buttons[0]);

    press(buttons[0], "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    press(buttons[1], "ArrowLeft");
    expect(document.activeElement).toBe(buttons[0]);
    press(buttons[0], "ArrowLeft");
    expect(document.activeElement).toBe(buttons.at(-1));

    // Another key inside the toolbar is left to the button.
    expect(press(buttons[0], "a").defaultPrevented).toBe(false);

    press(buttons[0], "Escape");
    expect(document.activeElement).toBe(hero);

    press(hero, "F2");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("moves an ordered node with Alt+Arrow and announces where it landed", () => {
    const [, quote] = page();
    const acts = actions();
    dispose = mountNodeChrome(acts);
    focusNode(quote);

    press(quote, "ArrowUp", { altKey: true });
    expect(acts.onMove).toHaveBeenLastCalledWith([1], -1);
    expect(announcer()).toBe("Quote moved to position 2 of 3");

    press(quote, "ArrowDown", { altKey: true });
    expect(acts.onMove).toHaveBeenLastCalledWith([1], 1);
  });

  it("doesn't move past either end", () => {
    const [hero] = page();
    const acts = actions();
    dispose = mountNodeChrome(acts);
    focusNode(hero);

    press(hero, "ArrowUp", { altKey: true });
    expect(acts.onMove).not.toHaveBeenCalled();
  });

  it("clears the ring when a move takes the node off the page", () => {
    const [hero] = page();
    const acts = actions();
    acts.onMove.mockImplementation(() => hero.remove());
    dispose = mountNodeChrome(acts);
    focusNode(hero);

    press(hero, "ArrowDown", { altKey: true });
    expect(toolbar().dataset.open).toBe("0");
  });

  it("deletes with Delete or Backspace and moves focus to the node now in that place", () => {
    const [hero, quote, footer] = page();
    const acts = actions();
    acts.onDelete.mockImplementation((path) => {
      document.querySelector(`body > [data-louise-node="${String(path[0])}"]`)?.remove();
      // Re-stamp what's left, the way the editor does.
      [...document.querySelectorAll<HTMLElement>("body > [data-louise-node]")].forEach((el, j) =>
        el.setAttribute("data-louise-node", String(j)),
      );
    });
    dispose = mountNodeChrome(acts);

    focusNode(quote);
    press(quote, "Delete");
    expect(acts.onDelete).toHaveBeenCalledWith([1]);
    expect(document.activeElement).toBe(footer);

    focusNode(footer);
    press(footer, "Backspace");
    expect(document.activeElement).toBe(hero);
  });

  it("ignores move and delete keys on a node with no position, and keys on an inactive node", () => {
    const [hero, quote] = page();
    const acts = actions();
    dispose = mountNodeChrome(acts);
    const link = hero.querySelector("span") as HTMLElement;

    focusNode(link);
    expect(press(link, "Delete").defaultPrevented).toBe(false);
    expect(press(quote, "Delete").defaultPrevented).toBe(false);
    expect(acts.onDelete).not.toHaveBeenCalled();

    // A key or focus with no element target is ignored.
    expect(press(document, "Delete").defaultPrevented).toBe(false);
    document.dispatchEvent(new FocusEvent("focusin"));
    expect(toolbar().dataset.open).toBe("1");
  });
});

describe("mountNodeChrome—hover and focus edges", () => {
  it("keeps the node active while the pointer or focus is on the toolbar", () => {
    const [hero] = page();
    dispose = mountNodeChrome(actions());
    hero.dispatchEvent(new Event("mouseover", { bubbles: true }));
    const button = shown()[0];

    button.dispatchEvent(new Event("mouseover", { bubbles: true }));
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(hero.classList.contains("louise-node-active")).toBe(true);
  });

  it("clears when focus lands outside every node", () => {
    const [hero] = page();
    const other = document.createElement("button");
    document.body.appendChild(other);
    dispose = mountNodeChrome(actions());
    focusNode(hero);

    other.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(toolbar().dataset.open).toBe("0");
    expect(hero.classList.contains("louise-node-active")).toBe(false);
  });

  it("lights a node from a hovered text node", () => {
    const [, quote] = page();
    dispose = mountNodeChrome(actions());
    (quote.firstChild as Text).dispatchEvent(new Event("mouseover", { bubbles: true }));
    expect(quote.classList.contains("louise-node-active")).toBe(true);
  });

  it("warns once about a marker with no box", () => {
    const [hero, quote] = page();
    hero.style.display = "contents";
    quote.style.display = "contents";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispose = mountNodeChrome(actions());

    hero.dispatchEvent(new Event("mouseover", { bubbles: true }));
    quote.dispatchEvent(new Event("mouseover", { bubbles: true }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("display: contents");
  });

  it("injects its stylesheet once when mounted twice, and prepares a marked root", () => {
    page();
    dispose = mountNodeChrome(actions());
    const second = mountNodeChrome(actions());
    expect(document.querySelectorAll("#louise-chrome-style")).toHaveLength(1);

    const added = document.createElement("div");
    added.setAttribute("data-louise-node", "2");
    second.prepare(added);
    expect(added.tabIndex).toBe(0);
    expect(added.getAttribute("aria-label")).toBe(
      document.querySelector('[data-louise-node="2"]')?.getAttribute("aria-label"),
    );
    second();
  });
});
