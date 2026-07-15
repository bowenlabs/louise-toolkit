// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// An {@link OgRenderer} backed by the resvg/WASM SVG rasterizer (issue #85).
// This replaces the headless-browser screenshot on the OG hot path: rendering a
// static card (text on a field) is a pure SVG→PNG rasterization, ~100x cheaper
// than launching Browser Rendering and with no cold start. Browser Rendering
// stays for genuine full-page work (link-check, live previews).
//
// `@resvg/resvg-wasm` is an OPTIONAL peer, dynamically imported so it's only
// pulled in by sites that actually render OG cards — mirroring how the Puppeteer
// renderer treats `@cloudflare/puppeteer`. The caller supplies the compiled WASM
// module and the font buffers (Workers has no system fonts), so the toolkit
// stays font-agnostic and ships no multi-megabyte binary of its own.

import type { InitInput } from "@resvg/resvg-wasm";
import type { OgRenderer } from "./types.js";

/** The subset of `@resvg/resvg-wasm` this renderer uses. Declared structurally
 *  (via `typeof import`) so the peer is a pure type — erased at build, never a
 *  runtime import except the guarded dynamic `import()` below. */
type ResvgModule = typeof import("@resvg/resvg-wasm");

/** WASM init is global to the isolate — calling `initWasm` twice throws. Guard
 *  it per resolved module so a renderer created per request (as the Worker does)
 *  initializes exactly once. Keyed by the module namespace object: the real
 *  dynamic import is module-cached (one key → one init in production); each
 *  injected fake in tests is its own key (clean init-once assertions). */
const initGuards = new WeakMap<ResvgModule, Promise<void>>();

function ensureInit(mod: ResvgModule, wasm: InitInput | Promise<InitInput>): Promise<void> {
  let guard = initGuards.get(mod);
  if (!guard) {
    guard = mod.initWasm(wasm);
    initGuards.set(mod, guard);
  }
  return guard;
}

function toUint8Array(buffer: Uint8Array | ArrayBuffer): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

export interface ResvgRendererOptions {
  /** The compiled resvg WASM, passed to `initWasm`: a `WebAssembly.Module`, the
   *  `.wasm` bytes, or a `Response`/URL. On Cloudflare Workers, import the
   *  package's `index_bg.wasm` (a `WebAssembly.Module`) and pass it here. */
  wasm: InitInput | Promise<InitInput>;
  /** Raw font buffers used to shape `<text>`. At least one is required for any
   *  text to render — Workers has no system fonts. */
  fonts: (Uint8Array | ArrayBuffer)[];
  /** Family resvg falls back to when a `font-family` isn't matched. Set this to
   *  the family of the font you pass so a single supplied font always renders. */
  defaultFontFamily?: string;
  /** Force the output width in px (height scales to preserve aspect). Omit to
   *  render at the SVG's intrinsic size (the card is authored at 1200×630). */
  width?: number;
  /** Test seam: supply the resvg module instead of importing the optional peer. */
  loadResvg?: () => Promise<ResvgModule>;
}

/**
 * Build an {@link OgRenderer} that rasterizes an SVG string to PNG bytes via
 * resvg/WASM. The WASM is initialized once per isolate (lazily, on first
 * render); each call constructs a `Resvg`, renders, and returns the PNG bytes.
 * Pair with {@link ogCardSvg} and drive through {@link ogImage} for caching.
 */
export function createResvgRenderer(options: ResvgRendererOptions): OgRenderer {
  const fontBuffers = options.fonts.map(toUint8Array);
  const loadResvg = options.loadResvg ?? (() => import("@resvg/resvg-wasm"));
  return async (svg) => {
    const mod = await loadResvg();
    await ensureInit(mod, options.wasm);
    const resvg = new mod.Resvg(svg, {
      fitTo:
        options.width !== undefined
          ? { mode: "width", value: options.width }
          : { mode: "original" },
      font: {
        fontBuffers,
        loadSystemFonts: false,
        ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
      },
    });
    return resvg.render().asPng();
  };
}
