// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import solid from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { ASTROID_VITE_BUILD, astroidSecurity } from "astroidjs/astro";
import { defineConfig } from "astro/config";
import astroidConfig from "./astroid.config.ts";

// SSR (`output: server`) because Louise renders per-request edit affordances and
// reads pages from D1. Solid islands power the editor UI (ADR 0001). Tailwind v4 +
// daisyUI drive the theme (src/styles/site.css). Cloudflare *bindings* are read
// via `import { env } from "cloudflare:workers"` (typed in src/env.d.ts), so there
// is no astro:env schema here.
export default defineConfig({
  site: "__SITE_URL__",
  output: "server",
  adapter: cloudflare(),
  integrations: [solid()],
  vite: {
    plugins: [tailwindcss()],
    build: { ...ASTROID_VITE_BUILD },
  },
  // Route caching (ADR 0004). This provider is what turns `Astro.cache.set(...)`
  // into a `Cloudflare-CDN-Cache-Control` header — which the generated worker's
  // `withEdgeCache` layer reads as its "store this" signal and then STRIPS, so
  // Cloudflare's own cookie-blind edge cache never sees it.
  //
  // Opt-in per response: a route that never calls `Astro.cache.set` (or calls
  // `set(false)`, as an edit-mode render does) goes out `no-store`. Nothing
  // personalized is ever cached. Published pages opt in from index.astro, gated
  // on the ASTROID_EDGE_CACHE var — which is "false" until you have walked the
  // activation runbook on a preview deploy.
  cache: { provider: cacheCloudflare() },
  // Content-Security-Policy, composed by Astroid from your config: it derives the
  // allowed origins from the modules you enabled (commerce provider SDKs,
  // captcha) and adds the hash of Solid's hydration bootstrap, which Astro does
  // not hash itself. Astro owns `script-src` (every script it processes is
  // hashed, so no 'unsafe-inline'); the generated src/middleware.ts rewrites only
  // `style-src`, because Louise's data-driven `style=""` carriers need
  // 'unsafe-inline' and a hash in that directive would void it.
  //
  // This is why the inline scripts here (login.astro, LouiseEdit.astro) avoid
  // is:inline/define:vars — those can't be hashed and would be blocked. Need
  // another origin? Add it to `security.cspOrigins` in astroid.config.ts.
  security: astroidSecurity(astroidConfig),
});
