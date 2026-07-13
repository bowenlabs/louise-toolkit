// @ts-check
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// sandbox.louisetoolkit.com — the interactive sandbox worker. SSR (`output:
// server`) because the checkout is a real per-request Square call and pages read
// demo orders from D1. Same Tailwind v4 + daisyUI + `louise` theme as the site.
export default defineConfig({
  site: "https://sandbox.louisetoolkit.com",
  output: "server",
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
    preview: { allowedHosts: ["sandbox.louisetoolkit.com"] },
  },
});
