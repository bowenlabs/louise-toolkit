import { describe, expect, it } from "vitest";
import { encodeQr, type QrMatrix } from "../../src/core/qr/encode.js";
import { qrDataUri, qrSvg } from "../../src/core/qr/svg.js";

// There is no independent QR implementation in this repo to diff against, and a
// subtly-wrong encoder produces codes that LOOK right and fail on a real phone.
// So the core test is a round trip: re-read the finished matrix the way a
// scanner does — recover the mask from the format bits, unmask, walk the same
// zigzag, de-interleave the blocks, and parse the byte-mode segment back out.
// That exercises data placement, masking, block splitting, interleaving and the
// format-info BCH together; anything misaligned in any of them fails to decode.

const ECC_FORMAT_BITS: Record<string, number> = { L: 1, M: 0, Q: 3, H: 2 };

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK: Record<string, number[]> = {
  L:[-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  M:[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
  Q:[-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  H:[-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
};
// prettier-ignore
const NUM_ECC_BLOCKS: Record<string, number[]> = {
  L:[-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
  M:[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
  Q:[-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
  H:[-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],
};

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

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Rebuild the function-module map so the decoder skips exactly what the
 *  encoder skipped. Derived independently from geometry, not shared with it. */
function functionMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const r: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) r[y]![x] = true;
  };
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx! + dx, cy! + dy);
  }
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const pos = alignmentPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const last = pos.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) mark(pos[i]! + dx, pos[j]! + dy);
    }
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return r;
}

/** Read the mask back out of format-info copy 1, validating its BCH code. */
function readMask(m: QrMatrix): number {
  let bits = 0;
  const read = (x: number, y: number, i: number) => {
    if (m.modules[y]![x]) bits |= 1 << i;
  };
  for (let i = 0; i <= 5; i++) read(8, i, i);
  read(8, 7, 6);
  read(8, 8, 7);
  read(7, 8, 8);
  for (let i = 9; i < 15; i++) read(14 - i, 8, i);

  const unmasked = bits ^ 0x5412;
  const data = unmasked >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  expect(((data << 10) | rem) ^ 0x5412, "format-info BCH must round-trip").toBe(bits);
  expect(data >>> 3, "format bits must encode the declared ECC level").toBe(ECC_FORMAT_BITS[m.ecc]);
  return data & 7;
}

/** Decode a matrix back to its payload the way a scanner would. */
function decodeQr(m: QrMatrix): string {
  const size = m.size;
  const fn = functionMap(m.version);
  const mask = readMask(m);
  expect(mask, "recovered mask must match the one the encoder chose").toBe(m.mask);

  // Unmask everything that isn't a function module.
  const grid = m.modules.map((row) => [...row]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!fn[y]![x] && MASKS[mask]!(x, y)) grid[y]![x] = !grid[y]![x];
    }
  }

  // Same two-column zigzag, back to interleaved codewords.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y]![x]) bits.push(grid[y]![x] ? 1 : 0);
      }
    }
  }
  const interleaved: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]!;
    interleaved.push(b);
  }

  // De-interleave: undo the column-major spread back into per-block data.
  const numBlocks = NUM_ECC_BLOCKS[m.ecc]![m.version]!;
  const eccLen = ECC_CODEWORDS_PER_BLOCK[m.ecc]![m.version]!;
  const rawCodewords = Math.floor(rawDataModules(m.version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks) - eccLen;

  const blocks: number[][] = Array.from({ length: numBlocks }, () => []);
  let k = 0;
  for (let i = 0; i <= shortLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < shortLen || b >= numShort) blocks[b]!.push(interleaved[k++]!);
    }
  }
  const data = blocks.flat();

  // Parse the byte-mode segment.
  const dataBits: number[] = [];
  for (const byte of data) for (let i = 7; i >= 0; i--) dataBits.push((byte >>> i) & 1);
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | dataBits.shift()!;
    return v;
  };
  expect(take(4), "mode indicator must be byte mode").toBe(0b0100);
  const length = take(m.version <= 9 ? 8 : 16);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = take(8);
  return new TextDecoder().decode(out);
}

