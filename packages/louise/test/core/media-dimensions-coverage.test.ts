// core/media/dimensions—header parsing edge cases per format: WebP VP8L,
// JPEG marker walking, ISOBMFF box sizes, and TIFF IFDs (#695).
import { describe, expect, it } from "vitest";
import { imageDimensions, imageInfo } from "../../src/core/media/dimensions.js";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

// --- WebP ------------------------------------------------------------------

/** A 30-byte WebP header with the given chunk fourcc. */
function webp(fourcc: string, patch: (b: Uint8Array) => void = () => undefined) {
  const b = new Uint8Array(30);
  b.set(ascii("RIFF"), 0);
  b.set(ascii("WEBP"), 8);
  b.set(ascii(fourcc), 12);
  patch(b);
  return b;
}

describe("imageDimensions: WebP", () => {
  it("reads a lossless VP8L size from its packed 14-bit fields", () => {
    // width-1 = 399 and height-1 = 299, packed LSB-first after the 0x2f byte.
    const w = 399;
    const h = 299;
    const bits = w | (h << 14);
    const b = webp("VP8L", (x) => {
      x[20] = 0x2f;
      x.set([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff], 21);
    });
    expect(imageDimensions(b)).toEqual({ width: 400, height: 300 });
  });

  it("rejects a VP8L chunk without its signature byte", () => {
    expect(imageDimensions(webp("VP8L"))).toBeNull();
  });

  it("rejects a lossy VP8 chunk without the keyframe start code", () => {
    expect(imageDimensions(webp("VP8 "))).toBeNull();
  });

  it("rejects an unknown chunk, a RIFF that isn't WebP, and a short buffer", () => {
    expect(imageDimensions(webp("ALPH"))).toBeNull();
    const avi = webp("VP8X");
    avi.set(ascii("AVI "), 8);
    expect(imageDimensions(avi)).toBeNull();
    expect(imageDimensions(webp("VP8X").slice(0, 29))).toBeNull();
  });
});

// --- JPEG ------------------------------------------------------------------

describe("imageDimensions: JPEG", () => {
  const sof = (marker: number, h: number, w: number) => [
    0xff,
    marker,
    0x00,
    0x11,
    0x08,
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    0x03,
  ];

  it("skips fill bytes, standalone markers, and a DHT segment before a progressive SOF2", () => {
    const b = new Uint8Array([
      0xff,
      0xd8,
      0x00, // stray byte between markers
      0xff,
      0xd0, // RST0, no length
      0xff,
      0x01, // TEM, no length
      0xff,
      0xc4,
      0x00,
      0x04,
      0x00,
      0x00, // DHT with a 4-byte length, not a SOF
      ...sof(0xc2, 1080, 1920),
    ]);
    expect(imageDimensions(b)).toEqual({ width: 1920, height: 1080 });
  });

  it("gives up on a segment whose length is under 2", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, ...sof(0xc0, 10, 10)]);
    expect(imageDimensions(b)).toBeNull();
  });

  it("returns null when no SOF appears before the data ends", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0, 0, 0, 0]);
    expect(imageDimensions(b)).toBeNull();
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

// --- AVIF / HEIF -----------------------------------------------------------

const box = (type: string, body: number[]) => [...u32be(8 + body.length), ...ascii(type), ...body];
const ftyp = box("ftyp", [...ascii("avif"), 0, 0, 0, 0]);
const ispe = (w: number, h: number) => box("ispe", [0, 0, 0, 0, ...u32be(w), ...u32be(h)]);
const metaWith = (ipcoBody: number[]) =>
  box("meta", [0, 0, 0, 0, ...box("iprp", box("ipco", ipcoBody))]);

