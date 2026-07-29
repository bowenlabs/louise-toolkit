// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Instant structural ops on the editable-node model (ADR 0010; generalises
// ADR 0005 §4).
//
// Reorder / delete / insert move elements that are ALREADY rendered and reconcile
// the store — no server round-trip, no reload. The catch is that a node's index is
// baked into its own marker and into the markers of everything inside it, so after
// a move the survivors must be re-stamped or the markers (and thus the store-write
// paths they drive) drift out of alignment with the data.
//
// Pre-0010 that took two near-identical implementations, one per layer, each
// hand-rewriting a different set of attributes. Here it is one prefix rewrite
// (`restampNode`) applied to whichever siblings shifted, so the section and block
// cases are the same code at different depths.

import {
  formatNodePath,
  NODE_MARKER_ATTR,
  type NodePath,
  type NodeRoot,
  parseNodePath,
  readNodeMarkers,
  restampNode,
  samePath,
} from "./node.js";

/** Inline-editable text still carries its own marker in A1 — the field registry
 *  folds it into the node marker in A2 (ADR 0010, "Resolved while building A1").
 *  Until then a re-stamp has to move both families together. */
const SFIELD_ATTR = "data-louise-sfield";
const RESTAMPED_ATTRS = [NODE_MARKER_ATTR, SFIELD_ATTR] as const;

const CHROME_KEYSHORTCUTS = "Enter Alt+ArrowUp Alt+ArrowDown Delete";

/** Keep a re-stamped or freshly-inserted node a keyboard tab-stop. Idempotent,
 *  and never overwrites an author's own `tabindex`. */
function makeFocusable(el: HTMLElement): void {
  if (el.dataset.louiseKbd === "1" || el.hasAttribute("tabindex")) return;
  el.tabIndex = 0;
  el.setAttribute("aria-keyshortcuts", CHROME_KEYSHORTCUTS);
  el.dataset.louiseKbd = "1";
}

/**
 * Every marked node at `parent`'s depth + 1 whose parent path is `parent` — one
 * ordered sibling list, at any depth.
 *
 * Deliberately **DOM order**, not marker order. Sorting by the stamped index
 * looks more careful and is actively wrong: right after an insert the new element
 * still carries the index the fragment route gave it (0), so two siblings claim
 * the same position and a sort interleaves them — which re-stamps the list into an
 * order that doesn't match what's on screen. Between structural ops the two orders
 * agree anyway; during one, only the DOM is trustworthy.
 */
export function siblingsAt(parent: NodePath, root: NodeRoot = document): HTMLElement[] {
  const depth = parent.length + 1;
  return readNodeMarkers(root)
    .filter((n) => n.path.length === depth && samePath(n.path.slice(0, -1), parent))
    .map((n) => n.el);
}

/** Re-stamp `el` (and everything inside it) from its current path to `to`. */
function restampTo(el: HTMLElement, to: NodePath): void {
  const from = parseNodePath(el.getAttribute(NODE_MARKER_ATTR));
  if (from) restampNode(el, from, to, RESTAMPED_ATTRS);
  else el.setAttribute(NODE_MARKER_ATTR, formatNodePath(to));
  makeFocusable(el);
}

/** Re-stamp a whole sibling list to a gapless 0…n-1 under `parent`. */
function restampSiblings(parent: NodePath, els: HTMLElement[]): void {
  els.forEach((el, i) => restampTo(el, [...parent, i]));
}

/**
 * Move the child at `from` to `to` within `parent`'s ordered list, and re-stamp
 * the list — the instant reflection of a reorder. No-op when either index is out
 * of range. Assumes the siblings share a DOM parent, as every render nests them.
 *
 * One function for sections (`parent: []`) and blocks (`parent: [i, "blocks"]`).
 */
export function moveNodeElement(
  parent: NodePath,
  from: number,
  to: number,
  root: NodeRoot = document,
): void {
  const els = siblingsAt(parent, root);
  if (from === to || from < 0 || to < 0 || from >= els.length || to >= els.length) return;
  const [moving] = els.splice(from, 1);
  els.splice(to, 0, moving);
  const domParent = moving.parentNode;
  if (!domParent) return;
  domParent.insertBefore(moving, els[to + 1] ?? null);
  restampSiblings(parent, els);
}

/** Remove the child at `index` and re-stamp the survivors to a gapless 0…n-1 —
 *  the instant reflection of a delete. No-op when not found. */
export function deleteNodeElement(
  parent: NodePath,
  index: number,
  root: NodeRoot = document,
): void {
  const els = siblingsAt(parent, root);
  const target = els[index];
  if (!target) return;
  target.remove();
  restampSiblings(
    parent,
    els.filter((el) => el !== target),
  );
}

/**
 * Insert a server-rendered element at `index` among `parent`'s marked children
 * and re-stamp the list — the instant reflection of a structural **add**, the
 * store having already spliced the item at `index`.
 *
 * `el` comes from the fragment-render route stamped at its own index 0, so every
 * marker in it is fixed up here rather than by the route. Appends when `index` is
 * past the end.
 */
export function insertNodeElement(
  el: HTMLElement,
  parent: NodePath,
  index: number,
  container: NodeRoot,
): void {
  const els = siblingsAt(parent, container);
  const before = els[index] ?? null;
  container.insertBefore(el, before);
  const next = siblingsAt(parent, container);
  restampSiblings(parent, next);
}

/**
 * Replace the child at `index` in place with a freshly rendered element — the
 * instant reflection of a change that alters *this* child's markup (a block add,
 * a type swap), where only its own subtree changes and siblings are untouched.
 */
export function replaceNodeElement(
  parent: NodePath,
  index: number,
  el: HTMLElement,
  root: NodeRoot = document,
): void {
  const target = siblingsAt(parent, root)[index];
  if (!target) return;
  target.replaceWith(el);
  restampTo(el, [...parent, index]);
}