describe("qr encode", () => {
  it("round-trips a merchant URL through the full pipeline", () => {
    const url = "https://store.themidwestartist.com";
    const m = encodeQr(url, { ecc: "Q" });
    expect(decodeQr(m)).toBe(url);
  });

  it("round-trips across every ECC level", () => {
    for (const ecc of ["L", "M", "Q", "H"] as const) {
      const url = "https://store.themidwestartist.com/t/abc123";
      expect(decodeQr(encodeQr(url, { ecc })), `ecc ${ecc}`).toBe(url);
    }
  });

  it("round-trips payload sizes that cross the version-7 and 16-bit-length boundaries", () => {
    // v1..v9 use an 8-bit character count; v10+ uses 16. v7+ adds version info
    // blocks. Both transitions are off-by-one magnets.
    for (const len of [1, 15, 40, 120, 300, 900]) {
      const payload = "x".repeat(len);
      const m = encodeQr(payload, { ecc: "M" });
      expect(decodeQr(m), `length ${len} (version ${m.version})`).toBe(payload);
    }
  });

  it("round-trips multi-byte UTF-8", () => {
    const s = "https://example.com/café-猫-🎨";
    expect(decodeQr(encodeQr(s, { ecc: "M" }))).toBe(s);
  });

  it("picks the smallest version that fits, and grows with the payload", () => {
    expect(encodeQr("hi", { ecc: "M" }).version).toBe(1);
    const small = encodeQr("x".repeat(20), { ecc: "M" }).version;
    const large = encodeQr("x".repeat(600), { ecc: "M" }).version;
    expect(large).toBeGreaterThan(small);
    // Stronger correction on identical data needs at least as much room.
    expect(encodeQr("x".repeat(100), { ecc: "H" }).version).toBeGreaterThanOrEqual(
      encodeQr("x".repeat(100), { ecc: "L" }).version,
    );
  });

  it("honours minVersion without corrupting the payload", () => {
    const m = encodeQr("short", { ecc: "M", minVersion: 10 });
    expect(m.version).toBeGreaterThanOrEqual(10);
    expect(decodeQr(m)).toBe("short");
  });

  it("emits the three finder patterns and the timing rows", () => {
    const m = encodeQr("https://example.com", { ecc: "M" });
    const dark = (x: number, y: number) => m.modules[y]![x];
    for (const [ox, oy] of [
      [0, 0],
      [m.size - 7, 0],
      [0, m.size - 7],
    ]) {
      // Ring dark, moat light, 3x3 core dark.
      expect(dark(ox! + 0, oy! + 0)).toBe(true);
      expect(dark(ox! + 1, oy! + 1)).toBe(false);
      expect(dark(ox! + 3, oy! + 3)).toBe(true);
    }
    // Timing patterns alternate, starting dark at the even index.
    for (let i = 8; i < m.size - 8; i++) {
      expect(dark(6, i), `vertical timing @${i}`).toBe(i % 2 === 0);
      expect(dark(i, 6), `horizontal timing @${i}`).toBe(i % 2 === 0);
    }
  });

  it("sizes the matrix as 4·version + 17", () => {
    for (const v of [1, 7, 10, 40]) {
      const m = encodeQr("x".repeat(4), { ecc: "L", minVersion: v });
      expect(m.size).toBe(m.version * 4 + 17);
    }
  });

  it("throws only when the payload cannot fit version 40", () => {
    expect(() => encodeQr("x".repeat(3000), { ecc: "H" })).toThrow(/exceeds version 40/);
  });
});

describe("qr svg", () => {
  it("emits one merged path rather than a rect per module", () => {
    const svg = qrSvg("https://store.themidwestartist.com");
    expect(svg.match(/<path/g)).toHaveLength(1);
    // A rect-per-module rendering would be hundreds; only the background is one.
    expect(svg.match(/<rect/g) ?? []).toHaveLength(1);
  });

  it("includes the 4-module quiet zone in the viewBox", () => {
    const m = encodeQr("hello", { ecc: "M" });
    const svg = qrSvg("hello", { ecc: "M" });
    expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
    expect(qrSvg("hello", { ecc: "M", margin: 0 })).toContain(`viewBox="0 0 ${m.size} ${m.size}"`);
  });

  it("omits the background when light is null, and sizes only when asked", () => {
    expect(qrSvg("x", { light: null })).not.toContain("<rect");
    // Only the <svg> tag itself should be unsized — it scales with its
    // container. The background <rect> legitimately carries width/height.
    const svgTag = (s: string) => s.slice(0, s.indexOf(">") + 1);
    expect(svgTag(qrSvg("x"))).not.toContain("width=");
    expect(svgTag(qrSvg("x", { size: 512 }))).toContain('width="512" height="512"');
  });

  it("escapes a title and marks it up accessibly", () => {
    const svg = qrSvg("x", { title: 'Ben & Jerry’s <"shop">' });
    expect(svg).toContain("<title>Ben &amp; Jerry’s &lt;&quot;shop&quot;&gt;</title>");
    expect(svg).toContain('role="img"');
  });

  it("produces a decodable data URI", () => {
    const uri = qrDataUri("https://example.com");
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(uri.slice("data:image/svg+xml,".length))).toContain("<svg");
  });
});
