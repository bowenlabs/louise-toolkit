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
});
