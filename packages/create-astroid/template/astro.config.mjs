// @ts-check
import cloudflare from "@astrojs/cloudflare";
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
