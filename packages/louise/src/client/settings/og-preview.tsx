// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Live OG / social-card preview for the pages drawer (issue #76). As the editor
// types the title / SEO title, this shows the share card they'll get—the custom
// Social image, the auto-generated card, or the site-wide default image, in the
// order `shareImageSource` (louise-toolkit/seo) gives a real share. The card is
// drawn with the SAME `ogCardSvg` template the site rasterizes for real (#85).
// It's pure client SVG: the browser rasterizes it natively, so there's no
// Browser Rendering, no server round-trip, and no debounce needed—the card just
// re-renders reactively.
//
// `ogCardSvg` and `shareImageSource` are imported directly from their core
// modules (both pure—no bindings), NOT via the `core/browser` or `core/seo`
// barrels, which would pull resvg/puppeteer or the text helpers into the client
// bundle.

import { Show } from "solid-js";
import { type OgCardOptions, ogCardSvg } from "../../core/browser/og-card.js";
import { shareImageSource } from "../../core/seo/share.js";

/** What the preview should show: an image, the auto-generated card (as an SVG
 *  string) built from the title, or nothing when a share has no image. */
export type OgPreviewContent =
  | { kind: "image"; src: string }
  | { kind: "card"; svg: string }
  | { kind: "none" };

/** How the site's shares fall back when a page has no Social image. */
export interface OgPreviewShare {
  /** Whether the site renders a share card for every page. Default `true`. */
  cards?: boolean;
  /** The site-wide default share image, from Settings. */
  defaultImage?: string;
}

/**
 * Decide the preview content with `shareImageSource`, the same order a real
 * share uses: the page's `customImage`, then the generated card when the site
 * renders cards, then the site-wide default image. The card falls back to
 * "Untitled" so a blank title still previews a real card. Pure, so the decision
 * is unit-testable without a DOM.
 */
export function ogPreviewContent(
  customImage: string,
  title: string,
  cardOptions?: OgCardOptions,
  share: OgPreviewShare = {},
): OgPreviewContent {
  const source = shareImageSource({
    ogImage: customImage,
    cards: share.cards ?? true,
    defaultImage: share.defaultImage,
  });
  if (source.kind === "card") {
    return { kind: "card", svg: ogCardSvg(title.trim() || "Untitled", cardOptions) };
  }
  return source;
}

/** Narrow accessors so the JSX stays cast-free. */
const imageSrc = (c: OgPreviewContent): string => (c.kind === "image" ? c.src : "");
const cardSvg = (c: OgPreviewContent): string => (c.kind === "card" ? c.svg : "");

/** The hint under the preview: where the image came from, and how to change it. */
function previewHint(content: OgPreviewContent, customImage: string): string {
  if (content.kind === "card") {
    return "Auto-generated from the title. Set a Social image above to override it.";
  }
  if (content.kind === "none") {
    return "Shares show no image. Set a Social image above, or a default share image in Settings.";
  }
  return customImage.trim()
    ? "Using your Social image."
    : "Using the site's default share image. Set a Social image above to override it.";
}

/**
 * The share-card preview block for `PageForm`. `customImage` is the page's
 * `ogImage` field; `title` is its SEO title (falling back to the page title).
 * `cardOptions` lets a site match its real card's brand / colours / font; omit for
 * the toolkit defaults. `share` says how the site falls back when there's no
 * Social image, so the preview matches a real share.
 */
export function OgPreview(props: {
  customImage: string;
  title: string;
  cardOptions?: OgCardOptions;
  share?: OgPreviewShare;
}) {
  const content = (): OgPreviewContent =>
    ogPreviewContent(props.customImage, props.title, props.cardOptions, props.share);

  return (
    <div class="louise-field">
      <span class="louise-field-label">Social share preview</span>
      <Show when={content().kind !== "none"}>
        <div class="louise-og-preview">
          <Show
            when={content().kind === "image"}
            fallback={
              // Trusted, script-free SVG from `ogCardSvg`—inline (not a `data:`
              // image) so it never trips the site CSP's `img-src`. Same pattern as
              // the inline Phosphor `Icon`.
              <div class="louise-og-card" innerHTML={cardSvg(content())} />
            }
          >
            <img class="louise-og-img" src={imageSrc(content())} alt="" />
          </Show>
        </div>
      </Show>
      <p class="louise-muted louise-settings-hint">{previewHint(content(), props.customImage)}</p>
    </div>
  );
}
