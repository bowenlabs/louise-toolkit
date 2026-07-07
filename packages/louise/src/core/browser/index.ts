// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/browser
//
// Edge browser-automation helpers on Cloudflare Browser Run, shared across all
// Louise sites (issue #5): per-page OG image generation with a content-hashed
// cache (a session only on a miss), and a scheduled link-checker. Bindings
// contract: `BROWSER` — see {@link LouiseBrowserEnv}. `@cloudflare/puppeteer` is
// an optional peer, dynamically imported only when a render actually happens.

export {
  createPuppeteerRenderer,
  ogCacheKey,
  type OgCacheKeyOptions,
  ogImage,
  type OgImageOptions,
  type OgImageResult,
  type PuppeteerRendererOptions,
} from "./og-image.js";
export { type BrokenLink, checkLinks, type CheckLinksOptions, extractLinks } from "./link-check.js";
export type { LouiseBrowserEnv, OgImageCache, OgRenderer } from "./types.js";
