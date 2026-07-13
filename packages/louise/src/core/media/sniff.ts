// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/media — image type sniffing.
//
// Security-critical: the real image type is read from the leading magic bytes,
// never from the client-supplied `file.type`. A file with a spoofed
// `image/png` MIME would otherwise be stored *and served* as an image from a
// public media domain. Keeping this in the package (rather than copy-pasted per
// site) means one fix covers every Louise site — the same class as
// `louise/security`'s sanitizer.

/** The image MIME types Louise verifies and serves. SVG is intentionally
 *  excluded: it is not sniffable here and would be a hosted-HTML/script risk on
 *  a public media domain. */
export type SniffedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/tiff"
  | "image/avif";

/**
 * Sniff the real image type from the leading magic bytes rather than trusting
 * the client-supplied MIME. Pass the first ~32 bytes of the file. Returns the
 * verified MIME type, or `null` if the bytes aren't a supported image.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  const b = bytes;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  // WEBP: "RIFF"...."WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)
  ) {
    return "image/tiff";
  }
  // AVIF: an ISO-BMFF "ftyp" box whose header carries the "avif"/"avis" brand.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const header = new TextDecoder("latin1").decode(b.subarray(8, 32));
    if (header.includes("avif") || header.includes("avis")) return "image/avif";
  }
  return null;
}
