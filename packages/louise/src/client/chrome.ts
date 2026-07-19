// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/client — the on-canvas editing chrome's marker contract (#182
// Phases 1–2, ADR 0005). The render stamps a marker on each rendered section —
// and, once a section adopts the block layer, on each block — in edit mode:
//
//   data-louise-section="<i>"          // section i           (Phase 1)
//   data-louise-block="<i>.blocks.<j>" // block j of section i (Phase 2)
//
// The chrome reads these to attach rings / toolbars to the *real* server-rendered
// elements (rings are a `box-shadow` on the element itself, so they're never
// clipped by an `overflow` ancestor or mis-measured against a separate overlay).
// Hit-testing is **deepest-boundary-wins**: a hover over a block lights the block
// (blue) and suppresses its parent section (orange), so exactly one layer is
// active — the ADR's `:has()` suppression done in JS, which needs no `:has()`
// support and stays unit-testable. This module is the reader half — pure DOM, no
// Solid — so it unit-tests without mounting the editor; the editor wires the
// structural callbacks to its store + autosave.

/** The attribute each rendered section carries in edit mode. */
export const SECTION_MARKER_ATTR = "data-louise-section";
/** The attribute each rendered block carries in edit mode (Phase 2). */
export const BLOCK_MARKER_ATTR = "data-louise-block";

/** A marked section element and its stamped array index. */
export interface MarkedSection {
  index: number;
  el: HTMLElement;
}

/**
 * The marked section elements under `root`, ordered by their stamped **index**
 * (not DOM order — defensive if a structural op reorders the DOM before the
 * store settles). Elements with a missing/negative/non-integer marker are
 * skipped, so a malformed stamp can't crash the chrome.
 */
export function readSectionMarkers(root: ParentNode = document): MarkedSection[] {
  const out: MarkedSection[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`[${SECTION_MARKER_ATTR}]`)) {
    const index = Number(el.getAttribute(SECTION_MARKER_ATTR));
    if (Number.isInteger(index) && index >= 0) out.push({ index, el });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The section index owning `node` — the nearest ancestor (or self) carrying the
 * section marker — or `null` when the node is outside every section. This is the
 * root of **deepest-boundary-wins** hit-testing: a hover resolves to the tightest
 * enclosing section (and later, block), not an outer one.
 */
export function sectionIndexOf(node: Node | null): number | null {
  const start = node instanceof Element ? node : (node?.parentElement ?? null);
  const el = start?.closest<HTMLElement>(`[${SECTION_MARKER_ATTR}]`) ?? null;
  if (!el) return null;
  const index = Number(el.getAttribute(SECTION_MARKER_ATTR));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** A block's identity: which section owns it and its position within that
 *  section's `blocks` array — the parsed form of a `data-louise-block` marker. */
export interface BlockRef {
  section: number;
  block: number;
}

/** A marked block element with its parsed {@link BlockRef}. */
export interface MarkedBlock extends BlockRef {
  el: HTMLElement;
}

/**
 * Parse a `data-louise-block` value (`"<i>.blocks.<j>"`) into a {@link BlockRef},
 * or `null` if it isn't that exact shape with two non-negative integer indices —
 * so a malformed stamp is skipped rather than crashing the chrome (the same
 * defensiveness as the section reader).
 */
export function parseBlockMarker(value: string | null): BlockRef | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[1] !== "blocks") return null;
  const section = Number(parts[0]);
  const block = Number(parts[2]);
  if (!Number.isInteger(section) || section < 0) return null;
  if (!Number.isInteger(block) || block < 0) return null;
  return { section, block };
}

/**
 * The marked block elements under `root`, ordered by (section, block) index —
 * not DOM order, mirroring {@link readSectionMarkers}. Malformed markers are
 * skipped.
 */
