// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The site's OG-card renderer: resvg/WASM instead of Browser Rendering (#85).
// The compiled resvg module comes straight from the `@resvg/resvg-wasm` package
// (the Cloudflare Worker build compiles the `.wasm` import to a
// `WebAssembly.Module` — no vendored binary in the repo); the fonts are the
// base64-inlined Roboto Flex faces. `createResvgRenderer` initializes the WASM
// lazily on the first render and once per isolate, so building the renderer at
// module scope costs nothing until an OG card is actually requested.
import { createResvgRenderer } from "louise-toolkit/browser";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { robotoFlexFaces } from "./fonts.js";

/** Family the card SVG references; matches the embedded faces (see fonts.ts). */
export const OG_FONT_FAMILY = "Roboto Flex";

/** The shared OG renderer. Deterministic + cache-fronted upstream (ogImage). */
export const ogRenderer = createResvgRenderer({
  wasm: resvgWasm,
  fonts: robotoFlexFaces,
  defaultFontFamily: OG_FONT_FAMILY,
});
