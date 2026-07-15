---
"louise-toolkit": minor
---

Add a resvg/WASM OG-card renderer to `louise-toolkit/browser` — rasterize the share image with a Rust/WASM SVG rasterizer instead of screenshotting HTML in a headless browser, retiring Browser Rendering from the OG hot path (~100x cheaper, no cold start). (#85)

- `ogCardSvg(title, options?)` — the OG card as an SVG document (brand label, greedily wrapped title, footer on a dark field). Content-equivalent to the old HTML card, so the content-hashed cache key stays stable across the swap. Every colour, the font family, and the dimensions are options; `wrapTitle` is exported for reuse.
- `createResvgRenderer({ wasm, fonts, defaultFontFamily, width })` — an `OgRenderer` backed by `@resvg/resvg-wasm` (a new **optional** peer, dynamically imported like `@cloudflare/puppeteer`). WASM init is guarded per isolate so a renderer built per request initializes exactly once. The caller supplies the compiled WASM module and font buffers (Workers has no system fonts), so the toolkit stays font-agnostic and ships no binary of its own. Note: resvg's font DB selects a static face by weight — it does not interpolate a variable `wght` axis — so supply distinct 400/600/800 faces under one family name for a bold title.
- `ogImage`'s option `html` is renamed to `markup` (it now carries SVG as well as HTML). A one-line rename at call sites.

`createPuppeteerRenderer` stays for genuine full-page work (link-check, live previews). Both renderers satisfy the same `OgRenderer` contract, so `ogImage`'s cache discipline is unchanged.
