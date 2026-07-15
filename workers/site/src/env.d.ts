/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Cloudflare *bindings* this Worker exposes (wrangler.jsonc), read via
// `import { env } from "cloudflare:workers"`. MEDIA_URL stays here (not
// astro:env) because the framework-agnostic media route (louise-toolkit/editor
// `mediaRoute`, whose `MediaRouteEnv` requires it) reads it off this runtime env.
// The editor-gate config (OWNER_EMAIL, LOUISE_SESSION_SECRET,
// LOUISE_EDITOR_PASSWORD) IS typed + validated by the astro:env schema — see
// astro.config.mjs, consumed via `astro:env/server`. The OG card is rendered
// with resvg/WASM now (#85), so there's no Browser Rendering binding.
type CloudflareEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  MEDIA_URL: string;
  RL: KVNamespace;
  ASSETS: Fetcher;
  // Cloudflare Images binding (#84): upload `.info()` dimensions + server-side
  // transforms. Optional in LouiseMediaEnv/MediaRouteEnv; declared here since
  // wrangler.jsonc provides it.
  IMAGES: ImagesBinding;
};

// The bundled resvg rasterizer imports as a compiled WebAssembly module (the
// Cloudflare Worker build compiles `.wasm` imports). Typed so `import wasm from
// "./resvg.wasm"` resolves to a `WebAssembly.Module`.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

// Bindings are read via `import { env } from "cloudflare:workers"` (Astro v6+
// removed Astro.locals.runtime.env), so Locals only carries what middleware sets.
declare namespace App {
  interface Locals {
    /** Resolved editor session (authorizes writes). Null when not signed in. */
    editor: import("louise-toolkit/auth").EditorSession | null;
    /** Whether the page should render edit affordances. */
    editMode: boolean;
  }
}
