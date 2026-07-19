// @ts-check
import cloudflare from "@astrojs/cloudflare";
import solid from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

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
  vite: { plugins: [tailwindcss()] },
  // Content-Security-Policy. Astro hashes every processed script + style and emits
  // a `content-security-policy` response header on on-demand (SSR) pages — which is
  // all of ours. The generated src/middleware.ts (createLouiseMiddleware) then
  // rewrites `style-src` to `'self' 'unsafe-inline'` so Louise's data-driven
  // `style=""` carriers and the editor's runtime-injected <style> are allowed, and
  // permits the inlined `data:` brand font. This is why the inline scripts here
  // (login.astro, LouiseEdit.astro) avoid is:inline/define:vars — those can't be
  // hashed and would be blocked.
  //
  // Using Square Web Payments? Allow its SDK host in script-src:
  //   security: { csp: { scriptDirective: { resources: ["'self'", "https://web.squarecdn.com"] } } }
  security: { csp: true },
});
