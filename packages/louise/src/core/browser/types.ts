// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import type { BrowserWorker } from "@cloudflare/puppeteer";

/**
 * Binding contract for the Louise browser helpers. A site whose `Env` uses
 * Browser Run should `extends LouiseBrowserEnv`. The helpers take the binding
 * explicitly, so this is the typed contract, not an implicit reach.
 */
export interface LouiseBrowserEnv {
  /** Cloudflare Browser Run (Browser Rendering) binding. */
  BROWSER: BrowserWorker;
}

/**
 * A byte store for rendered OG images — satisfied by an R2 bucket or a KV
 * namespace (declared structurally so either fits without a hard dependency).
 * Keys are content-hashed, so a hit means the exact page+content was rendered.
 */
export interface OgImageCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
}

/** Renders an HTML string to PNG bytes. The edge implementation drives Browser
 *  Run (see `createPuppeteerRenderer`); tests inject a stub. */
export type OgRenderer = (html: string) => Promise<Uint8Array>;
