// QR → SVG. Pure string generation: no bindings, no DOM, no I/O — so a QR route
// renders identically at build time, in a Worker, and in a unit test, and keeps
// working when every commerce secret is still a placeholder. Printing codes must
// never be blocked on provisioning.

import { encodeQr, type QrErrorCorrection, type QrMatrix } from "./encode.js";

export interface QrSvgOptions {
  ecc?: QrErrorCorrection;
  /**
   * Quiet zone in MODULES (not pixels). Default 4 — the spec minimum. Anything
   * less and real scanners start failing against a busy shop wall.
   */
  margin?: number;
  dark?: string;
  /** `null` for a transparent background (the default is an opaque white so a
   *  code printed onto colored stock still scans). */
  light?: string | null;
  /** Emit width/height in px alongside the viewBox. Set it for a downloadable
   *  file; omit it for an inline SVG that should scale with its container. */
  size?: number;
  /** Rendered as `<title>`, so an inline code has an accessible name. */
  title?: string;
}

const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

/**
 * The dark modules as ONE path, merging horizontal runs.
 *
 * The naive rendering is one `<rect>` per dark module — for a version 4 code
 * that's up to 1089 elements. Run-merging cuts the emitted string roughly 4x,
 * which is what keeps a QR small enough to inline in a page or an email.
 */
function modulesToPath(matrix: QrMatrix, margin: number): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    let x = 0;
    while (x < matrix.size) {
      if (!matrix.modules[y]![x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < matrix.size && matrix.modules[y]![x + run]) run++;
      parts.push(`M${x + margin} ${y + margin}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join("");
}

/** A standalone SVG document string for `data`. */
export function qrSvg(data: string, options: QrSvgOptions = {}): string {
  const margin = options.margin ?? 4;
  const dark = options.dark ?? "#000000";
  const light = options.light === undefined ? "#ffffff" : options.light;
  const matrix = encodeQr(data, { ecc: options.ecc });
  const extent = matrix.size + margin * 2;

  const dimensions = options.size ? ` width="${options.size}" height="${options.size}"` : "";
  const background =
    light === null ? "" : `<rect width="${extent}" height="${extent}" fill="${escapeXml(light)}"/>`;
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  // `shape-rendering="crispEdges"` stops the renderer antialiasing module edges
  // into grey, which is what makes a small on-screen code hard to scan.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"${dimensions} ` +
    `shape-rendering="crispEdges"${options.title ? ' role="img"' : ""}>` +
    `${title}${background}` +
    `<path fill="${escapeXml(dark)}" d="${modulesToPath(matrix, margin)}"/>` +
    `</svg>`
  );
}

/** The same SVG as a `data:` URI, for an `<img src>`. */
export function qrDataUri(data: string, options: QrSvgOptions = {}): string {
  return `data:image/svg+xml,${encodeURIComponent(qrSvg(data, options))}`;
}
