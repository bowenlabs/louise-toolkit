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
  // Workers AI (#75): alt text on upload + the rewrite/SEO assists. Binding from
  // wrangler.jsonc `ai`; the `core/ai` helpers degrade to null when a model errs.
  AI: Ai;
  // Per-page live editing session Durable Object (#71): the realtime WebSocket
  // route (worker.ts `realtimeRoute`) forwards upgrades here. Optional — the
  // route 503s (realtime cleanly off) when the binding is absent. Class exported
  // from worker.ts; namespace from wrangler.jsonc `durable_objects`.
  EDIT_SESSION?: DurableObjectNamespace;
  // Cloudflare Queue (#77): deferred post-write side-effects (FTS reindex).
  // Optional so publish still works — and falls back to inline sync — if the
  // queue isn't provisioned. Producer binding from wrangler.jsonc `queues`.
  QUEUE?: Queue<import("louise-toolkit/queues").SideEffectJob>;
  // Durable publish pipeline (#88): reindex → warm OG → webhook. Optional —
  // publish falls back to the reindex Queue (then inline) when unbound. Binding
  // from wrangler.jsonc `workflows`; the class is exported from worker.ts.
  PUBLISH_WORKFLOW?: Workflow<import("./workflows/publish.js").PublishParams>;
  // Optional outbound webhook the publish Workflow POSTs to on publish (rebuild
  // hooks, analytics). No-op when unset. Set via `wrangler secret put`.
  PUBLISH_WEBHOOK?: string;
  // Auto-save draft write-buffer (#70). Optional so the editor falls back to
  // straight-to-D1 draft writes if the namespace isn't bound.
  DRAFTS?: KVNamespace;
};

// The bundled resvg rasterizer imports as a compiled WebAssembly module (the
// Cloudflare Worker build compiles `.wasm` imports). Typed so `import wasm from
// "./resvg.wasm"` resolves to a `WebAssembly.Module`.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

// `caches.default` is Cloudflare's per-Worker cache. The tsconfig `lib` includes
// DOM (Astro needs it for client code), and lib.dom's `CacheStorage` — which has
// no `default` — wins the global merge over @cloudflare/workers-types', so re-add
// it here to match the real runtime.
interface CacheStorage {
  default: Cache;
}

// Type the bindings the whole site reads via `import { env } from "cloudflare:workers"`
// (Astro v6+ removed Astro.locals.runtime.env). `@cloudflare/workers-types` types
// that `env` as the augmentable `Cloudflare.Env` interface, so we extend it here
// rather than re-declaring the module — which would shadow the rest of the module's
// exports (WorkflowEntrypoint, MessageBatch, …). Requires @cloudflare/workers-types
// to be a devDependency so `tsconfig`'s `types` entry resolves.
declare namespace Cloudflare {
  interface Env extends CloudflareEnv {}
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
