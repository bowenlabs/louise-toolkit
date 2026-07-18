// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/client — the on-canvas editing chrome's marker contract (#182
// Phase 1, ADR 0005). The render stamps a per-section marker on each rendered
// section element in edit mode:
//
//   data-louise-section="<i>"          // section i (this slice)
//   data-louise-block="<i>.blocks.<j>" // block j of section i (Phase 2)
//
// The chrome reads these to attach rings / toolbars / "+" inserters to the *real*
// server-rendered elements (rings are a `box-shadow` on the element itself, so
// they're never clipped by an `overflow` ancestor or mis-measured against a
// separate overlay). This module is the reader half — pure DOM, no Solid — so it
// unit-tests without mounting the editor; the visual chrome builds on it next.

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

/* ── On-canvas section chrome ──────────────────────────────────────────────
 * A ring + floating toolbar drawn over the hovered section (ADR 0005 §3). Kept
 * vanilla (no Solid) so it bundles into a standalone harness and unit-tests
 * without the editor. The ring is a `box-shadow` on the section element itself,
 * so it's never clipped by an `overflow` ancestor. Structural actions are
 * callbacks — the editor wires them to its store + save; a harness stubs them.
 */

/** Actions the section toolbar exposes. Duplicate/add are deferred to the
 *  fragment-render route (Phase 3), so v1 is move + delete only. */
export interface SectionChromeActions {
  onMoveUp(index: number): void;
  onMoveDown(index: number): void;
  onDelete(index: number): void;
}

const CHROME_STYLE_ID = "louise-chrome-style";
const CHROME_CSS = `
[${SECTION_MARKER_ATTR}].louise-chrome-active {
  box-shadow: 0 0 0 2px var(--louise-orange, #ea7317);
  border-radius: 4px;
}
.louise-chrome-toolbar {
  position: fixed;
  z-index: 2147483200;
  display: none;
  gap: 2px;
  padding: 3px;
  background: var(--louise-orange, #ea7317);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.25);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.louise-chrome-toolbar[data-open="1"] { display: inline-flex; }
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
`;

/**
 * Mount the on-canvas section chrome over the marked sections under `root`.
 * Hovering a section rings it and floats a toolbar (↑ move up, ↓ move down, ✕
 * delete) at its top-right; the buttons call the supplied actions with the
 * section's index. Hit-testing is deepest-boundary (via {@link sectionIndexOf}),
 * and hovering the toolbar keeps its section active so it doesn't flicker away.
 * Returns a disposer that removes the listeners, toolbar, and injected style.
 */
export function mountSectionChrome(opts: SectionChromeActions): () => void {
  const doc = document;

  if (!doc.getElementById(CHROME_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = CHROME_STYLE_ID;
    style.textContent = CHROME_CSS;
    doc.head.appendChild(style);
  }

  const toolbar = doc.createElement("div");
  toolbar.className = "louise-chrome-toolbar";
  toolbar.dataset.open = "0";
  const button = (label: string, title: string): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "louise-chrome-btn";
    b.textContent = label;
    b.title = title;
    return b;
  };
  const upBtn = button("↑", "Move up");
  const downBtn = button("↓", "Move down");
  const delBtn = button("✕", "Delete section");
  for (const b of [upBtn, downBtn, delBtn]) toolbar.appendChild(b);
  doc.body.appendChild(toolbar);

  let active: number | null = null;
  let activeEl: HTMLElement | null = null;

  const deactivate = (): void => {
    activeEl?.classList.remove("louise-chrome-active");
    active = null;
    activeEl = null;
    toolbar.dataset.open = "0";
  };

  const activate = (index: number, el: HTMLElement): void => {
    if (activeEl && activeEl !== el) activeEl.classList.remove("louise-chrome-active");
    active = index;
    activeEl = el;
    el.classList.add("louise-chrome-active");
    const count = readSectionMarkers().length;
    upBtn.disabled = index <= 0;
    downBtn.disabled = index >= count - 1;
    const box = el.getBoundingClientRect();
    toolbar.style.top = `${Math.max(4, box.top + 6)}px`;
    toolbar.style.left = `${Math.max(4, box.right - 90)}px`;
    toolbar.dataset.open = "1";
  };

  const onOver = (e: Event): void => {
    const target = e.target as Node | null;
    if (target && toolbar.contains(target)) return; // over the toolbar → keep active
    const from = target instanceof Element ? target : (target?.parentElement ?? null);
    const el = from?.closest<HTMLElement>(`[${SECTION_MARKER_ATTR}]`) ?? null;
    if (!el) {
      deactivate();
      return;
    }
    const index = Number(el.getAttribute(SECTION_MARKER_ATTR));
    if (Number.isInteger(index) && index >= 0) activate(index, el);
  };

  const act = (fn: (i: number) => void) => (e: Event) => {
    e.preventDefault();
    if (active !== null) fn(active);
  };
  const onUp = act(opts.onMoveUp);
  const onDown = act(opts.onMoveDown);
  const onDel = act(opts.onDelete);
  upBtn.addEventListener("click", onUp);
  downBtn.addEventListener("click", onDown);
  delBtn.addEventListener("click", onDel);
  doc.addEventListener("mouseover", onOver, true);

  return () => {
    doc.removeEventListener("mouseover", onOver, true);
    deactivate();
    toolbar.remove();
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

/** Re-stamp a section element to `newIndex`: its own `data-louise-section` plus
 *  the leading index of every `data-louise-sfield` descendant. */
export function restampSection(el: HTMLElement, newIndex: number): void {
  el.setAttribute(SECTION_MARKER_ATTR, String(newIndex));
  for (const node of el.querySelectorAll<HTMLElement>("[data-louise-sfield]")) {
    const path = node.getAttribute("data-louise-sfield");
    if (!path) continue;
    const dot = path.indexOf(".");
    node.setAttribute(
      "data-louise-sfield",
      dot >= 0 ? `${newIndex}${path.slice(dot)}` : String(newIndex),
    );
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
