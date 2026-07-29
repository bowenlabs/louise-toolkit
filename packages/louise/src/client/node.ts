// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The editable-node model (ADR 0010) — the marker contract the on-canvas chrome
// reads.
//
// A render stamps ONE attribute on anything editable:
//
//   data-louise-node="<path>"
//
// where `<path>` addresses the thing inside the page's `sections` JSON:
//
//   "0"                 → section 0
//   "0.blocks.1"        → block 1 of section 0
//   "0.ctaHref"         → section 0's ctaHref field
//   "0.blocks.1.href"   → block 1's href field
//
// This replaces `data-louise-section` / `data-louise-block` / `data-louise-link`,
// which were three attributes over four grammars with two hand-written parsers —
// and which forced the render side to string-sniff a path to decide which
// attribute to stamp (astroid `Section.astro`, pre-0010).
//
// The chrome deliberately owns **no policy**. It cannot tell a section from a
// block from a link, and does not try: it hands a parsed path to a `resolve`
// callback and renders whatever capabilities come back. That is what makes a new
// kind of node (a shared value, an external source — ADR 0010 Phase B) a change
// in the *editor*, never in the chrome.

/** One step of a node path: an array index, or a field/collection key. */
export type PathSegment = number | string;

/** A parsed `data-louise-node` value — a path into the page's `sections` JSON. */
export type NodePath = PathSegment[];

/** The single marker attribute every editable node carries in edit mode. */
export const NODE_MARKER_ATTR = "data-louise-node";

/**
 * Parse a `data-louise-node` value into a {@link NodePath}, or `null` when it
 * isn't a usable path.
 *
 * A segment that reads as a non-negative integer becomes a number (an array
 * index); anything else stays a string (a key). One grammar covers every case the
 * three old parsers handled separately, because all of them were only ever paths.
 *
 * Malformed markers return `null` rather than throwing, so a bad stamp is skipped
 * instead of taking the chrome down with it — the defensiveness the section,
 * block, and link readers each implemented on their own.
 */
export function parseNodePath(value: string | null): NodePath | null {
  if (!value) return null;
  const parts = value.split(".");
  const path: NodePath = [];
  for (const part of parts) {
    if (part === "") return null; // empty segment: "0.", ".x", "a..b"
    // Canonical index, or a key. A number-ish segment that ISN'T canonical
    // ("01", "-1", "+1", "2fields") is rejected rather than quietly becoming a
    // key: those only arise from a re-stamp bug or a hand-written marker, and
    // letting one through would silently address a node that doesn't exist.
    if (/^(?:0|[1-9]\d*)$/.test(part)) path.push(Number(part));
    else if (/^[-+\d]/.test(part)) return null;
    else path.push(part);
  }
  return path.length > 0 ? path : null;
}

/** Serialize a {@link NodePath} back to its marker form. Inverse of
 *  {@link parseNodePath} for every path that one accepts. */
export function formatNodePath(path: NodePath): string {
  return path.join(".");
}

/** Whether two paths address the same node. */
export function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

/**
 * What a node can do, resolved by the editor from its catalog. Every field is
 * optional and independent — a node may have any combination, including none.
 *
 * They are NOT an exclusive role. A section is both `ordered` (it has a position
 * in the page's list, so it moves and deletes) and a `children` holder (it holds
 * blocks). Modelling that as one enum is what forced per-layer special cases in
 * the pre-0010 chrome.
 */
export interface NodeDescriptor {
  /** The node occupies a position in a parent's ordered list — enables move and
   *  delete, and supplies the bounds so the chrome can disable the ends. */
  ordered?: { index: number; count: number };
  /** The node holds an ordered list — enables add. `count: 0` is what drives the
   *  "add the first one" affordance, at every depth. */
  children?: { count: number };
  /** The node has an inspector — enables the wrench. */
  fields?: boolean;
  /**
   * Which ring/toolbar palette to draw. The chrome maps this to a CSS class and
   * has no opinion beyond that, so ADR 0010 Phase B can key it off a node's
   * SOURCE (shared / external) purely by changing what the editor returns here.
   */
  tone?: NodeTone;
  /** Shown in the toolbar's accessible name, e.g. "Hero". */
  label?: string;
}

/** Ring/toolbar palettes. `section`/`block`/`value` preserve the pre-0010 orange /
 *  blue / violet; Phase B adds `shared` (green) and `external` (yellow). */
export type NodeTone = "section" | "block" | "value" | "shared" | "external";

/** Resolve a parsed path to what that node can do, or `null` if the path
 *  addresses nothing the editor knows about (a stale or hand-written marker). */
export type ResolveNode = (path: NodePath) => NodeDescriptor | null;

/** The marked node element nearest `node` (or `node` itself), with its parsed
 *  path — the deepest-boundary-wins lookup, now over one attribute instead of a
 *  hand-ordered ladder. */
export function nodeAt(node: Node | null): { el: HTMLElement; path: NodePath } | null {
  const start = node instanceof Element ? node : (node?.parentElement ?? null);
  const el = start?.closest<HTMLElement>(`[${NODE_MARKER_ATTR}]`) ?? null;
  if (!el) return null;
  const path = parseNodePath(el.getAttribute(NODE_MARKER_ATTR));
  return path ? { el, path } : null;
}

/** Every marked node under `root`, in document order. */
export function readNodeMarkers(
  root: ParentNode = document,
): { el: HTMLElement; path: NodePath }[] {
  const out: { el: HTMLElement; path: NodePath }[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`[${NODE_MARKER_ATTR}]`)) {
    const path = parseNodePath(el.getAttribute(NODE_MARKER_ATTR));
    if (path) out.push({ el, path });
  }
  return out;
}

/** Re-stamp a node's marker (and every marked descendant) after its path changes
 *  — the one re-stamper that replaces `restampSection` + `restampBlock`.
 *
 *  Descendants are rewritten by PREFIX, so a block's fields follow its block, and
 *  a block follows its section, without any of them knowing their own depth. */
export function restampNode(el: HTMLElement, from: NodePath, to: NodePath): void {
  const fromStr = formatNodePath(from);
  const toStr = formatNodePath(to);
  if (fromStr === toStr) return;
  const rewrite = (target: HTMLElement): void => {
    const cur = target.getAttribute(NODE_MARKER_ATTR);
    if (cur === null) return;
    if (cur === fromStr) target.setAttribute(NODE_MARKER_ATTR, toStr);
    else if (cur.startsWith(`${fromStr}.`)) {
      target.setAttribute(NODE_MARKER_ATTR, `${toStr}${cur.slice(fromStr.length)}`);
    }
  };
  rewrite(el);
  for (const d of el.querySelectorAll<HTMLElement>(`[${NODE_MARKER_ATTR}]`)) rewrite(d);
}
