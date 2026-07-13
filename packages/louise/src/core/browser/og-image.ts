// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Per-page OG image generation on Cloudflare Browser Run (issue #5). The value
// is in the cache discipline: an OG card is deterministic for a given page +
// content, so it's keyed by slug + a content hash and stored in R2/KV. The
// second request for unchanged content is served from the store with NO browser
// session — Browser Run only spins up on a cache miss (a real cost lever, since
// browser sessions are the expensive part).
//
// `ogImage` is transport- and backend-agnostic (inject the renderer + cache);
// `createPuppeteerRenderer` is the thin edge binding to `@cloudflare/puppeteer`
// (an optional peer, dynamically imported so it never loads unless used).

import type { BrowserWorker } from "@cloudflare/puppeteer";
import type { OgImageCache, OgRenderer } from "./types.js";

/** Short, deterministic content hash (first 8 bytes of SHA-256, hex). Enough to
 *  bust the cache when a page's content changes; not security-sensitive. */
async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  // Spread to a real number[] first: Uint8Array.prototype.map would coerce the
  // hex strings back to numbers, so map on the plain array instead.
  const bytes = Array.from(new Uint8Array(digest).slice(0, 8));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface OgCacheKeyOptions {
  /** Key namespace/prefix. Default `"og"`. */
  prefix?: string;
  /** File extension. Default `"png"`. */
  ext?: string;
}

/**
 * Build the cache key for a page's OG image: `<prefix>/<safe-slug>-<hash>.<ext>`.
 * The content hash means editing a page mints a new key (old card falls out of
 * cache naturally) while an unchanged page always resolves to the same key.
 */
export async function ogCacheKey(
  slug: string,
  content: string,
  options: OgCacheKeyOptions = {},
): Promise<string> {
  const prefix = options.prefix ?? "og";
  const ext = options.ext ?? "png";
  const safe = slug.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._/-]/g, "-") || "index";
  return `${prefix}/${safe}-${await contentHash(content)}.${ext}`;
}

export interface OgImageOptions {
  /** Stable, content-hashed cache key (see {@link ogCacheKey}). */
  cacheKey: string;
  /** HTML of the card template to screenshot. */
  html: string;
  /** How to rasterize the HTML (see {@link createPuppeteerRenderer}). */
  render: OgRenderer;
  /** Byte store. Omit to always render (no caching). */
  cache?: OgImageCache;
}

export interface OgImageResult {
  bytes: Uint8Array;
  /** True when served from the cache (no browser session was launched). */
  cached: boolean;
}

/**
 * Return a page's OG image, rendering it only on a cache miss. On a hit the
 * stored bytes come back with `cached: true` and the renderer is never called —
 * so no Browser Run session spins up.
 */
export async function ogImage(options: OgImageOptions): Promise<OgImageResult> {
  if (options.cache) {
    const hit = await options.cache.get(options.cacheKey);
    if (hit) return { bytes: hit, cached: true };
  }
  const bytes = await options.render(options.html);
  if (options.cache) await options.cache.put(options.cacheKey, bytes, "image/png");
  return { bytes, cached: false };
}

export interface PuppeteerRendererOptions {
  /** Viewport (card) size. Default 1200×630 — the standard OG card. */
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

/**
 * An {@link OgRenderer} backed by Cloudflare Browser Run. Launches a session,
 * sets the card HTML, screenshots the viewport as PNG, and always closes the
 * browser. `@cloudflare/puppeteer` is imported dynamically so it's pulled in
 * only by sites that actually render — keeping it a truly optional peer.
 */
export function createPuppeteerRenderer(
  browser: BrowserWorker,
  options: PuppeteerRendererOptions = {},
): OgRenderer {
  return async (html) => {
    const puppeteer = await import("@cloudflare/puppeteer");
    const session = await puppeteer.launch(browser);
    try {
      const page = await session.newPage();
      await page.setViewport({
        width: options.width ?? 1200,
        height: options.height ?? 630,
        deviceScaleFactor: options.deviceScaleFactor ?? 1,
      });
      await page.setContent(html, { waitUntil: "networkidle0" });
      const shot = await page.screenshot({ type: "png" });
      return shot as Uint8Array;
    } finally {
      await session.close();
    }
  };
}
