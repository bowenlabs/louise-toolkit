// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// docs.louisecms.com — the Starlight documentation as a standalone STATIC Astro
// app. `astro build` emits a plain static site to dist/ (no adapter, default
// `output: "static"`), which the single marketing Worker serves under the docs
// host (see workers/site/src/worker.ts: docs.* requests are prefixed to
// /_docs/* against the Worker's static assets). Content lives at the app root
// (src/content/docs/{guide,reference}), so pages are /guide/x and /reference/x —
// the subdomain-root URLs, with no path rewriting of internal links.
export default defineConfig({
  site: "https://docs.louisecms.com",
  // The docs home is the Getting started guide (there's no separate splash).
  redirects: { "/": "/guide/getting-started/" },
  integrations: [
    starlight({
      title: "Louise CMS",
      description: "A V8-native, inline edit-on-the-live-page CMS for Cloudflare Workers.",
      logo: { src: "./src/assets/louise-mark.svg", replacesTitle: false },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/bowenlabs/louisecms",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/bowenlabs/louisecms/edit/main/workers/docs/",
      },
      sidebar: [
        { label: "Guide", items: [{ autogenerate: { directory: "guide" } }] },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
      customCss: ["louisecms/theme/fonts.css", "./src/styles/docs.css"],
    }),
  ],
});
