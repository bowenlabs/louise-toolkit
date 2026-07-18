// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/media — intrinsic image dimensions from the file header.
//
// Reads width/height out of the leading bytes without decoding the pixels, so an
// upload can record its dimensions cheaply on a Worker (no image library). Pairs
// with `sniffImageType`: the same magic bytes that identify the format also tell
// us where the size lives. Covers PNG, GIF, WebP, JPEG, plus the box-structured
// AVIF/HEIF (`ispe`) and TIFF (IFD) formats; returns `null` for anything it can't
// read confidently so `width`/`height` stay honestly "when known".

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Wrap raw bytes as a `ReadableStream` for the Images binding, which takes a
 *  stream (not a buffer). */
function bytesToStream(bytes: Uint8Array | ArrayBuffer): ReadableStream<Uint8Array> {
  return new Blob([bytes as BufferSource]).stream() as ReadableStream<Uint8Array>;
}

/**
 * Read intrinsic pixel dimensions via the Cloudflare Images binding's `.info()`,
 * a real decode that sizes every raster format robustly (and applies EXIF
 * orientation). Returns `null` for vector input (SVG, which has no intrinsic
 * pixel size) or on any Images error, so a caller can fall back to
 * {@link imageDimensions} (the binding-free header parser, which now also covers
 * AVIF/HEIF and TIFF). Prefer this in the upload path when an `IMAGES` binding is
 * available; it's the authoritative path, the header parser the lightweight
 * fallback.
 */
export async function imageInfo(
  images: ImagesBinding,
  bytes: Uint8Array | ArrayBuffer,
): Promise<ImageDimensions | null> {
  try {
    const info = await images.info(bytesToStream(bytes));
    // The SVG variant of the response has no width/height; only the raster
    // variant carries them. Guard on the field, then on a sane (non-zero) size.
    if ("width" in info && info.width > 0 && info.height > 0) {
      return { width: info.width, height: info.height };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse intrinsic pixel dimensions from an image's header bytes (PNG, GIF,
 * JPEG, WebP, AVIF/HEIF, TIFF). Pass enough of the file to include the header —
 * the first few KB is always plenty; the whole buffer is fine. Returns `null`
 * when the size can't be read (unsupported format, or a truncated/odd header).
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const d = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes) ?? avif(bytes) ?? tiff(bytes);
  // A valid image is never 0-sized; treat a zero (truncated/odd header) as
  // unknown rather than persisting a bogus 0×N.
  return d && d.width > 0 && d.height > 0 ? d : null;
}

// PNG: 8-byte signature, then the IHDR chunk — 4-byte length, "IHDR", then
// width and height as big-endian u32 at offsets 16 and 20.
function png(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

// GIF: "GIF87a"/"GIF89a", then logical-screen width/height as little-endian u16
// at offsets 6 and 8.
function gif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

// WebP: "RIFF"…"WEBP", then a chunk fourcc at offset 12 — VP8 (lossy), VP8L
// (lossless), or VP8X (extended), each packing the size differently.
function webp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  const isRiff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  const isWebp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (!isRiff || !isWebp) return null;
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);

  if (fourcc === "VP8 ") {
    // Lossy keyframe: start code 0x9d 0x01 0x2a at 23, then two 14-bit sizes.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      width: u16le(b, 26) & 0x3fff,
      height: u16le(b, 28) & 0x3fff,
    };
  }
  if (fourcc === "VP8L") {
    // Lossless: 0x2f signature at 20, then 14-bit width-1 / 14-bit height-1.
    if (b[20] !== 0x2f) return null;
    const b0 = b[21]!;
    const b1 = b[22]!;
    const b2 = b[23]!;
    const b3 = b[24]!;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit canvas width-1 / height-1 (little-endian) at offset 24.
    return {
      width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
      height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
    };
  }
  return null;
}

// JPEG: walk the marker segments from offset 2 to the first Start-Of-Frame
// (SOF0/1/2/…, excluding the non-SOF C4/C8/CC), which carries height then width
// as big-endian u16 after a 1-byte precision.
function jpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = b[pos + 1]!;
    // SOF markers 0xC0–0xCF except 0xC4 (DHT), 0xC8 (JPG), 0xCC (DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, pos + 5), width: u16be(b, pos + 7) };
    }
    // Standalone markers (RSTn/SOI/EOI/TEM) carry no length payload.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const segLen = u16be(b, pos + 2);
    if (segLen < 2) return null;
    pos += 2 + segLen;
  }
  return null;
}

