// Unit coverage for the grammar checker's offset math (#110): Harper reports
// code-point spans into a block's text; these map to UTF-16 and then to
// ProseMirror doc positions. No WASM worker involved — pure functions.

import { describe, expect, it } from "vitest";
import {
  type BlockText,
  blockMatchesToDecorations,
  codePointToUtf16,
  type GrammarMatch,
} from "../../src/client/grammar/offsets.js";

const match = (start: number, end: number, text = "a"): GrammarMatch => ({
  start,
  end,
  message: "issue",
  kind: "Spelling",
  suggestions: [{ text, kind: "replace" }],
});

describe("codePointToUtf16", () => {
  it("is identity for BMP (single-unit) text", () => {
    expect(codePointToUtf16("hello", 0)).toBe(0);
    expect(codePointToUtf16("hello", 2)).toBe(2);
    expect(codePointToUtf16("hello", 5)).toBe(5);
  });

  it("accounts for astral characters (a code point that is two UTF-16 units)", () => {
    // "a😀b": code points a(0) 😀(1) b(2); 😀 is one code point, two UTF-16 units.
    const t = "a😀b";
    expect(codePointToUtf16(t, 0)).toBe(0);
    expect(codePointToUtf16(t, 1)).toBe(1); // start of the emoji
    expect(codePointToUtf16(t, 2)).toBe(3); // after the emoji (1 + 2 units)
    expect(codePointToUtf16(t, 3)).toBe(4); // after "b"
  });

  it("clamps a negative or past-the-end index", () => {
    expect(codePointToUtf16("hi", -1)).toBe(0);
    expect(codePointToUtf16("hi", 99)).toBe(2);
  });
});

describe("blockMatchesToDecorations", () => {
  it("maps a span to doc positions (block.pos + 1 + utf16 offset)", () => {
    // "This is an test": the malapropism "an" is code points [8, 10).
    const block: BlockText = { pos: 0, text: "This is an test" };
    const [dec] = blockMatchesToDecorations([{ block, matches: [match(8, 10, "a")] }]);
    expect(dec).toMatchObject({ from: 9, to: 11 });
    expect(dec.match.suggestions[0].text).toBe("a");
  });

  it("offsets each block by its own position", () => {
    const first: BlockText = { pos: 0, text: "teh cat" }; // "teh" [0,3)
    const second: BlockText = { pos: 20, text: "teh dog" }; // "teh" [0,3)
    const decs = blockMatchesToDecorations([
      { block: first, matches: [match(0, 3, "the")] },
      { block: second, matches: [match(0, 3, "the")] },
    ]);
    expect(decs.map((d) => [d.from, d.to])).toEqual([
      [1, 4],
      [21, 24],
    ]);
  });

  it("maps spans correctly across an astral character", () => {
    // "😀 teh": "teh" starts at code point 2, UTF-16 index 3.
    const block: BlockText = { pos: 0, text: "😀 teh" };
    const [dec] = blockMatchesToDecorations([{ block, matches: [match(2, 5, "the")] }]);
    // base 1 + utf16(2)=3 → from 4 ; utf16(5)=6 → to 7
    expect(dec).toMatchObject({ from: 4, to: 7 });
  });

  it("drops empty ranges", () => {
    const block: BlockText = { pos: 0, text: "hello" };
    expect(blockMatchesToDecorations([{ block, matches: [match(2, 2)] }])).toEqual([]);
  });
});
