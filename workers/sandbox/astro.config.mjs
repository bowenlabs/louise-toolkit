// @ts-check
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField } from "astro/config";

// sandbox.louisetoolkit.com — the interactive sandbox worker. SSR (`output:
// server`) because the checkout is a real per-request Square call and pages read
// demo orders from D1. Same Tailwind v4 + daisyUI + `louise` theme as the site.
export default defineConfig({
  site: "https://sandbox.louisetoolkit.com",
  output: "server",
  adapter: cloudflare(),
  // Typed, validated sandbox config (astro:env). Values still come from
  // wrangler.jsonc `vars` / `wrangler secret` at runtime; this is the schema +
  // types over them. Read on the server (page frontmatter + /api/checkout); the
  // public ones are handed to the browser there.
  env: {
    schema: {
      SQUARE_ENV: envField.enum({
        context: "server",
        access: "public",
        values: ["sandbox", "production"],
        default: "sandbox",
      }),
      // Empty defaults so `astro build` passes before provisioning; the real
      // values come from wrangler `vars` at runtime and override these.
      SQUARE_APP_ID: envField.string({ context: "server", access: "public", default: "" }),
      SQUARE_LOCATION: envField.string({ context: "server", access: "public", default: "" }),
      // Optional so the page still renders before the secret is set; the
      // /api/checkout endpoint guards on it and returns 503 until provisioned.
      SQUARE_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      FROM_EMAIL: envField.string({
        context: "server",
        access: "public",
        default: "sandbox@louisetoolkit.com",
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    preview: { allowedHosts: ["sandbox.louisetoolkit.com"] },
  },
});
