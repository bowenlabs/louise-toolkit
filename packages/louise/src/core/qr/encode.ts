// A QR Code encoder (ISO/IEC 18004), byte mode.
//
// Vendored rather than depended on. `louise-toolkit` ships with ZERO runtime
// dependencies, and the obvious candidates would each cost more than they save:
// `qrcode` drags in pngjs plus Node `Buffer`/`fs` assumptions that don't hold in
// a Worker, and `qrcode-svg` is unmaintained CommonJS. QR is also a frozen spec —
// 18004 hasn't moved meaningfully since 2006 — so this is one of the few things
// where vendoring has no upgrade treadmill and no supply-chain surface. The same
// argument the codebase already makes for `core/browser/og-card.ts` (hand-rolled
// SVG) and `core/media/dimensions.ts` (hand-rolled header sniffing).
//
// BYTE MODE ONLY, deliberately. Everything this encodes is a URL: mixed case, so
// alphanumeric mode can never apply, and numeric/kanji would be dead code.

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** Modules per side (21..177). Excludes the quiet zone. */
  size: number;
  /** `[row][col]`, true = dark. */
  modules: boolean[][];
  /** 1..40. */
  version: number;
  ecc: QrErrorCorrection;
  /** The mask pattern (0..7) chosen by penalty scoring. */
  mask: number;
}

// ── Spec tables ──────────────────────────────────────────────────────────────
// Indexed [eccIndex][version]; index 0 is unused padding so `version` indexes
// directly. These two are the only values that can't be derived from geometry.

const ECC_ORDER: QrErrorCorrection[] = ["L", "M", "Q", "H"];

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  // L
  [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  // M
  [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
  // Q
  [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  // H
  [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
];

// prettier-ignore
const NUM_ECC_BLOCKS: number[][] = [
  // L
  [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
  // M
  [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
  // Q
  [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
  // H
  [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],
];

/** Format-info encoding of each ECC level (NOT its index in ECC_ORDER). */
const ECC_FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

// ── GF(256) ──────────────────────────────────────────────────────────────────
// Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), per the spec.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;

/** Reed–Solomon generator polynomial of the given degree, as coefficients. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j]!, 1);
      next[j + 1] ^= gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** The `degree` error-correction codewords for one data block. */
function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0]!;
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(gen[i + 1]!, factor);
  }
  return result;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Total data+ECC modules for a version, before function patterns are removed. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Usable data codewords (total capacity minus every block's ECC). */
function dataCodewords(version: number, ecc: QrErrorCorrection): number {
  const e = ECC_ORDER.indexOf(ecc);
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[e]![version]! * NUM_ECC_BLOCKS[e]![version]!
  );
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Byte mode's character-count indicator width widens with version. */
const charCountBits = (version: number): number => (version <= 9 ? 8 : 16);

// ── Bit buffer ───────────────────────────────────────────────────────────────

class BitBuffer {
  readonly bits: number[] = [];
  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * Encode `data` as a QR matrix.
 *
 * Throws only when the payload cannot fit version 40 at the chosen ECC level —
 * roughly 1.2KB even at H, far beyond any URL.
 */
export function encodeQr(
  data: string,
  options: { ecc?: QrErrorCorrection; minVersion?: number } = {},
): QrMatrix {
  const ecc = options.ecc ?? "M";
  const bytes = new TextEncoder().encode(data);

  // Smallest version that fits, so the code stays as coarse (and as scannable
  // from a distance / at an angle) as the payload allows.
  let version = Math.max(1, Math.min(40, options.minVersion ?? 1));
  for (; version <= 40; version++) {
    const capacity = dataCodewords(version, ecc) * 8;
    if (4 + charCountBits(version) + bytes.length * 8 <= capacity) break;
  }
  if (version > 40) {
    throw new Error(`QR: ${bytes.length} bytes exceeds version 40 at ECC ${ecc}`);
  }

  const capacityBits = dataCodewords(version, ecc) * 8;
  const bb = new BitBuffer();
  bb.append(0b0100, 4); // byte mode
  bb.append(bytes.length, charCountBits(version));
  for (const b of bytes) bb.append(b, 8);

  // Terminator, then pad to a byte boundary, then the spec's alternating pad.
  bb.append(0, Math.min(4, capacityBits - bb.bits.length));
  bb.append(0, (8 - (bb.bits.length % 8)) % 8);
  for (let pad = 0xec; bb.bits.length < capacityBits; pad ^= 0xec ^ 0x11) bb.append(pad, 8);

  const dataBytes = new Uint8Array(bb.bits.length / 8);
  bb.bits.forEach((bit, i) => {
    if (bit) dataBytes[i >>> 3]! |= 0x80 >>> (i & 7);
  });

  return buildMatrix(interleave(dataBytes, version, ecc), version, ecc);
}

/** Split into blocks, append each block's ECC, then interleave per the spec. */
function interleave(data: Uint8Array, version: number, ecc: QrErrorCorrection): Uint8Array {
  const e = ECC_ORDER.indexOf(ecc);
  const numBlocks = NUM_ECC_BLOCKS[e]![version]!;
  const eccLen = ECC_CODEWORDS_PER_BLOCK[e]![version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks) - eccLen;

  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const block = data.subarray(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, eccLen));
  }

  const result = new Uint8Array(rawCodewords);
  let k = 0;
  // Data codewords, column-major across blocks; short blocks skip the last row.
  for (let i = 0; i <= shortLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < shortLen || b >= numShort) result[k++] = dataBlocks[b]![i]!;
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (let b = 0; b < numBlocks; b++) result[k++] = eccBlocks[b]![i]!;
  }
  return result;
}

// ── Matrix ───────────────────────────────────────────────────────────────────

function buildMatrix(codewords: Uint8Array, version: number, ecc: QrErrorCorrection): QrMatrix {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  // Function modules must not receive data and must not be masked.
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    reserved[y]![x] = true;
  };

  // Finder patterns + separators.
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d <= 3);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns, skipping the three finder corners.
  const positions = alignmentPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const last = positions.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const cx = positions[i]!;
      const cy = positions[j]!;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Dark module + reserve the format areas before data placement.
  set(8, size - 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[i]![8]) set(8, i, false);
    if (!reserved[8]![i]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8]![size - 1 - i]) set(size - 1 - i, 8, false);
    if (!reserved[size - 1 - i]![8]) set(8, size - 1 - i, false);
  }

  // Version info (7+), bottom-left and top-right blocks.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Data placement: two-column zigzag from the bottom-right, skipping column 6.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y]![x]) continue;
        modules[y]![x] =
          bitIndex < codewords.length * 8 &&
          ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex++;
      }
    }
  }

  // Try all 8 masks and keep the lowest-penalty one. Fixing a mask would save
  // ~60 lines and produce codes some scanners refuse — a failure you'd hear
  // about from a shop, not from CI.
  let best = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, reserved, mask);
    writeFormatBits(modules, reserved, ecc, mask, size);
    const penalty = penaltyScore(modules, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = mask;
    }
    applyMask(modules, reserved, mask); // XOR is its own inverse
  }
  applyMask(modules, reserved, best);
  writeFormatBits(modules, reserved, ecc, best, size);

  return { size, modules, version, ecc, mask: best };
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(modules: boolean[][], reserved: boolean[][], mask: number): void {
  const fn = MASKS[mask]!;
  for (let y = 0; y < modules.length; y++) {
    for (let x = 0; x < modules.length; x++) {
      if (!reserved[y]![x] && fn(x, y)) modules[y]![x] = !modules[y]![x];
    }
  }
}

