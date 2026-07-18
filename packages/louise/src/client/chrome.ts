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
