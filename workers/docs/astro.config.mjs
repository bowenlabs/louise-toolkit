// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";

// docs.louisetoolkit.org—the Starlight documentation as a standalone STATIC Astro
// app. `astro build` emits a plain static site to dist/ (no adapter, default
// `output: "static"`), which an assets-only Worker serves (wrangler.jsonc).
// Content lives at the app root (src/content/docs/{guide,reference}), so pages
// are /guide/x and /reference/x—the subdomain-root URLs, with no path rewriting
// of internal links.
export default defineConfig({
  site: "https://docs.louisetoolkit.org",
  // No raster image optimization here (the only asset is an SVG logo, which is
  // served as-is), so use the passthrough service and skip the heavy `sharp`
  // native dep entirely (#84).
  image: { service: passthroughImageService() },
  // No `redirects` here. For a static build, Astro writes each one as an HTML
  // page with a meta refresh, whose "Redirecting from…" link flashes on screen
  // before the hop. The redirects live in public/_redirects instead, which the
  // Worker answers with a real 301. The home page is the splash at
  // src/content/docs/index.mdx.
  integrations: [
    starlight({
      title: "Louise Toolkit",
      description:
        "The V8-native toolkit for building editable sites on Astro and Cloudflare Workers: content, commerce, media, forms, auth, and AI as composable primitives.",
      logo: { src: "./src/assets/louise-icon.svg", replacesTitle: false },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/bowenlabs/louise-toolkit",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/bowenlabs/louise-toolkit/edit/main/workers/docs/",
      },
      sidebar: [
        { label: "Guide", items: [{ autogenerate: { directory: "guide" } }] },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
      customCss: ["./src/styles/docs.css"],
    }),
  ],
});
