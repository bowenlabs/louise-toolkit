// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The on-canvas chrome, rebuilt on the editable-node model (ADR 0010).
//
// One ring, one toolbar, one keyboard path — for every kind of node. What the
// chrome draws is entirely a function of the {@link NodeDescriptor} the editor
// returns from `resolve`:
//
//   ordered   → ↑ ↓ ✕ and a sibling +      (it has a position in a list)
//   children  → a child + when it is EMPTY (no child exists to hover)
//   fields    → a wrench                   (it has an inspector)
//   tone      → which palette to draw      (the editor's call, not ours)
//
// The chrome cannot tell a section from a block from a link, and never asks. That
// is the point: the pre-0010 version hardcoded three layers with three attributes
// and 24 hand-written cross-clear calls, and every new kind of node cost another
// arm in a hit-test ladder plus another O(n) of suppression. Here a new kind of
// node — a shared value, an external source (Phase B) — is a change in the
// EDITOR's resolve, and nothing here moves.

import {
  NODE_MARKER_ATTR,
  parseNodePath,
  type NodeDescriptor,
  type NodePath,
  readNodeMarkers,
  type ResolveNode,
  samePath,
} from "./node.js";

// Toolbar glyphs — phosphor SVGs (currentColor → monochrome), not unicode/emoji,
// so they render consistently everywhere.
import arrowUp from "@phosphor-icons/core/assets/regular/arrow-up.svg?raw";
import arrowDown from "@phosphor-icons/core/assets/regular/arrow-down.svg?raw";
import plusIcon from "@phosphor-icons/core/assets/regular/plus.svg?raw";
// Deliberately NOT a second bare plus. An empty ordered container shows both add
// buttons at once — one for a sibling, one for its first child — and live QA on
// 2026-07-28 found them rendering as two identical `+` glyphs side by side,
// distinguishable only by tooltip. `list-plus` reads as "put an item in this
// list", which is exactly what the child add does.
import listPlus from "@phosphor-icons/core/assets/regular/list-plus.svg?raw";
import xIcon from "@phosphor-icons/core/assets/regular/x.svg?raw";
import wrench from "@phosphor-icons/core/assets/regular/wrench.svg?raw";

/** What the chrome can do to a node. Every callback receives the node's path —
 *  the chrome holds no indices of its own, so nothing here needs re-deriving
 *  after a re-stamp. */
export interface NodeChromeActions {
  /** Resolve a path to what that node can do. Return `null` for a path the editor
   *  doesn't recognise — the chrome then treats the element as unmarked. */
  resolve: ResolveNode;
  /** Reorder within the parent list. Only reachable for an `ordered` node. */
  onMove: (path: NodePath, delta: -1 | 1) => void;
  /** Remove from the parent list. Only reachable for an `ordered` node. */
  onDelete: (path: NodePath) => void;
  /** Add a sibling next to this node. Only reachable for an `ordered` node. */
  onAddSibling: (path: NodePath) => void;
  /** Add the FIRST child of an empty container — the affordance that did not
   *  exist before 0010, which made a freshly added block-capable section a dead
   *  end (no child to hover, so no `+` anywhere). */
  onAddChild: (path: NodePath) => void;
  /** Open this node's inspector. Only reachable when `fields` is set. */
  onInspect: (path: NodePath) => void;
}

/** Every marked node. One selector, built once — the outward walk uses it per
 *  step, and per-hover string concatenation is not free on a big page. */
const SELECTOR = `[${NODE_MARKER_ATTR}]`;

const CHROME_STYLE_ID = "louise-chrome-style";
const CHROME_KEYSHORTCUTS = "Enter Alt+ArrowUp Alt+ArrowDown Delete";

