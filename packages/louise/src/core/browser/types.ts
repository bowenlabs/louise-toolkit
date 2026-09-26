// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

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
 * A byte store for rendered OG images. It's declared structurally, so the module
 * depends on no storage binding, but no binding fits it as is: an R2 bucket's
 * `get` returns an object body and a KV namespace's returns a string or an
 * `ArrayBuffer`, and both take an options object where `put` takes a content
 * type. Wrap the one you use in a few lines that convert to and from
 * `Uint8Array`. Keys are content-hashed, so a hit means the exact page and
 * content were rendered.
 */
export interface OgImageCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
}

/** Renders an HTML string to PNG bytes. The edge implementation drives Browser
 *  Run (see `createPuppeteerRenderer`); tests inject a stub. */
export type OgRenderer = (html: string) => Promise<Uint8Array>;