export function readBlockMarkers(root: ParentNode = document): MarkedBlock[] {
  const out: MarkedBlock[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`[${BLOCK_MARKER_ATTR}]`)) {
    const ref = parseBlockMarker(el.getAttribute(BLOCK_MARKER_ATTR));
    if (ref) out.push({ ...ref, el });
  }
  return out.sort((a, b) => a.section - b.section || a.block - b.block);
}

/**
 * The {@link BlockRef} owning `node` — the nearest ancestor (or self) carrying a
 * block marker — or `null` when the node is inside no block. The block half of
 * deepest-boundary-wins hit-testing: since a block marker always nests inside its
 * section marker, the nearest block wins over the enclosing section.
 */
export function blockRefOf(node: Node | null): BlockRef | null {
  const start = node instanceof Element ? node : (node?.parentElement ?? null);
  const el = start?.closest<HTMLElement>(`[${BLOCK_MARKER_ATTR}]`) ?? null;
  return el ? parseBlockMarker(el.getAttribute(BLOCK_MARKER_ATTR)) : null;
}

/* ── On-canvas section chrome ──────────────────────────────────────────────
 * A ring + floating toolbar drawn over the hovered section (ADR 0005 §3). Kept
 * vanilla (no Solid) so it bundles into a standalone harness and unit-tests
 * without the editor. The ring is a `box-shadow` on the section element itself,
 * so it's never clipped by an `overflow` ancestor. Structural actions are
 * callbacks — the editor wires them to its store + save; a harness stubs them.
 */

/** Actions the block toolbar exposes, keyed by the block's {@link BlockRef}.
 *  `onAdd` (add a block after `ref`) is optional — supplied once the section
 *  re-renders through the fragment route (#182 Phase 3); when omitted, the
 *  toolbar shows move + delete only. */
export interface BlockChromeActions {
  // Property (arrow) form, not method shorthand: these are referenced unbound
  // (`sectionAct(opts.onMoveUp)`), so the strict-checked property type is both
  // correct and what `typescript/unbound-method` expects.
  onMoveUp: (ref: BlockRef) => void;
  onMoveDown: (ref: BlockRef) => void;
  onDelete: (ref: BlockRef) => void;
  onAdd?: (ref: BlockRef) => void;
  /** Open the inspector for this block (#182 Phase 4) — adds a ⚙ to the toolbar. */
  onInspect?: (ref: BlockRef) => void;
}

/** Actions the section toolbar exposes. Duplicate/add are deferred to the
 *  fragment-render route (Phase 3), so v1 is move + delete only. Supply `blocks`
 *  to also light the block layer (blue ring + toolbar) with deepest-boundary-wins
 *  hit-testing; omit it for a section-only chrome (Phase 1 behaviour). */
export interface SectionChromeActions {
  // Property (arrow) form — see BlockChromeActions above.
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDelete: (index: number) => void;
  /** Open the inspector for this section (#182 Phase 4) — adds a ⚙ to the toolbar. */
  onInspect?: (index: number) => void;
  blocks?: BlockChromeActions;
}

