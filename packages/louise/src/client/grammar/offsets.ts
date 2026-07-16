// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The pure offset math for the grammar checker (#110): map Harper's per-block
// spans onto ProseMirror document positions. Harper reports each issue as a span
// of CODE-POINT offsets into the text of a single block; ProseMirror positions
// count UTF-16 units and step through node boundaries. Keeping this conversion
// here — free of any `harper.js` or ProseMirror-view types — makes the tricky part
// (code point → UTF-16 → doc position) unit-testable without a WASM worker.

import type { Node as PMNode } from "@prosekit/pm/model";

/** How a suggestion changes the matched span. */
export type GrammarSuggestionKind = "replace" | "remove" | "insertAfter";

/** A single click-to-apply fix for a match. `text` is "" for a deletion. */
export interface GrammarSuggestion {
  text: string;
  kind: GrammarSuggestionKind;
}

/**
 * A normalized grammar/spelling issue — transport-neutral (no `harper.js` types
 * cross this boundary). `start`/`end` are CODE-POINT offsets into a block's
 * `textContent`; the linter wrapper extracts these off the WASM `Lint` so nothing
 * downstream holds WASM memory.
 */
export interface GrammarMatch {
  start: number;
  end: number;
  message: string;
  /** Harper's lint kind (e.g. "Spelling", "Agreement") — drives styling/labels. */
  kind: string;
  suggestions: GrammarSuggestion[];
}

/** A textblock's document position (the position *before* the node) + its text. */
export interface BlockText {
  pos: number;
  text: string;
}

/** A resolved decoration range in the document, with its source match. */
export interface GrammarDecoration {
  from: number;
  to: number;
  match: GrammarMatch;
}

/**
 * Convert a code-point index into `text` to its UTF-16 (JS string) index. Harper
 * spans are code-point offsets; JS strings and ProseMirror positions are UTF-16.
 * For BMP text the two coincide; this stays correct across astral characters
 * (emoji), where one code point is two UTF-16 units. An index at/after the end
 * clamps to the string's length.
 */
export function codePointToUtf16(text: string, codePoint: number): number {
  if (codePoint <= 0) return 0;
  let seen = 0;
  let utf16 = 0;
  for (const ch of text) {
    if (seen === codePoint) return utf16;
    utf16 += ch.length; // 1 for a BMP char, 2 for an astral pair
    seen += 1;
  }
  return utf16;
}

/**
 * Map each block's matches (code-point spans into that block's text) to document
 * ranges. A character at code-point offset `s` in a text-only block sits at doc
 * position `block.pos + 1 + utf16(s)` — the `+ 1` steps inside the block node.
 * Empty ranges (`to <= from`) are dropped. NOTE: assumes text-only textblocks;
 * inline atoms (images, hard breaks) inside a block would shift positions and are
 * a known limitation for v1.
 */
export function blockMatchesToDecorations(
  blocks: { block: BlockText; matches: GrammarMatch[] }[],
): GrammarDecoration[] {
  const out: GrammarDecoration[] = [];
  for (const { block, matches } of blocks) {
    const base = block.pos + 1;
    for (const match of matches) {
      const from = base + codePointToUtf16(block.text, match.start);
      const to = base + codePointToUtf16(block.text, match.end);
      if (to > from) out.push({ from, to, match });
    }
  }
  return out;
}

/**
 * Gather every non-empty textblock (a leaf block with inline content, e.g. a
 * paragraph or heading) and its plain text. Does not descend into a textblock's
 * inline content, so each block is linted once against its own `textContent`.
 */
export function gatherTextBlocks(doc: PMNode): BlockText[] {
  const blocks: BlockText[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const text = node.textContent;
      if (text.length > 0) blocks.push({ pos, text });
      return false;
    }
    return true;
  });
  return blocks;
}
