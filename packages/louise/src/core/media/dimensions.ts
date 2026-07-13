// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/media — intrinsic image dimensions from the file header.
//
// Reads width/height out of the leading bytes without decoding the pixels, so an
// upload can record its dimensions cheaply on a Worker (no image library). Pairs
// with `sniffImageType`: the same magic bytes that identify the format also tell
// us where the size lives. Covers the common raster formats; returns `null` for
// anything it can't read confidently (incl. TIFF/AVIF, whose sizes need real box
// parsing) so `width`/`height` stay honestly "when known".

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Parse intrinsic pixel dimensions from an image's header bytes (PNG, GIF,
 * JPEG, WebP). Pass enough of the file to include the header — the first few KB
 * is always plenty; the whole buffer is fine. Returns `null` when the size can't
 * be read (unsupported format, or a truncated/odd header).
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const d = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
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

function u16le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}