const CHROME_STYLE_ID = "louise-chrome-style";
const CHROME_CSS = `
[${SECTION_MARKER_ATTR}].louise-chrome-active {
  box-shadow: 0 0 0 2px var(--louise-orange, #ea7317);
  border-radius: 4px;
}
[${BLOCK_MARKER_ATTR}].louise-block-active {
  box-shadow: 0 0 0 2px var(--louise-blue, #1481ef);
  border-radius: 4px;
}
.louise-chrome-toolbar {
  position: fixed;
  z-index: 2147483200;
  display: none;
  gap: 2px;
  padding: 3px;
  /* One stop darker than the ring's brand orange: the bar carries white glyph
     labels, which need 4.5:1 (WCAG 1.4.3) — the ring itself is a non-text
     graphic and stays on brand at 3:1. #b45309 = 5.0:1 against white. */
  background: var(--louise-orange-strong, #b45309);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.25);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
/* Likewise the block bar — #0f6ecd = 5.1:1 against its white glyphs. */
.louise-chrome-toolbar.louise-block-toolbar { background: var(--louise-blue-strong, #0f6ecd); }
.louise-chrome-toolbar[data-open="1"] { display: inline-flex; }
/* Keep the bar shown while a keyboard user is roving its buttons (focus is
 * inside it even though the pointer has left the ringed element). */
.louise-chrome-toolbar:focus-within { display: inline-flex; }
.louise-chrome-btn {
  appearance: none;
  border: none;
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.louise-chrome-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.3); }
.louise-chrome-btn:disabled { opacity: 0.4; cursor: default; }
.louise-chrome-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
/* A keyboard-focused editable region (see makeChromeFocusable) gets a visible
 * ring in its layer colour so the tab stop is obvious. */
[${SECTION_MARKER_ATTR}][data-louise-kbd]:focus-visible {
  outline: 2px solid var(--louise-orange, #ea7317);
  outline-offset: 2px;
}
[${BLOCK_MARKER_ATTR}][data-louise-kbd]:focus-visible {
  outline: 2px solid var(--louise-blue, #1481ef);
  outline-offset: 2px;
}
`;

/** The keyboard actions Louise adds to a marked section/block, advertised to AT
 *  via `aria-keyshortcuts` (Enter steps into the toolbar; Alt+↑/↓ reorder; Delete
 *  removes). */
const CHROME_KEYSHORTCUTS = "Enter Alt+ArrowUp Alt+ArrowDown Delete";

/**
 * Make a marked section/block a keyboard tab-stop so its toolbar can be reached
 * without a mouse (the toolbar reveals on focus — see {@link mountSectionChrome}).
 * Additive and non-destructive: it never overwrites an author's own `tabindex`
 * (or `role` / `aria-label`) on the element, and flags what it added with
 * `data-louise-kbd` so the chrome's disposer removes exactly that and nothing the
 * author owns. Idempotent.
 */
function makeChromeFocusable(el: HTMLElement): void {
  if (el.dataset.louiseKbd === "1" || el.hasAttribute("tabindex")) return;
  el.tabIndex = 0;
  el.setAttribute("aria-keyshortcuts", CHROME_KEYSHORTCUTS);
  el.dataset.louiseKbd = "1";
}

/** Position a floating toolbar at the top-right of `el`, clamped to the viewport,
 *  and open it. */
function placeToolbar(toolbar: HTMLElement, el: HTMLElement): void {
  // Open first: while `display:none` the toolbar has no measurable size, and we
  // need its real width/height to keep it on-screen.
  toolbar.dataset.open = "1";
  const box = el.getBoundingClientRect();
  const w = toolbar.offsetWidth;
  const h = toolbar.offsetHeight;
  // Right-align to the element's top-right (`box.right - w`), but clamp so the
  // whole bar stays in the viewport. The right/bottom clamps are the fix: a
  // full-bleed section has `box.right ≈ innerWidth`, and the old fixed 90px
  // offset (from before the gear/add buttons widened the bar) ran the delete +
  // gear buttons off the right edge.
  toolbar.style.left = `${Math.min(Math.max(4, box.right - w), window.innerWidth - w - 4)}px`;
  toolbar.style.top = `${Math.min(Math.max(4, box.top + 6), window.innerHeight - h - 4)}px`;
}

/**
 * Mount the on-canvas chrome over the marked sections — and, when `opts.blocks`
 * is supplied, the marked blocks — under the document. Hovering an element rings
 * the tightest enclosing layer and floats its toolbar (↑ move up, ↓ move down, ✕
 * delete) at the top-right: **orange** for a section, **blue** for a block. The
 * buttons call the supplied actions with the section index / {@link BlockRef}.
 *
 * Hit-testing is **deepest-boundary-wins**: a hover inside a block activates the
 * block and clears any active section, so only one layer rings at a time (the
 * ADR's `:has()` suppression, done in JS). Hovering either toolbar keeps its
 * layer active so it doesn't flicker away. Returns a disposer that removes the
 * listeners, toolbars, and injected style.
 */
