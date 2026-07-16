---
"louise-toolkit": minor
---

Add a live OG / social-card preview to the pages drawer (#76). As an editor types a page's title / SEO title, `PageForm` now shows the share card they'll get — either the custom Social image (when set) or the auto-generated card, drawn with the same `ogCardSvg` template the site rasterizes for real (#85).

Because #85 made the OG card a pure SVG, the preview is client-side and instant: the browser rasterizes it natively, so there's no Browser Rendering, no server round-trip, and no debounce. The generated card renders as inline SVG (not a `data:` image) so it never trips the site CSP's `img-src`. The new `OgPreview` component / `ogPreviewContent` helper lives in `louise-toolkit/client`, and `PagesPanel` takes an optional `ogCard?: OgCardOptions` prop so a site can match its real card's brand, colours, footer, and font.

Version-history thumbnails (the Browser-Rendering half of #76) are tracked separately.