describe("imageDimensions: AVIF/HEIF", () => {
  it("walks past sibling boxes, a 64-bit largesize box, and a short ispe", () => {
    // A `hdlr` sibling before `iprp`, and in `ipco` a too-short `ispe` plus a
    // `pixi` property written with the 64-bit largesize header.
    const pixiBody = [0, 0, 0, 0, 3, 8, 8, 8];
    const pixiLarge = [
      0,
      0,
      0,
      1,
      ...ascii("pixi"),
      ...u32be(0),
      ...u32be(16 + pixiBody.length),
      ...pixiBody,
    ];
    const shortIspe = box("ispe", [0, 0, 0, 0, 0, 0, 0, 1]);
    const hdlr = box("hdlr", [0, 0, 0, 0, ...ascii("pict")]);
    const meta = box("meta", [
      0,
      0,
      0,
      0,
      ...hdlr,
      ...box("iprp", box("ipco", [...shortIspe, ...pixiLarge, ...ispe(640, 480)])),
    ]);
    expect(imageDimensions(new Uint8Array([...ftyp, ...meta]))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads a final box with size 0, which runs to the end of the data", () => {
    const zeroSized = [
      0,
      0,
      0,
      0,
      ...ascii("meta"),
      0,
      0,
      0,
      0,
      ...box("iprp", box("ipco", ispe(12, 34))),
    ];
    expect(imageDimensions(new Uint8Array([...ftyp, ...zeroSized]))).toEqual({
      width: 12,
      height: 34,
    });
  });

  it("keeps the larger ispe when a smaller one follows it", () => {
    const b = new Uint8Array([...ftyp, ...metaWith([...ispe(2000, 1000), ...ispe(100, 50)])]);
    expect(imageDimensions(b)).toEqual({ width: 2000, height: 1000 });
  });

  it("returns null when iprp, ipco, or a non-zero ispe is missing", () => {
    const noIprp = box("meta", [0, 0, 0, 0, ...box("hdlr", [0, 0, 0, 0])]);
    expect(imageDimensions(new Uint8Array([...ftyp, ...noIprp]))).toBeNull();
    const noIpco = box("meta", [0, 0, 0, 0, ...box("iprp", box("ipma", [0, 0, 0, 0]))]);
    expect(imageDimensions(new Uint8Array([...ftyp, ...noIpco]))).toBeNull();
    expect(imageDimensions(new Uint8Array([...ftyp, ...metaWith(ispe(0, 480))]))).toBeNull();
  });

  it("stops at a malformed box instead of reading past the data", () => {
    // A largesize header whose high word is set, and a box that overruns.
    const badLarge = [0, 0, 0, 1, ...ascii("meta"), ...u32be(1), ...u32be(0)];
    expect(imageDimensions(new Uint8Array([...ftyp, ...badLarge]))).toBeNull();
    const overrun = [...u32be(4096), ...ascii("meta"), 0, 0, 0, 0];
    expect(imageDimensions(new Uint8Array([...ftyp, ...overrun]))).toBeNull();
    const truncatedLarge = [0, 0, 0, 1, ...ascii("meta"), 0, 0];
    expect(imageDimensions(new Uint8Array([...ftyp, ...truncatedLarge]))).toBeNull();
    const tooSmall = [...u32be(4), ...ascii("meta")];
    expect(imageDimensions(new Uint8Array([...ftyp, ...tooSmall]))).toBeNull();
  });
});

// --- TIFF ------------------------------------------------------------------

describe("imageDimensions: TIFF", () => {
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const entry = (tag: number, value: number) => [
    ...le16(tag),
    ...le16(4),
    ...le32(1),
    ...le32(value),
  ];
  const header = (ifd = 8) => [0x49, 0x49, ...le16(42), ...le32(ifd)];

  it("skips unrelated tags before the size tags", () => {
    const b = new Uint8Array([
      ...header(),
      ...le16(3),
      ...entry(0x0103, 1), // Compression
      ...entry(0x0101, 200), // ImageLength first
      ...entry(0x0100, 300),
    ]);
    expect(imageDimensions(b)).toEqual({ width: 300, height: 200 });
  });

  it("returns null for a wrong magic number, an IFD past the end, or a missing tag", () => {
    expect(imageDimensions(new Uint8Array([0x49, 0x49, ...le16(43), ...le32(8)]))).toBeNull();
    expect(imageDimensions(new Uint8Array(header(64)))).toBeNull();
    expect(
      imageDimensions(new Uint8Array([...header(), ...le16(1), ...entry(0x0100, 300)])),
    ).toBeNull();
  });

  it("stops reading entries that the data truncates", () => {
    const b = new Uint8Array([...header(), ...le16(5), ...entry(0x0100, 300)]);
    expect(imageDimensions(b)).toBeNull();
  });

  it("rejects a short buffer and a byte-order mark it doesn't know", () => {
    expect(imageDimensions(new Uint8Array([0x49, 0x49, 42, 0]))).toBeNull();
    expect(imageDimensions(new Uint8Array([0x49, 0x4d, ...le16(42), ...le32(8)]))).toBeNull();
  });
});

// --- imageInfo -------------------------------------------------------------

describe("imageInfo", () => {
  const binding = (info: unknown) =>
    ({
      info: async (stream: ReadableStream) => (await new Response(stream).arrayBuffer(), info),
    }) as unknown as ImagesBinding;

  it("accepts an ArrayBuffer", async () => {
    const out = await imageInfo(binding({ width: 10, height: 20 }), new Uint8Array([1, 2]).buffer);
    expect(out).toEqual({ width: 10, height: 20 });
  });

  it("returns null for a zero-sized raster answer", async () => {
    expect(await imageInfo(binding({ width: 0, height: 20 }), new Uint8Array([1]))).toBeNull();
    expect(await imageInfo(binding({ width: 20, height: 0 }), new Uint8Array([1]))).toBeNull();
  });
});
