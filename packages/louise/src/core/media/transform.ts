// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/media — image transforms.
//
// Two orthogonal, pure (no-binding) concerns:
//   1. Cloudflare Image Resizing URL rewriting — request a resized derivative
//      through the same-zone `/cdn-cgi/image/<opts>/<path>` endpoint instead of
//      shipping the full-size original. Per-request billing, a zone feature, no
//      new cost. This is the single, settled transform backend; a seam is left
//      for a future Images-binding backend (server-side re-encoded crops) but
//      no abstraction is built yet.
//   2. A CSS-coordinate crop — `{ x, y, scale }` applied at render via
//      `object-position` + `transform: scale`, NOT a server-side re-encode. The
//      same source crops differently per placement, so crop is per-usage.

export interface CfImageOptions {
  width?: number;
  height?: number;
  /** Resize behaviour; `cover` fills and crops, `contain` letterboxes. */
  fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
  /** Focal point for cover-crops; `auto` lets Cloudflare pick the subject. */
  gravity?: "auto" | "center" | "left" | "right" | "top" | "bottom";
  /** `auto` serves AVIF/WebP when the client supports it. */
  format?: "auto" | "webp" | "avif" | "jpeg";
  quality?: number;
}

/**
 * Rewrite a media URL to a Cloudflare-resized derivative. Only same-origin
 * `/cdn-cgi/image/` path rewriting is used, so it works for any image served
 * from a resizing-enabled zone. Non-URLs (or parse failures) return the input
 * untouched, so callers can pass it unconditionally.
 */
export function cfImage(url: string, opts: CfImageOptions): string {
  if (!url || !/^https?:\/\//.test(url)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  // Already a transform URL — don't double-wrap.
  if (parsed.pathname.startsWith("/cdn-cgi/image/")) return url;

  const params: string[] = [];
  if (opts.width) params.push(`width=${opts.width}`);
  if (opts.height) params.push(`height=${opts.height}`);
  if (opts.fit) params.push(`fit=${opts.fit}`);
  if (opts.gravity) params.push(`gravity=${opts.gravity}`);
  params.push(`format=${opts.format ?? "auto"}`);
  if (opts.quality) params.push(`quality=${opts.quality}`);

  return `${parsed.origin}/cdn-cgi/image/${params.join(",")}${parsed.pathname}${parsed.search}`;
}

/**
 * A square, focal-cropped source + 2× retina descriptor for a circular render.
 * `size` is the CSS display diameter in px. Pair with a CSS circle mask.
 */
export function circleImage(url: string, size: number): { src: string; srcset: string } {
  const at = (scale: number) =>
    cfImage(url, { width: size * scale, height: size * scale, fit: "cover", gravity: "auto" });
  return { src: at(1), srcset: `${at(1)} 1x, ${at(2)} 2x` };
}

/** Options for {@link cfImageSrcset}: the largest 1× display width plus the
 *  usual cover-crop knobs. `ratio` (e.g. `"16/10"`) derives each derivative's
 *  height so the crop matches what CSS `object-fit` shows (no wasted pixels);
 *  omit it for a width-only resize. `steps` are DPR multipliers of `width`. */
export interface CfImageSrcsetOptions {
  width: number;
  ratio?: string;
  steps?: readonly number[];
  fit?: CfImageOptions["fit"];
  gravity?: CfImageOptions["gravity"];
  quality?: number;
}

/**
 * A width-descriptor `srcset` (+ a default `src`) for a rectangular render. The
 * browser picks the smallest derivative that covers the rendered width at the
 * device's DPR — retina included — so a huge master ships as a right-sized
 * AVIF/WebP. Pair the returned `srcset` with a `sizes` attribute describing the
 * rendered width. Mirrors {@link circleImage} for non-square frames. Pure (no
 * binding); a non-URL `url` passes through {@link cfImage} untouched.
 */
export function cfImageSrcset(
  url: string,
  opts: CfImageSrcsetOptions,
): { src: string; srcset: string } {
  const {
    width,
    ratio,
    steps = [0.5, 0.75, 1, 1.5, 2],
    fit = "cover",
    gravity = "auto",
    quality = 82,
  } = opts;
  const [rw, rh] = ratio ? ratio.split("/").map((n) => Number.parseFloat(n.trim())) : [];
  const heightFor = (w: number) => (rw && rh ? Math.round((w * rh) / rw) : undefined);
  const at = (w: number) =>
    cfImage(url, { width: w, height: heightFor(w), fit, gravity, format: "auto", quality });
  const widths = [...new Set(steps.map((s) => Math.round(width * s)))].sort((a, b) => a - b);
  return { src: at(width), srcset: widths.map((w) => `${at(w)} ${w}w`).join(", ") };
}

/** A per-usage crop: focal position (0–100, as a %) plus zoom (`scale` ≥ 1). */
export interface Crop {
  x: number;
  y: number;
  scale: number;
}

/**
 * Turn a {@link Crop} into inline style properties for an `<img>` inside a
 * fixed frame: focal `object-position` + `scale` zoom about the same focal
 * point. Framework-generic — spread into a JSX `style` object or stringify for
 * an `style=""` attribute. Sites that prefer CSS custom properties can read the
 * same `{ x, y, scale }` into `--crop-*` vars instead.
 */
export function cropStyle(crop: Crop): {
  objectPosition: string;
  transform: string;
  transformOrigin: string;
} {
  const origin = `${crop.x}% ${crop.y}%`;
  return {
    objectPosition: origin,
    transform: `scale(${crop.scale})`,
    transformOrigin: origin,
  };
}
