// @ts-check
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// louisecms.com — the marketing landing plus the Louise CMS dogfood, deployed to
// Cloudflare Workers. The Starlight docs used to live here under /docs/**; they
// now have their own static app (workers/docs) served under docs.louisecms.com
// by the *same* Worker — see src/worker.ts, which dispatches by Host.
//
// SSR (`output: server`) because Louise renders per-request edit affordances and
// reads pages from D1. Tailwind v4 + daisyUI power the public `louise` site theme
// (src/styles/louise.css); the plugin only emits into stylesheets that
// `@import "tailwindcss"`.
export default defineConfig({
  site: "https://louisecms.com",
  output: "server",
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
    // `astro preview` runs behind Vite's preview server, which blocks foreign
    // Host headers by default. Allow the two production hosts so the one-Worker
    // Host dispatch (src/worker.ts) can be exercised locally with a Host header.
    preview: { allowedHosts: ["louisecms.com", "docs.louisecms.com"] },
  },
});
