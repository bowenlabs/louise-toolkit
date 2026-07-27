// QR codes — a vendored ISO/IEC 18004 byte-mode encoder plus SVG rendering.
// See ./encode.ts for why this is vendored rather than a dependency.
//
// For a PNG, hand `qrSvg()` to the existing SVG→PNG renderer in
// `core/browser/resvg.ts`; nothing QR-specific is needed for that path.
export { encodeQr, type QrErrorCorrection, type QrMatrix } from "./encode.js";
export { qrDataUri, qrSvg, type QrSvgOptions } from "./svg.js";
