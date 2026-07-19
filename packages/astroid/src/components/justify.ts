// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Justified (Flickr-style) row balancing.
//
// The layout every photo grid actually wants: images keep their aspect ratios,
// each row is exactly as wide as the container, and rows land near a target
// height. CSS can't express it — `grid` needs uniform tracks, and `columns`
// gives you a masonry *column* flow where reading order runs down instead of
// across — so it's arithmetic, done once here rather than re-derived per site.
//
// Pure and synchronous on purpose. It's called twice for the same gallery:
// once during SSR with the aspect ratios the media library recorded, and again
// on the client after the images decode, with their true dimensions. Keeping it
// free of DOM access is what lets the same function serve both, and what lets it
// be tested without a browser.
//
// Self-contained by the same rule as `sections.ts`: this module ships as SOURCE
// (the `.astro` beside it imports it, and so does the client script it inlines),
// so it must not reach back into astroid's built `src/*`.

/** One item to lay out. `aspect` is width ÷ height. */
export interface JustifyItem {
  /** Intrinsic aspect ratio (w/h). Non-finite or ≤ 0 falls back to {@link DEFAULT_ASPECT}. */
  aspect: number;
}

/**
 * One image in a `<JustifiedGallery>`.
 *
 * Declared here rather than in the `.astro` component so consumers can import
 * the type from a plain module — an `.astro` file's non-`Props` exports are
 * awkward to reach from TypeScript, and a scaffolded page shouldn't have to.
 */
export interface GalleryItem {
  src: string;
  /**
   * Alternative text. Required, and `""` is a legitimate value for a purely
   * decorative tile — what must not happen is the attribute going missing.
   */
  alt: string;
  /** Intrinsic dimensions, when the media library recorded them. Used for the
   *  pre-decode layout; the client corrects from the decoded image regardless. */
  width?: number;
  height?: number;
  caption?: string;
  /** Wrap the tile in a link (a detail page, a lightbox route). */
  href?: string;
}

/** A laid-out item: its position in the input, at a concrete pixel size. */
export interface JustifiedBox {
  /** Index into the input array — the caller maps this back to its own data. */
  index: number;
  width: number;
  height: number;
}

/** One completed row. Every box in it shares `height`. */
export interface JustifiedRow {
  height: number;
  boxes: JustifiedBox[];
}

export interface JustifyOptions {
  /** Content-box width available, in px. */
  containerWidth: number;
  /** The height rows aim for. Rows land near it, never exactly on it. */
  targetHeight: number;
  /** Horizontal gap between items in a row, in px. Default 8. */
  gap?: number;
  /**
   * How much taller than `targetHeight` a trailing row may be before it's left
   * un-stretched. Default 1.5.
   *
   * This is the knob that stops the classic justified-layout embarrassment: a
   * gallery whose last row holds one landscape photo, stretched to the full
   * container width and four times the height of every other row. Past this
   * multiple the last row keeps `targetHeight` and simply ends early.
   */
  lastRowSlack?: number;
}

/** Aspect used for an item whose real ratio isn't known yet (3:2 landscape —
 *  the most common photographic frame, so first paint is usually close). */
export const DEFAULT_ASPECT = 1.5;

/** Clamp a caller-supplied aspect into something layout-safe. A zero or NaN
 *  ratio (an image that hasn't decoded, a media row with no dimensions) would
 *  otherwise divide the row height to Infinity and blow up the whole grid. */
function safeAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
}

/**
 * Balance `items` into rows that each fill `containerWidth` exactly.
 *
 * The rule per row: with n items of total aspect A and n−1 gaps, the height
 * that makes the row exactly fill is `(containerWidth − gap·(n−1)) / A`. Adding
 * items only ever *lowers* that height, so items are appended until it drops to
 * `targetHeight` and the row closes — which is why rows come out near, but
 * never exactly at, the target.
 *
 * ```ts
 * const rows = justifyRows(photos.map((p) => ({ aspect: p.width / p.height })), {
 *   containerWidth: 960,
 *   targetHeight: 240,
 * });
 * ```
 *
 * Widths are distributed so each row sums to `containerWidth` to the pixel:
 * rounding each box independently leaves a 1–2px seam that reads as a ragged
 * right edge, so the last box in every row absorbs the rounding remainder.
 */
export function justifyRows(items: JustifyItem[], options: JustifyOptions): JustifiedRow[] {
  const { containerWidth, targetHeight, gap = 8, lastRowSlack = 1.5 } = options;

  // A container with no width (SSR with no measurement, a display:none parent)
  // has no meaningful layout. Returning empty lets the caller render its
  // fallback rather than emitting boxes at NaN.
  if (items.length === 0 || !(containerWidth > 0) || !(targetHeight > 0)) return [];

  const rows: JustifiedRow[] = [];
  let run: { index: number; aspect: number }[] = [];
  let runAspect = 0;

  /** Turn the accumulated run into a row at `height`, filling the width exactly. */
  const flush = (height: number, stretch: boolean) => {
    if (run.length === 0) return;
    const h = Math.max(1, Math.round(height));
    const available = containerWidth - gap * (run.length - 1);

    let used = 0;
    const boxes = run.map((item, i) => {
      const last = i === run.length - 1;
      // Every box but the last takes its proportional share; the last takes
      // whatever is left, so the row's widths sum to `available` exactly and the
      // right edge stays flush. An un-stretched trailing row keeps natural
      // widths instead — it isn't meant to reach the edge.
      const width =
        stretch && last
          ? available - used
          : Math.round(stretch ? (available * item.aspect) / runAspect : h * item.aspect);
      used += width;
      return { index: item.index, width: Math.max(1, width), height: h };
    });

    rows.push({ height: h, boxes });
    run = [];
    runAspect = 0;
  };

  items.forEach((item, index) => {
    const aspect = safeAspect(item.aspect);
    run.push({ index, aspect });
    runAspect += aspect;

    const height = (containerWidth - gap * (run.length - 1)) / runAspect;
    if (height <= targetHeight) flush(height, true);
  });

  // Whatever didn't fill a row. Stretching it to the full width is right when
  // it's nearly full and grotesque when it holds one wide photo, so the slack
  // multiple decides.
  if (run.length > 0) {
    const height = (containerWidth - gap * (run.length - 1)) / runAspect;
    flush(Math.min(height, targetHeight * lastRowSlack), height <= targetHeight * lastRowSlack);
  }

  return rows;
}