export function mountSectionChrome(opts: SectionChromeActions): () => void {
  const doc = document;

  if (!doc.getElementById(CHROME_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = CHROME_STYLE_ID;
    style.textContent = CHROME_CSS;
    doc.head.appendChild(style);
  }

  const button = (label: string, title: string): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "louise-chrome-btn";
    b.textContent = label;
    b.title = title;
    // The visible label is a glyph (↑ ✕ ⚙) — give the button a real accessible
    // name so a screen reader announces "Move up", not "up arrow".
    b.setAttribute("aria-label", title);
    return b;
  };
  const makeToolbar = (block: boolean, delTitle: string, addTitle?: string, inspect?: boolean) => {
    const toolbar = doc.createElement("div");
    toolbar.className = block
      ? "louise-chrome-toolbar louise-block-toolbar"
      : "louise-chrome-toolbar";
    toolbar.dataset.open = "0";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-orientation", "horizontal");
    toolbar.setAttribute("aria-label", block ? "Block actions" : "Section actions");
    const up = button("↑", "Move up");
    const down = button("↓", "Move down");
    const del = button("✕", delTitle);
    // `+` (add after) only when the layer supports it — the block toolbar once
    // the fragment route is wired (#182 Phase 3).
    const add = addTitle ? button("+", addTitle) : null;
    // `⚙` opens the inspector (layout + settings) — only when wired (#182 Phase 4).
    const cog = inspect ? button("⚙", "Layout & settings") : null;
    for (const b of [up, down, del, ...(add ? [add] : []), ...(cog ? [cog] : [])]) {
      toolbar.appendChild(b);
    }
    doc.body.appendChild(toolbar);
    return { toolbar, up, down, del, add, cog };
  };

  const section = makeToolbar(false, "Delete section", undefined, !!opts.onInspect);
  const blockActions = opts.blocks;
  const block = blockActions
    ? makeToolbar(
        true,
        "Delete block",
        blockActions.onAdd ? "Add block after" : undefined,
        !!blockActions.onInspect,
      )
    : null;

  let activeSection: { index: number; el: HTMLElement } | null = null;
  let activeBlock: { ref: BlockRef; el: HTMLElement } | null = null;

  const clearSection = (): void => {
    activeSection?.el.classList.remove("louise-chrome-active");
    activeSection = null;
    section.toolbar.dataset.open = "0";
  };
  const clearBlock = (): void => {
    activeBlock?.el.classList.remove("louise-block-active");
    activeBlock = null;
    if (block) block.toolbar.dataset.open = "0";
  };

  const activateSection = (index: number, el: HTMLElement): void => {
    clearBlock();
    if (activeSection && activeSection.el !== el) {
      activeSection.el.classList.remove("louise-chrome-active");
    }
    activeSection = { index, el };
    el.classList.add("louise-chrome-active");
    const count = readSectionMarkers().length;
    section.up.disabled = index <= 0;
    section.down.disabled = index >= count - 1;
    placeToolbar(section.toolbar, el);
  };

  const activateBlock = (ref: BlockRef, el: HTMLElement): void => {
    if (!block) return;
    clearSection();
    if (activeBlock && activeBlock.el !== el) {
      activeBlock.el.classList.remove("louise-block-active");
    }
    activeBlock = { ref, el };
    el.classList.add("louise-block-active");
    const last = readBlockMarkers().filter((b) => b.section === ref.section).length - 1;
    block.up.disabled = ref.block <= 0;
    block.down.disabled = ref.block >= last;
    placeToolbar(block.toolbar, el);
  };

  const onOver = (e: Event): void => {
    const target = e.target as Node | null;
    if (target && (section.toolbar.contains(target) || block?.toolbar.contains(target))) return;
    const from = target instanceof Element ? target : (target?.parentElement ?? null);
    const selector = block
      ? `[${BLOCK_MARKER_ATTR}], [${SECTION_MARKER_ATTR}]`
      : `[${SECTION_MARKER_ATTR}]`;
    const el = from?.closest<HTMLElement>(selector) ?? null;
    if (!el) {
      clearSection();
      clearBlock();
      return;
    }
    // Deepest-boundary-wins: `closest` returns the tightest marked ancestor, so a
    // block (nested in its section) beats the section it lives in.
    if (block && el.hasAttribute(BLOCK_MARKER_ATTR)) {
      const ref = parseBlockMarker(el.getAttribute(BLOCK_MARKER_ATTR));
      if (ref) {
        activateBlock(ref, el);
        return;
      }
    }
    const index = Number(el.getAttribute(SECTION_MARKER_ATTR));
    if (Number.isInteger(index) && index >= 0) activateSection(index, el);
    else {
      clearSection();
      clearBlock();
    }
  };

  const sectionAct = (fn: (i: number) => void) => (e: Event) => {
    e.preventDefault();
    if (activeSection) fn(activeSection.index);
  };
  const blockAct = (fn: (ref: BlockRef) => void) => (e: Event) => {
    e.preventDefault();
    if (activeBlock) fn(activeBlock.ref);
  };
  section.up.addEventListener("click", sectionAct(opts.onMoveUp));
  section.down.addEventListener("click", sectionAct(opts.onMoveDown));
  section.del.addEventListener("click", sectionAct(opts.onDelete));
  if (section.cog && opts.onInspect)
    section.cog.addEventListener("click", sectionAct(opts.onInspect));
  if (block && blockActions) {
    block.up.addEventListener("click", blockAct(blockActions.onMoveUp));
    block.down.addEventListener("click", blockAct(blockActions.onMoveDown));
    block.del.addEventListener("click", blockAct(blockActions.onDelete));
    if (block.add && blockActions.onAdd) {
      block.add.addEventListener("click", blockAct(blockActions.onAdd));
    }
    if (block.cog && blockActions.onInspect) {
      block.cog.addEventListener("click", blockAct(blockActions.onInspect));
    }
  }
  // ── Keyboard path (a11y) ───────────────────────────────────────────────────
  // The hover chrome above is mouse-only; mirror it for the keyboard so a section
  // or block can be reordered, deleted, and inspected without a pointer. Marked
  // regions are focusable tab-stops (makeChromeFocusable); focusing one reveals
  // its toolbar (onFocusIn), and Enter/Alt+↑↓/Delete drive it (onKeyDown).
  const enabledButtons = (tb: HTMLElement): HTMLButtonElement[] => [
    ...tb.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  ];
  const stepIntoToolbar = (tb: HTMLElement): void => enabledButtons(tb)[0]?.focus();

  // After a keyboard reorder the region stays the same node but its marker index
  // shifted (the editor re-stamps synchronously via the instant structural ops);
  // re-activate from the current marker so the toolbar position + disabled state —
  // and the tracked active index — follow the new order.
  const resyncSection = (): void => {
    const el = activeSection?.el;
    if (!el) return;
    if (!el.isConnected) return clearSection();
    const idx = Number(el.getAttribute(SECTION_MARKER_ATTR));
    if (Number.isInteger(idx) && idx >= 0) activateSection(idx, el);
  };
  const resyncBlock = (): void => {
    const el = activeBlock?.el;
    if (!el || !block) return;
    if (!el.isConnected) return clearBlock();
    const ref = parseBlockMarker(el.getAttribute(BLOCK_MARKER_ATTR));
    if (ref) activateBlock(ref, el);
  };
  // After a delete the focused region is gone; move focus to whatever now sits at
  // that index (or the last), so keyboard flow isn't dropped back to <body>.
  const refocusAfterSectionDelete = (index: number): void => {
    clearSection();
    const marks = readSectionMarkers();
    marks[Math.min(index, marks.length - 1)]?.el.focus();
  };
  const refocusAfterBlockDelete = (ref: BlockRef): void => {
    clearBlock();
    const marks = readBlockMarkers().filter((b) => b.section === ref.section);
    marks[Math.min(ref.block, marks.length - 1)]?.el.focus();
  };

  const onFocusIn = (e: FocusEvent): void => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    // Focus inside a toolbar keeps its layer active (the keyboard analogue of
    // hovering the toolbar, which onOver already special-cases).
    if (section.toolbar.contains(t) || block?.toolbar.contains(t)) return;
    if (block && t.hasAttribute(BLOCK_MARKER_ATTR)) {
      const ref = parseBlockMarker(t.getAttribute(BLOCK_MARKER_ATTR));
      if (ref) return activateBlock(ref, t);
    }
    if (t.hasAttribute(SECTION_MARKER_ATTR)) {
      const index = Number(t.getAttribute(SECTION_MARKER_ATTR));
      if (Number.isInteger(index) && index >= 0) return activateSection(index, t);
    }
    // Focus moved to inner content or off the sections — retract the chrome (the
    // mouse equivalent is hovering away).
    clearSection();
    clearBlock();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // (1) Focus is within a toolbar: rove buttons with ←/→, step back to the
    // region with Escape.
    const tb = section.toolbar.contains(t)
      ? section.toolbar
      : block?.toolbar.contains(t)
        ? block.toolbar
        : null;
    if (tb) {
      if (e.key === "Escape") {
        e.preventDefault();
        (tb === section.toolbar ? activeSection?.el : activeBlock?.el)?.focus();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const btns = enabledButtons(tb);
        const i = btns.indexOf(t as HTMLButtonElement);
        if (i >= 0) {
          const n = btns.length;
          btns[e.key === "ArrowRight" ? (i + 1) % n : (i - 1 + n) % n]?.focus();
        }
      }
      return;
    }

    // (2) Focus is on a marked region itself (never its inner text — so plain keys
    // are safe to repurpose). Enter/F2 steps into the toolbar; Alt+↑/↓ reorders;
    // Delete/Backspace removes.
    const onSection = !!activeSection && t === activeSection.el;
    const onBlock = !!activeBlock && t === activeBlock.el;
    if (!onSection && !onBlock) return;

    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      stepIntoToolbar(onBlock && block ? block.toolbar : section.toolbar);
      return;
    }
    if (onSection && activeSection) {
      const idx = activeSection.index;
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        if (!section.up.disabled) opts.onMoveUp(idx);
        resyncSection();
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        if (!section.down.disabled) opts.onMoveDown(idx);
        resyncSection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        opts.onDelete(idx);
        refocusAfterSectionDelete(idx);
      }
    } else if (onBlock && activeBlock && block && blockActions) {
      const ref = activeBlock.ref;
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        if (!block.up.disabled) blockActions.onMoveUp(ref);
        resyncBlock();
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        if (!block.down.disabled) blockActions.onMoveDown(ref);
        resyncBlock();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        blockActions.onDelete(ref);
        refocusAfterBlockDelete(ref);
      }
    }
  };

  // Make the currently-rendered regions keyboard tab-stops. Structural ops re-stamp
  // (and re-focus) new/moved regions, so restampSection/restampBlock keep this fresh.
  for (const { el } of readSectionMarkers()) makeChromeFocusable(el);
  if (block) for (const b of readBlockMarkers()) makeChromeFocusable(b.el);

  doc.addEventListener("mouseover", onOver, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("keydown", onKeyDown, true);

  return () => {
    doc.removeEventListener("mouseover", onOver, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    clearSection();
    clearBlock();
    // Remove only the keyboard affordances we added (never an author's own attrs).
    for (const el of doc.querySelectorAll<HTMLElement>("[data-louise-kbd]")) {
      el.removeAttribute("tabindex");
      el.removeAttribute("aria-keyshortcuts");
      delete el.dataset.louiseKbd;
    }
    section.toolbar.remove();
    block?.toolbar.remove();
    doc.getElementById(CHROME_STYLE_ID)?.remove();
  };
}

/* ── Instant structural ops (ADR 0005 §4) ──────────────────────────────────
 * Reorder/delete move DOM nodes that are *already rendered* and reconcile the
 * store — no server round-trip, no reload. The catch: a section's index is
 * baked into its own marker AND the leading segment of every `data-louise-sfield`
 * path inside it (`"<i>.<key>[.<j>.<sub>]"`). After a move/delete those indices
 * shift, so re-stamp them here to keep markers — and thus the inline store-write
 * paths — aligned with the new order. (`wireInline`'s input handler re-reads the
 * marker, so re-stamping is enough — no re-wiring.)
 */

/** Re-stamp a section element to `newIndex`: its own `data-louise-section`, the
 *  leading index of every `data-louise-sfield` descendant, and the section
 *  segment of every nested `data-louise-block` (so a reorder keeps the block
 *  markers' `<i>` aligned with their new owner). */
export function restampSection(el: HTMLElement, newIndex: number): void {
  el.setAttribute(SECTION_MARKER_ATTR, String(newIndex));
  // Keep a re-stamped / freshly-inserted section a keyboard tab-stop (idempotent).
  makeChromeFocusable(el);
  for (const node of el.querySelectorAll<HTMLElement>("[data-louise-sfield]")) {
    const path = node.getAttribute("data-louise-sfield");
    if (!path) continue;
    const dot = path.indexOf(".");
    node.setAttribute(
      "data-louise-sfield",
      dot >= 0 ? `${newIndex}${path.slice(dot)}` : String(newIndex),
    );
  }
  for (const node of el.querySelectorAll<HTMLElement>(`[${BLOCK_MARKER_ATTR}]`)) {
    const ref = parseBlockMarker(node.getAttribute(BLOCK_MARKER_ATTR));
    if (ref) node.setAttribute(BLOCK_MARKER_ATTR, `${newIndex}.blocks.${ref.block}`);
  }
}

/**
 * Relocate the section at `from` to `to` among its marked siblings and re-stamp
 * every section to its new index — the instant reflection of a reorder. No-op if
 * either index is out of range. Assumes the marked sections share a parent (the
 * render nests each in the sections container).
 */
export function moveSectionElement(from: number, to: number, root: ParentNode = document): void {
  const els = readSectionMarkers(root).map((s) => s.el);
  if (from === to || from < 0 || to < 0 || from >= els.length || to >= els.length) return;
  const [moving] = els.splice(from, 1);
  els.splice(to, 0, moving);
  const parent = moving.parentNode;
  if (!parent) return;
  parent.insertBefore(moving, els[to + 1] ?? null);
  els.forEach((el, i) => restampSection(el, i));
}

/**
 * Remove the section at `index` from the DOM and re-stamp the survivors to a
 * gapless 0…n-1 — the instant reflection of a delete. No-op if not found.
 */
export function deleteSectionElement(index: number, root: ParentNode = document): void {
  const target = readSectionMarkers(root).find((s) => s.index === index);
  if (!target) return;
  target.el.remove();
  readSectionMarkers(root).forEach((s, i) => restampSection(s.el, i));
}

/**
 * Insert a server-rendered section element at `index` among `container`'s marked
 * section children and re-stamp every section to its new 0…n position — the
 * instant reflection of a structural **add** (#182 Phase 3), the store having
 * already spliced the new item at `index`. `el` is the fragment-render route's
 * one `[data-louise-section]` element (stamped at 0 by that route); this places
 * it and fixes all indices so its markers — and every shifted section's — line
 * up with the store. Sections are the container's direct marker-bearing children
 * (as the render nests them); appends when `index` is past the end.
 */
export function insertSectionElement(el: HTMLElement, index: number, container: Element): void {
  const marked = (): HTMLElement[] =>
    [...container.children].filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute(SECTION_MARKER_ATTR),
    );
  const existing = marked();
  container.insertBefore(el, existing[index] ?? null);
  marked().forEach((s, i) => restampSection(s, i));
}

