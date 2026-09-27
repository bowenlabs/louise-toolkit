// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Which image a share of a page shows. The page head and the Pages panel's
// share preview both decide it here, so the preview shows what a share gets.
// Pure and dependency-free, so the client bundle can import it directly.

/** What a share of a page shows: an image URL, the site's generated card, or nothing. */
export type ShareImageSource = { kind: "image"; src: string } | { kind: "card" } | { kind: "none" };

export interface ShareImageInput {
  /** The page's own share image (`pages.ogImage`). */
  ogImage?: string | null;
  /** Whether the site renders a share card for every page. */
  cards?: boolean;
  /** The site-wide default image (`site_settings.defaultOgImageUrl`). */
  defaultImage?: string | null;
}

/**
 * The share image, in order: the page's own `ogImage`, then the site's
 * generated card when it renders one, then the site-wide default image.
 */
export function shareImageSource(input: ShareImageInput): ShareImageSource {
  const own = input.ogImage?.trim();
  if (own) return { kind: "image", src: own };
  if (input.cards) return { kind: "card" };
  const fallback = input.defaultImage?.trim();
  if (fallback) return { kind: "image", src: fallback };
  return { kind: "none" };
}
