// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Live OG / social-card preview for the pages drawer (issue #76). As the editor
// types the title / SEO title, this shows the share card they'll get — either the
// custom Social image (if set) or the auto-generated card, drawn with the SAME
// `ogCardSvg` template the site rasterizes for real (#85). It's pure client SVG:
// the browser rasterizes it natively, so there's no Browser Rendering, no server
// round-trip, and no debounce needed — the card just re-renders reactively.
//
// `ogCardSvg` is imported directly from the core module (it's pure — no bindings,
// no imports), NOT via the `core/browser` barrel, which would pull resvg/puppeteer
// into the client bundle.

import { Show } from "solid-js";
import { type OgCardOptions, ogCardSvg } from "../../core/browser/og-card.js";

/** What the preview should show: the editor's custom Social image, or the
 *  auto-generated card (as an SVG string) built from the title. */
export type OgPreviewContent = { kind: "image"; src: string } | { kind: "card"; svg: string };

/**
 * Decide the preview content. A non-empty `customImage` wins (the editor set an
 * explicit Social image); otherwise build the generated card from the title —
 * falling back to "Untitled" so a blank title still previews a real card. Pure,
 * so the image-vs-card decision is unit-testable without a DOM.
 */
export function ogPreviewContent(
  customImage: string,
  title: string,
  cardOptions?: OgCardOptions,
): OgPreviewContent {
  const src = customImage.trim();
  if (src) return { kind: "image", src };
  return { kind: "card", svg: ogCardSvg(title.trim() || "Untitled", cardOptions) };
}

/** Narrow accessors so the JSX stays cast-free. */
const imageSrc = (c: OgPreviewContent): string => (c.kind === "image" ? c.src : "");
const cardSvg = (c: OgPreviewContent): string => (c.kind === "card" ? c.svg : "");

/**
 * The share-card preview block for `PageForm`. `customImage` is the page's
 * `ogImage` field; `title` is its SEO title (falling back to the page title).
 * `cardOptions` lets a site match its real card's brand / colours / font; omit for
 * the toolkit defaults.
 */
export function OgPreview(props: {
  customImage: string;
  title: string;
  cardOptions?: OgCardOptions;
}) {
  const content = (): OgPreviewContent =>
    ogPreviewContent(props.customImage, props.title, props.cardOptions);

  return (
    <div class="louise-field">
      <span class="louise-field-label">Social share preview</span>
      <div class="louise-og-preview">
        <Show
          when={content().kind === "image"}
          fallback={
            // Trusted, script-free SVG from `ogCardSvg` — inline (not a `data:`
            // image) so it never trips the site CSP's `img-src`. Same pattern as
            // the inline Phosphor `Icon`.
            <div class="louise-og-card" innerHTML={cardSvg(content())} />
          }
        >
          <img class="louise-og-img" src={imageSrc(content())} alt="" />
        </Show>
      </div>
      <p class="louise-muted louise-settings-hint">
        {content().kind === "card"
          ? "Auto-generated from the title — set a Social image above to override it."
          : "Using your Social image."}
      </p>
    </div>
  );
}