/**
 * Replace the section at `index` in place with a freshly server-rendered element
 * and re-stamp it to `index` — the instant reflection of an in-section change
 * that alters *this* section's markup (e.g. a block **add**, #182 Phase 3, where
 * the fragment route re-renders the whole section with the new block). Only this
 * section's index changes, so siblings are untouched. No-op if not found.
 */
export function replaceSectionElement(
  index: number,
  el: HTMLElement,
  root: ParentNode = document,
): void {
  const target = readSectionMarkers(root).find((s) => s.index === index);
  if (!target) return;
  target.el.replaceWith(el);
  restampSection(el, index);
}

/* ── Instant block structural ops (ADR 0005 §4) ────────────────────────────
 * The block-layer analogue of the section ops above, scoped *within* one
 * section: reorder/delete blocks that are already rendered and re-stamp the
 * survivors. A block's index lives in its own `data-louise-block`
 * (`"<i>.blocks.<j>"`) AND the `<j>` segment of every `data-louise-sfield`
 * inside it (`"<i>.blocks.<j>.<key>"`); the section index `<i>` is stable
 * during a within-section reorder.
 */

/** Re-stamp a block element to `newBlock` within `section`: its own
 *  `data-louise-block` plus the section/block segments of every
 *  `data-louise-sfield` descendant. */
