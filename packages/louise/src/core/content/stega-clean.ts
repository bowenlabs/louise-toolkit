// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Dependency-free stega stripping. Split out from `stega.ts` on purpose: the
// client save path must ALWAYS strip any steganographic payload before it
// persists a value (§ issue #23 "clean before save"), but must not drag in the
// optional `@vercel/stega` peer to do it. The character class below mirrors
// `@vercel/stega`'s own `VERCEL_STEGA_REGEX` verbatim — an invisible set of
// zero-width / format code points, only stripped in runs of 4+ (a real payload
// is always longer) so an incidental lone joiner in legit prose survives. The
// round-trip test (`stegaClean(stegaEncode(...)) === original`) fails loudly if
// `@vercel/stega` ever changes this set, so the copy can't silently drift.

// The exact code points `@vercel/stega` emits (its `VERCEL_STEGA_REGEX` set).
// Built via `new RegExp` from the list rather than a regex literal so the ZWJ
// (U+200D) in the class isn't flagged as a "misleading" joined-emoji sequence —
// each point is matched individually, which is what we want.
const STEGA_CODE_POINTS = [
  0x200b, 0x200c, 0x200d, 0x2062, 0x2063, 0x2060, 0xfeff, 0x2061, 0x1d173, 0x1d174, 0x1d175,
  0x1d176, 0x1d177, 0x1d178, 0x1d179, 0x1d17a,
];
const STEGA_RANGE = new RegExp(
  `[${STEGA_CODE_POINTS.map((c) => `\\u{${c.toString(16)}}`).join("")}]{4,}`,
  "gu",
);

/**
 * Remove any stega payload from a string, leaving the visible text untouched.
 * A no-op on strings that carry no payload, so it is safe to run on every value
 * on the save path unconditionally.
 */
export function stegaClean(value: string): string {
  return value.replace(STEGA_RANGE, "");
}
