// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The OG share card as an SVG document (issue #85). This is the same visual as
// the old `ogCardHtml` — brand label, wrapped title, footer on a dark slate
// field — but expressed as SVG so it can be rasterized by the resvg/WASM
// renderer (`createResvgRenderer`) instead of screenshotted in a headless
// browser. Pure + deterministic: no bindings, no I/O, so it's trivially testable
// and the caller controls every colour and the font family.
//
// SVG `<text>` has no line wrapping, so `wrapTitle` greedily splits the title
// into `<tspan>` lines using an estimated glyph advance (there are no real font
// metrics without parsing the font, and an OG card doesn't need pixel-perfect
// wrapping — just "don't run off the edge").

/** Escape a string for inclusion in SVG/XML text or an attribute value. */
function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&#39;",
  );
}

export interface WrapTitleOptions {
  /** Content width the text must fit within, in px. */
  maxWidth: number;
  /** Title font size, in px. */
  fontSize: number;
  /** Estimated glyph advance as a fraction of font size. Default 0.56 — a
   *  reasonable mean for a heavy UI sans; tune per font if wrapping drifts. */
  charWidthRatio?: number;
  /** Hard cap on lines; the last line is ellipsized if the title overflows.
   *  Default 3. */
  maxLines?: number;
}

/**
 * Greedily wrap `title` into at most `maxLines` lines that each fit `maxWidth`
 * at `fontSize`, estimating width from an average glyph advance. The final line
 * is truncated with an ellipsis when the title doesn't fit. A single word longer
 * than a line is left on its own line (never dropped).
 */
export function wrapTitle(title: string, options: WrapTitleOptions): string[] {
  const { maxWidth, fontSize } = options;
  const ratio = options.charWidthRatio ?? 0.56;
  const maxLines = Math.max(1, options.maxLines ?? 3);
  const perChar = fontSize * ratio;
  const maxChars = Math.max(1, Math.floor(maxWidth / perChar));

  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || line === "") {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  // Overflow past the last allowed line → ellipsize the final line so nothing
  // spills off the card.
  if (lines.length > maxLines) lines.length = maxLines;
  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length && lines.length > 0) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length > maxChars - 1 ? `${last.slice(0, Math.max(0, maxChars - 1))}…` : `${last}…`;
  }
  return lines;
}

export interface OgCardOptions {
  /** Card dimensions. Default 1200×630 — the standard OG card. */
  width?: number;
  height?: number;
  /** Uniform inset for all text, in px. Default 80. */
  padding?: number;
  /** Background fill (any CSS colour). Default `#0f172a` (slate-900). */
  background?: string;
  /** Small brand label above the title. Default `"louise"`. */
  brand?: string;
  brandColor?: string;
  titleColor?: string;
  /** Footer line, bottom-left. Default `"louisetoolkit.com"`. */
  footer?: string;
  footerColor?: string;
  /** Title font size, in px. Default 76. */
  fontSize?: number;
  /** Font family used for every line. Must match a family the renderer loads
   *  (see {@link createResvgRenderer}'s `defaultFontFamily`). Default a generic
   *  sans stack. */
  fontFamily?: string;
}

/**
 * Build the OG card as an SVG string. Content-equivalent to the legacy
 * `ogCardHtml` so the cache key (slug + content hash) stays stable across the
 * renderer swap. Feed the result to an {@link OgRenderer} — e.g.
 * `createResvgRenderer` — to rasterize to PNG.
 */
export function ogCardSvg(title: string, options: OgCardOptions = {}): string {
  const width = options.width ?? 1200;
  const height = options.height ?? 630;
  const padding = options.padding ?? 80;
  const background = options.background ?? "#0f172a";
  const brand = options.brand ?? "louise";
  const brandColor = options.brandColor ?? "#56c6be";
  const titleColor = options.titleColor ?? "#f8fafc";
  const footer = options.footer ?? "louisetoolkit.com";
  const footerColor = options.footerColor ?? "#94a3b8";
  const fontSize = options.fontSize ?? 76;
  const fontFamily = options.fontFamily ?? "ui-sans-serif, system-ui, sans-serif";

  const lineHeight = Math.round(fontSize * 1.1);
  const lines = wrapTitle(title, { maxWidth: width - padding * 2, fontSize });

  // Baselines: brand near the top, title block below it, footer pinned to the
  // bottom inset — mirrors the flex layout of the old HTML card closely enough.
  const brandBaseline = padding + 50;
  const titleTop = brandBaseline + 110;
  const footerBaseline = height - padding + 24;

  const family = escapeXml(fontFamily);
  const titleTspans = lines
    .map((l, i) => `<tspan x="${padding}" y="${titleTop + i * lineHeight}">${escapeXml(l)}</tspan>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  <text x="${padding}" y="${brandBaseline}" font-family="${family}" font-size="28" font-weight="600" fill="${brandColor}" letter-spacing="0.5">${escapeXml(brand)}</text>
  <text font-family="${family}" font-size="${fontSize}" font-weight="800" fill="${titleColor}">${titleTspans}</text>
  <text x="${padding}" y="${footerBaseline}" font-family="${family}" font-size="24" font-weight="400" fill="${footerColor}">${escapeXml(footer)}</text>
</svg>`;
}