/** Ring + toolbar palettes, keyed by {@link NodeDescriptor.tone}.
 *
 *  Toolbar backgrounds are one stop darker than their ring: the bar carries white
 *  glyphs, which need 4.5:1 (WCAG 1.4.3), while the ring is a non-text graphic and
 *  stays on brand at 3:1. Each `--*-strong` below is measured against white.
 *  (Pre-0010 the link layer had no background rule at all and its bar rendered
 *  orange — a defect that could only happen because each layer hand-built its own
 *  chrome.)
 *
 *  The Phase B tones (`shared` green, `external` yellow — ADR 0010) each use ONE
 *  value for both roles: `#15803d` is 5.02:1 and `#a16207` is 4.92:1 against
 *  white, so both clear the toolbar's 4.5:1 without a darker variant. Yellow is
 *  deliberately NOT `--louise-yellow` (`#ca8a04`): that value is 2.94:1 — it
 *  fails the ring's 3:1 as well as the bar's 4.5:1 — and the token is already
 *  loaded with save/publish semantics. Same reasoning gives `shared` its own
 *  token rather than `--louise-green`.
 *
 *  The base rules carry a slate fallback so a tone this palette doesn't know
 *  degrades to a visible neutral ring and a legible bar (slate-500 4.76:1 /
 *  slate-600 7.0:1) — without it, an unhandled tone rendered NO ring and white
 *  glyphs on transparent, which reads as a resolver bug and sends you debugging
 *  the wrong file. */
const TONE_CSS = `
[${NODE_MARKER_ATTR}].louise-node-active {
  border-radius: 4px;
  box-shadow: 0 0 0 2px #64748b;
}
[${NODE_MARKER_ATTR}].louise-node-active[data-louise-tone="section"] {
  box-shadow: 0 0 0 2px var(--louise-orange, #ea7317);
}
[${NODE_MARKER_ATTR}].louise-node-active[data-louise-tone="block"] {
  box-shadow: 0 0 0 2px var(--louise-blue, #1481ef);
}
[${NODE_MARKER_ATTR}].louise-node-active[data-louise-tone="value"] {
  box-shadow: 0 0 0 2px var(--louise-violet, #7c3aed);
}
[${NODE_MARKER_ATTR}].louise-node-active[data-louise-tone="shared"] {
  box-shadow: 0 0 0 2px var(--louise-shared, #15803d);
}
[${NODE_MARKER_ATTR}].louise-node-active[data-louise-tone="external"] {
  box-shadow: 0 0 0 2px var(--louise-external, #a16207);
}
.louise-chrome-toolbar { background: #475569; }
.louise-chrome-toolbar[data-louise-tone="section"] { background: var(--louise-orange-strong, #b45309); }
.louise-chrome-toolbar[data-louise-tone="block"] { background: var(--louise-blue-strong, #0f6ecd); }
.louise-chrome-toolbar[data-louise-tone="value"] { background: var(--louise-violet-strong, #6d28d9); }
.louise-chrome-toolbar[data-louise-tone="shared"] { background: var(--louise-shared, #15803d); }
.louise-chrome-toolbar[data-louise-tone="external"] { background: var(--louise-external, #a16207); }
`;

const CHROME_CSS = `
${TONE_CSS}
.louise-chrome-toolbar {
  position: fixed;
  z-index: 2147483200;
  display: none;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.28);
}
.louise-chrome-toolbar[data-open="1"] { display: inline-flex; }
.louise-chrome-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: #fff;
  cursor: pointer;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  padding: 0;
}
.louise-chrome-btn svg { width: 15px; height: 15px; }
.louise-chrome-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
.louise-chrome-btn:disabled { opacity: 0.4; cursor: default; }
[${NODE_MARKER_ATTR}][data-louise-kbd]:focus-visible {
  outline: 2px solid var(--louise-blue, #1481ef);
  outline-offset: 2px;
}
`;