// AVIF / HEIF (ISO base media / box format): the pixel size lives in an `ispe`
// (image spatial extents) property, nested meta → iprp → ipco → ispe. Walk the
// box tree to it rather than scanning for the "ispe" fourcc (which could collide
// with payload bytes). A file may carry several `ispe` boxes (e.g. a thumbnail
// alongside the primary image); take the largest by area — the full-resolution
// one — without resolving the full pitm/ipma item graph. Best-effort: returns
// `null` if the structure isn't found.
function avif(b: Uint8Array): ImageDimensions | null {
  // Cheap guard: an ISOBMFF file opens with an `ftyp` box (type at offset 4).
  // The brand ("avif"/"heic"/"mif1"/…) isn't checked — the `ispe` walk is the
  // real test, and it covers every ftyp brand that carries one.
  if (b.length < 12 || b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70)
    return null;
  const meta = firstBox(b, 0, b.length, "meta");
  if (!meta) return null;
  // `meta` is a FullBox: skip its 4-byte version+flags to reach child boxes.
  const iprp = firstBox(b, meta.start + 4, meta.end, "iprp");
  if (!iprp) return null;
  const ipco = firstBox(b, iprp.start, iprp.end, "ipco");
  if (!ipco) return null;
  let best: ImageDimensions | null = null;
  for (const box of boxes(b, ipco.start, ipco.end)) {
    if (box.type !== "ispe" || box.end - box.start < 12) continue;
    // `ispe` is a FullBox: width/height are big-endian u32 after version+flags.
    const width = u32be(b, box.start + 4);
    const height = u32be(b, box.start + 8);
    if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) {
      best = { width, height };
    }
  }
  return best;
}

/** An ISOBMFF box's fourcc `type` and its content byte range `[start, end)`. */
interface Box {
  type: string;
  start: number;
  end: number;
}

// Iterate the ISOBMFF boxes in `[from, to)`, yielding each box's type and content
// range. Handles the 32-bit size, the 64-bit `largesize` escape (size === 1) and
// size === 0 (box runs to the end). Stops on a malformed/overrunning box.
function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let p = from;
  while (p + 8 <= to) {
    let size = u32be(b, p);
    const type = String.fromCharCode(b[p + 4]!, b[p + 5]!, b[p + 6]!, b[p + 7]!);
    let header = 8;
    if (size === 1) {
      // 64-bit largesize. We only address bytes within a Uint8Array (< 2^32), so
      // the high word must be zero; read the low word as the size.
      if (p + 16 > to || u32be(b, p + 8) !== 0) return;
      size = u32be(b, p + 12);
      header = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < header || p + size > to) return;
    yield { type, start: p + header, end: p + size };
    p += size;
  }
}

/** The first box of `type` in `[from, to)`, or `null`. */
function firstBox(b: Uint8Array, from: number, to: number, type: string): Box | null {
  for (const box of boxes(b, from, to)) if (box.type === type) return box;
  return null;
}

// TIFF: an "II" (little-endian) or "MM" (big-endian) byte-order mark, the magic
// 42, then the offset to the first IFD. Read ImageWidth (tag 0x0100) and
// ImageLength (tag 0x0101) from that IFD — both are SHORT or LONG values that fit
// in the entry's 4-byte value field, so no second seek is needed.
function tiff(b: Uint8Array): ImageDimensions | null {
  if (b.length < 8) return null;
  const le = b[0] === 0x49 && b[1] === 0x49;
  if (!le && !(b[0] === 0x4d && b[1] === 0x4d)) return null;
  const u16 = (i: number) => (le ? u16le(b, i) : u16be(b, i));
  const u32 = (i: number) => (le ? u32le(b, i) : u32be(b, i));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > b.length) return null;
  const count = u16(ifd);
  let width = 0;
  let height = 0;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = u16(e);
    // type 3 = SHORT (u16), 4 = LONG (u32); the value sits in the entry itself.
    const value = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);
    if (tag === 0x0100) width = value;
    else if (tag === 0x0101) height = value;
    if (width > 0 && height > 0) break;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

function u16le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}
function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}