export function restampBlock(el: HTMLElement, section: number, newBlock: number): void {
  el.setAttribute(BLOCK_MARKER_ATTR, `${section}.blocks.${newBlock}`);
  // Keep a re-stamped / freshly-inserted block a keyboard tab-stop (idempotent).
  makeChromeFocusable(el);
  for (const node of el.querySelectorAll<HTMLElement>("[data-louise-sfield]")) {
    const path = node.getAttribute("data-louise-sfield");
    if (!path) continue;
    const parts = path.split(".");
    if (parts.length >= 4 && parts[1] === "blocks") {
      parts[0] = String(section);
      parts[2] = String(newBlock);
      node.setAttribute("data-louise-sfield", parts.join("."));
    }
  }
}

/**
 * Relocate the block at `from` to `to` within `section`'s blocks and re-stamp
 * every block in that section to its new index. No-op if either index is out of
 * range. Assumes a section's block elements share a parent (the render nests
 * them in the section's block container).
 */
export function moveBlockElement(
  section: number,
  from: number,
  to: number,
  root: ParentNode = document,
): void {
  const els = readBlockMarkers(root)
    .filter((b) => b.section === section)
    .map((b) => b.el);
  if (from === to || from < 0 || to < 0 || from >= els.length || to >= els.length) return;
  const [moving] = els.splice(from, 1);
  els.splice(to, 0, moving);
  const parent = moving.parentNode;
  if (!parent) return;
  parent.insertBefore(moving, els[to + 1] ?? null);
  els.forEach((el, j) => restampBlock(el, section, j));
}

/**
 * Remove the block at (`section`, `block`) from the DOM and re-stamp that
 * section's surviving blocks to a gapless 0…n-1. No-op if not found.
 */
export function deleteBlockElement(
  section: number,
  block: number,
  root: ParentNode = document,
): void {
  const target = readBlockMarkers(root).find((b) => b.section === section && b.block === block);
  if (!target) return;
  target.el.remove();
  readBlockMarkers(root)
    .filter((b) => b.section === section)
    .forEach((b, j) => restampBlock(b.el, section, j));
}