function injectChromeStyle(doc: Document): void {
  if (doc.getElementById(CHROME_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = CHROME_STYLE_ID;
  style.textContent = CHROME_CSS;
  doc.head.appendChild(style);
}

/** Make a marked node a keyboard tab-stop so its toolbar is reachable without a
 *  mouse. Additive: never overwrites an author's own `tabindex`, and flags what it
 *  added with `data-louise-kbd` so the disposer removes exactly that. Idempotent. */
function makeChromeFocusable(el: HTMLElement): void {
  if (el.dataset.louiseKbd === "1" || el.hasAttribute("tabindex")) return;
  el.tabIndex = 0;
  el.setAttribute("aria-keyshortcuts", CHROME_KEYSHORTCUTS);
  el.dataset.louiseKbd = "1";
}

/** A marker rendered with `display: contents` generates NO box — the ring can't
 *  paint and the toolbar, measured from a zero rect, lands at the viewport origin.
 *  Silent and confusing, so name it once. The fix is on the SITE. */
let warnedBoxlessMarker = false;
function warnBoxlessMarker(el: HTMLElement): void {
  if (warnedBoxlessMarker || getComputedStyle(el).display !== "contents") return;
  warnedBoxlessMarker = true;
  console.warn(
    "[louise] An editable-node marker has `display: contents`, so it has no box — " +
      "the on-canvas ring can't paint and its toolbar mis-places to the viewport " +
      "origin. Give the marker a real box (remove `display: contents`).",
    el,
  );
}

/** Position the toolbar at the top-right of `el`, clamped to the viewport. */
function placeToolbar(toolbar: HTMLElement, el: HTMLElement): void {
  warnBoxlessMarker(el);
  // Open first: while `display:none` the toolbar has no measurable size.
  toolbar.dataset.open = "1";
  const box = el.getBoundingClientRect();
  const w = toolbar.offsetWidth;
  const h = toolbar.offsetHeight;
  toolbar.style.left = `${Math.min(Math.max(4, box.right - w), window.innerWidth - w - 4)}px`;
  toolbar.style.top = `${Math.min(Math.max(4, box.top + 6), window.innerHeight - h - 4)}px`;
}

/**
 * Mount the on-canvas chrome over every `data-louise-node` under the document.
 *
 * Hovering rings the tightest enclosing node and floats its toolbar; hit-testing
 * is deepest-boundary-wins, which is now simply what `closest()` does over a
 * single attribute rather than a hand-ordered ladder with manual cross-clearing.
 *
 * Returns a disposer that removes the listeners, the toolbar, the injected style,
 * and every keyboard affordance it added.
 */
export function mountNodeChrome(opts: NodeChromeActions, doc: Document = document): () => void {
  injectChromeStyle(doc);

  const button = (icon: string, title: string): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "louise-chrome-btn";
    b.innerHTML = icon; // phosphor SVG; give it a real accessible name too
    b.title = title;
    b.setAttribute("aria-label", title);
    return b;
  };

  const toolbar = doc.createElement("div");
  toolbar.className = "louise-chrome-toolbar";
  toolbar.dataset.open = "0";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-orientation", "horizontal");
  toolbar.setAttribute("aria-label", "Editor actions");

  // Built once and shown per capability, rather than one toolbar per layer.
  const up = button(arrowUp, "Move up");
  const down = button(arrowDown, "Move down");
  const del = button(xIcon, "Delete");
  const addSibling = button(plusIcon, "Add after");
  const addChild = button(listPlus, "Add the first one");
  const cog = button(wrench, "Layout & settings");
  for (const b of [up, down, del, addSibling, addChild, cog]) toolbar.appendChild(b);
  doc.body.appendChild(toolbar);

  let active: { path: NodePath; el: HTMLElement; desc: NodeDescriptor } | null = null;

  const clear = (): void => {
    active?.el.classList.remove("louise-node-active");
    active?.el.removeAttribute("data-louise-tone");
    active = null;
    toolbar.dataset.open = "0";
  };

  /** Show exactly the buttons this node's capabilities justify. */
  const applyCapabilities = (desc: NodeDescriptor): void => {
    const ordered = desc.ordered;
    for (const [b, on] of [
      [up, !!ordered],
      [down, !!ordered],
      [del, !!ordered],
      [addSibling, !!ordered],
      // Only when EMPTY: a container with children is added to via a child's own
      // sibling `+`, so showing it too would put two adds on the same bar for the
      // same list. (An empty ORDERED container still shows two — one for its own
      // list, one for its children's — which is why they carry different glyphs.)
      [addChild, !!desc.children && desc.children.count === 0],
      [cog, !!desc.fields],
    ] as const) {
      b.style.display = on ? "" : "none";
    }
    up.disabled = !ordered || ordered.index <= 0;
    down.disabled = !ordered || ordered.index >= ordered.count - 1;
    // Name the buttons after what they act on, so a screen reader says "Delete
    // Hero" rather than "Delete" six times down the page.
    const what = desc.label ?? "item";
    const name = (b: HTMLButtonElement, text: string): void => {
      b.title = text;
      b.setAttribute("aria-label", text);
    };
    name(del, `Delete ${what}`);
    name(addSibling, `Add ${what} after`);
    // "Layout & settings" describes a CONTAINER's panel. A value node has no
    // position and no children, so its wrench is the whole toolbar and opens a
    // single field — naming it "Layout & settings" describes neither what it
    // opens nor what it opens it on. Under A2 this is the common case, since
    // every non-inline field is now a node.
    const valueOnly = !ordered && !desc.children;
    name(cog, valueOnly && desc.label ? desc.label : "Layout & settings");
    // The CHILD's name, never the container's. `desc.label` describes this node,
    // so reusing it here produced "Add the first Hero" on a hero whose children
    // are CTAs — right next to "Add Hero after", which means something else
    // entirely. The editor supplies the child's name, or none when the container
    // takes several types and there is no singular answer to give.
    name(addChild, `Add the first ${desc.children?.label ?? "one"}`);
  };

  const activate = (path: NodePath, el: HTMLElement, desc: NodeDescriptor): void => {
    // One active node, so suppression is assignment — not a cross-clear per layer.
    if (active && active.el !== el) {
      active.el.classList.remove("louise-node-active");
      active.el.removeAttribute("data-louise-tone");
    }
    const tone = desc.tone ?? "section";
    active = { path, el, desc };
    el.classList.add("louise-node-active");
    el.setAttribute("data-louise-tone", tone);
    toolbar.setAttribute("data-louise-tone", tone);
    applyCapabilities(desc);
    placeToolbar(toolbar, el);
  };

  /**
   * Light the nearest node the editor has chrome for, walking OUTWARD past the
   * ones it doesn't (ADR 0010 A2).
   *
   * Under A1 an unresolved node meant "clear", which was correct while only
   * ring-worthy things carried a marker. Now the render marks everything editable,
   * so the tightest marker under the pointer is usually an inline field — a
   * heading, a CTA's label — which resolves to no chrome by design. Stopping
   * there would mean hovering a button's text clears the ring instead of ringing
   * the button, and the whole page would feel dead wherever text sits.
   *
   * Bounded by the DOM: each step is a `closest` from the parent, so it visits
   * each marked ancestor once and ends at the root.
   */
  const activateFrom = (target: Node | null): void => {
    let el = target instanceof Element ? target.closest<HTMLElement>(SELECTOR) : null;
    if (!el && target?.parentElement) el = target.parentElement.closest<HTMLElement>(SELECTOR);
    while (el) {
      const path = parseNodePath(el.getAttribute(NODE_MARKER_ATTR));
      const desc = path ? opts.resolve(path) : null;
      if (path && desc) return activate(path, el, desc);
      el = el.parentElement?.closest<HTMLElement>(SELECTOR) ?? null;
    }
    clear();
  };

  const onOver = (e: Event): void => {
    const target = e.target as Node | null;
    // Hovering the toolbar keeps its node active, so it doesn't flicker away.
    if (target && toolbar.contains(target)) return;
    activateFrom(target);
  };

  const act = (fn: (path: NodePath) => void) => (e: Event) => {
    e.preventDefault();
    if (active) fn(active.path);
  };
  up.addEventListener(
    "click",
    act((p) => opts.onMove(p, -1)),
  );
  down.addEventListener(
    "click",
    act((p) => opts.onMove(p, 1)),
  );
  del.addEventListener("click", act(opts.onDelete));
  addSibling.addEventListener("click", act(opts.onAddSibling));
  addChild.addEventListener("click", act(opts.onAddChild));
  cog.addEventListener("click", act(opts.onInspect));

  // ── Keyboard path (a11y) ───────────────────────────────────────────────────
  // One path for every node kind, where there used to be one per layer.
  for (const { el } of readNodeMarkers(doc)) makeChromeFocusable(el);

  const enabledButtons = (): HTMLButtonElement[] =>
    [...toolbar.querySelectorAll<HTMLButtonElement>("button:not([disabled])")].filter(
      (b) => b.style.display !== "none",
    );

  /** After a keyboard reorder the element is the same node but its marker moved
   *  (the editor re-stamps synchronously); re-resolve from the current marker so
   *  position, bounds, and the tracked path all follow. */
  const resync = (): void => {
    const el = active?.el;
    if (!el) return;
    if (!el.isConnected) return clear();
    activateFrom(el);
  };

  /** After a delete the focused node is gone; move focus to whatever now sits at
   *  that spot so keyboard flow isn't dropped to <body>. */
  const refocusAfterDelete = (path: NodePath): void => {
    // Read the position BEFORE clearing — `clear()` nulls `active`.
    const idx = active?.desc.ordered?.index ?? 0;
    clear();
    // Siblings share this node's parent path and its depth. Comparing the parent
    // prefix segment-wise (not as a raw string) keeps `…blocks.1` from matching
    // `…blocks.10`.
    const parent = path.slice(0, -1);
    const siblings = readNodeMarkers(doc).filter(
      (n) => n.path.length === path.length && samePath(n.path.slice(0, -1), parent),
    );
    siblings[Math.min(idx, siblings.length - 1)]?.el.focus();
  };

  const onFocusIn = (e: FocusEvent): void => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    // Focus inside the toolbar keeps the node active — the keyboard analogue of
    // hovering it.
    if (toolbar.contains(t)) return;
    if (t.hasAttribute(NODE_MARKER_ATTR)) return activateFrom(t);
    clear();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // (1) Focus within the toolbar: rove with ←/→, step back with Escape.
    if (toolbar.contains(t)) {
      if (e.key === "Escape") {
        e.preventDefault();
        active?.el.focus();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const btns = enabledButtons();
        const i = btns.indexOf(t as HTMLButtonElement);
        if (i >= 0) {
          const n = btns.length;
          btns[e.key === "ArrowRight" ? (i + 1) % n : (i - 1 + n) % n]?.focus();
        }
      }
      return;
    }

    // (2) Focus on the marked node itself (never its inner text, so plain keys
    // stay safe to repurpose).
    if (!active || t !== active.el) return;
    const { path, desc } = active;

    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      enabledButtons()[0]?.focus();
      return;
    }
    if (!desc.ordered) return; // move/delete are meaningless without a position
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      if (!up.disabled) opts.onMove(path, -1);
      resync();
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      if (!down.disabled) opts.onMove(path, 1);
      resync();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      opts.onDelete(path);
      refocusAfterDelete(path);
    }
  };

  doc.addEventListener("mouseover", onOver, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("keydown", onKeyDown, true);

  return () => {
    doc.removeEventListener("mouseover", onOver, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    clear();
    for (const el of doc.querySelectorAll<HTMLElement>("[data-louise-kbd]")) {
      el.removeAttribute("tabindex");
      el.removeAttribute("aria-keyshortcuts");
      delete el.dataset.louiseKbd;
    }
    toolbar.remove();
    doc.getElementById(CHROME_STYLE_ID)?.remove();
  };
}

export { samePath };
