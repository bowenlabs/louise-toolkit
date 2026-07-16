// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import solid from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField } from "astro/config";

// louisetoolkit.com — the marketing landing, itself built with Louise Toolkit, deployed to
// Cloudflare Workers. The Starlight docs used to live here under /docs/**; they
// now have their own static app (workers/docs) served under docs.louisetoolkit.com
// by the *same* Worker — see src/worker.ts, which dispatches by Host.
//
// SSR (`output: server`) because Louise renders per-request edit affordances and
// reads pages from D1. Tailwind v4 + daisyUI power the public `louise` site theme
// (src/styles/louise.css); the plugin only emits into stylesheets that
// `@import "tailwindcss"`.
export default defineConfig({
  site: "https://louisetoolkit.com",
  output: "server",
  adapter: cloudflare(),
  // Route caching (#95): the Cloudflare provider maps `Astro.cache.set(...)` to
  // `Cloudflare-CDN-Cache-Control` + `Cache-Tag` headers, so a published page's
  // SSR render is cached at CF's edge. Opt-in per response — a route that never
  // calls `Astro.cache.set` (or calls `set(false)`, as edit-mode renders do) is
  // emitted `no-store`, so nothing personalized is ever cached. Published pages
  // opt in via `publishedPageCache` (src/lib/louise/cache.ts) and are purged by
  // tag on publish. Pairs with the deferred edit-chrome island (#73), which
  // keeps the public shell cookie-independent.
  cache: { provider: cacheCloudflare() },
  // Solid islands (ADR 0001) — matches every consuming site. Powers the typed
  // editor islands that call Astro Actions (see src/islands, src/actions).
  integrations: [solid()],
  // Typed, validated editor-gate config (astro:env). Values still come from
  // wrangler.jsonc `vars` / `wrangler secret` at runtime; this is the schema +
  // types over them, read via `astro:env/server` at the composition layer
  // (middleware / /louise login / worker resolveEditor) and passed into the
  // env-injected `session.ts` seam, which stays framework-agnostic. Cloudflare
  // *bindings* — and MEDIA_URL, which the framework-agnostic media route reads
  // off the runtime env — stay on `cloudflare:workers`; see src/env.d.ts.
  env: {
    schema: {
      // Fixed editor identity the single-password gate logs in as.
      OWNER_EMAIL: envField.string({
        context: "server",
        access: "public",
        default: "editor@louisetoolkit.com",
      }),
      // Optional so anonymous SSR works before provisioning — verifySession
      // guards on the cookie before it ever needs the key, and the /louise
      // login guards on the password.
      LOUISE_SESSION_SECRET: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      LOUISE_EDITOR_PASSWORD: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      // Build-time D1 REST access for the `louiseLoader` Content Layer example
      // (src/content.config.ts). The loader runs during `astro build` in Node —
      // off any Worker binding — so it reads published pages over the D1 REST
      // API. All optional: unset (a local build / CI without secrets) → the
      // `publishedPages` collection simply builds empty.
      CF_ACCOUNT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      CF_D1_DATABASE_ID: envField.string({ context: "server", access: "secret", optional: true }),
      CF_API_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      // Edge route caching (#95) master switch. OFF by default so merging never
      // risks an editor regression: Cloudflare's edge cache is keyed by URL and
      // does NOT bypass on a custom cookie by default, so a cached public page
      // could be served to an editor (they'd see published content without the
      // inline-edit hooks). Flip to true ONLY after adding a Cloudflare Cache
      // Rule that bypasses the cache when the `louise_edit` cookie is present
      // (the CDN half of "bypass in edit mode"). Until then, published pages
      // render uncached — correct, just not yet accelerated.
      LOUISE_EDGE_CACHE: envField.boolean({
        context: "server",
        access: "public",
        default: false,
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // `astro preview` runs behind Vite's preview server, which blocks foreign
    // Host headers by default. Allow the two production hosts so the one-Worker
    // Host dispatch (src/worker.ts) can be exercised locally with a Host header.
    preview: { allowedHosts: ["louisetoolkit.com", "docs.louisetoolkit.com"] },
  },
});