function writeFormatBits(
  modules: boolean[][],
  reserved: boolean[][],
  ecc: QrErrorCorrection,
  mask: number,
  size: number,
): void {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const put = (x: number, y: number, bit: boolean) => {
    modules[y]![x] = bit;
    reserved[y]![x] = true;
  };
  // Copy 1, around the top-left finder.
  for (let i = 0; i <= 5; i++) put(8, i, ((bits >>> i) & 1) === 1);
  put(8, 7, ((bits >>> 6) & 1) === 1);
  put(8, 8, ((bits >>> 7) & 1) === 1);
  put(7, 8, ((bits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) put(14 - i, 8, ((bits >>> i) & 1) === 1);
  // Copy 2, split across the other two finders.
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, ((bits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, ((bits >>> i) & 1) === 1);
  put(8, size - 8, true); // the always-dark module
}

/** The spec's four penalty rules; lower is better. */
function penaltyScore(m: boolean[][], size: number): number {
  let score = 0;

  // Rule 1 — runs of 5+ identical modules, both directions.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const cur = horizontal ? m[i]![j]! : m[j]![i]!;
        const prev = horizontal ? m[i]![j - 1]! : m[j - 1]![i]!;
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2 — 2x2 blocks of one color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y]![x]!;
      if (v === m[y]![x + 1] && v === m[y + 1]![x] && v === m[y + 1]![x + 1]) score += 3;
    }
  }

  // Rule 3 — finder-lookalike 1011101 with 4 light modules on either side.
  const PATTERN = [true, false, true, true, true, false, true];
  const hasAt = (i: number, j: number, horizontal: boolean, offset: number): boolean => {
    for (let k = 0; k < 7; k++) {
      const p = j + offset + k;
      if (p < 0 || p >= size) return false;
      if ((horizontal ? m[i]![p]! : m[p]![i]!) !== PATTERN[k]!) return false;
    }
    for (let k = 1; k <= 4; k++) {
      const p = offset === 0 ? j + 7 + k - 1 : j - k;
      if (p < 0 || p >= size) continue;
      if (horizontal ? m[i]![p]! : m[p]![i]!) return false;
    }
    return true;
  };
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      for (const horizontal of [true, false]) {
        if (hasAt(i, j, horizontal, 0)) score += 40;
      }
    }
  }

  // Rule 4 — deviation from a 50/50 dark ratio.
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}
