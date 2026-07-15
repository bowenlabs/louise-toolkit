// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/browser
//
// Edge rendering helpers shared across all Louise sites: per-page OG image
// generation with a content-hashed cache (render only on a miss), and a
// scheduled link-checker. Two OG renderers are offered behind one {@link
// OgRenderer} contract — the resvg/WASM rasterizer (`createResvgRenderer`, the
// default hot path, issue #85) and the Browser-Rendering screenshot
// (`createPuppeteerRenderer`, issue #5). Both peers (`@resvg/resvg-wasm`,
// `@cloudflare/puppeteer`) are optional and dynamically imported only when a
// render actually happens. Browser Rendering binding contract: `BROWSER` — see
// {@link LouiseBrowserEnv}.

export {
  createPuppeteerRenderer,
  ogCacheKey,
  type OgCacheKeyOptions,
  ogImage,
  type OgImageOptions,
  type OgImageResult,
  type PuppeteerRendererOptions,
} from "./og-image.js";
export { type OgCardOptions, ogCardSvg, type WrapTitleOptions, wrapTitle } from "./og-card.js";
export { createResvgRenderer, type ResvgRendererOptions } from "./resvg.js";
export { type BrokenLink, checkLinks, type CheckLinksOptions, extractLinks } from "./link-check.js";
export type { LouiseBrowserEnv, OgImageCache, OgRenderer } from "./types.js";
