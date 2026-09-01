// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";

// docs.louisetoolkit.com — the Starlight documentation as a standalone STATIC Astro
// app. `astro build` emits a plain static site to dist/ (no adapter, default
// `output: "static"`), which the single marketing Worker serves under the docs
// host (see workers/site/src/worker.ts: docs.* requests are prefixed to
// /_docs/* against the Worker's static assets). Content lives at the app root
// (src/content/docs/{guide,reference}), so pages are /guide/x and /reference/x —
// the subdomain-root URLs, with no path rewriting of internal links.
export default defineConfig({
  site: "https://docs.louisetoolkit.com",
  // No raster image optimization here (the only asset is an SVG logo, which is
  // served as-is), so use the passthrough service and skip the heavy `sharp`
  // native dep entirely (#84).
  image: { service: passthroughImageService() },
  // The docs home is the Getting started guide (there's no separate splash).
  //
  // The two `/astroid/` entries are gone-but-not-forgotten: those pages moved to
  // docs.astroidjs.org when Astroid split into its own repo, and these URLs are
  // published — linked from the README, from npm, and from wherever readers
  // bookmarked them. A 404 is a worse answer than a hop. The reference page became
  // fifteen pages there, so `/reference/astroid/` lands on the config page, which
  // is what its first section was.
  redirects: {
    "/": "/guide/getting-started/",
    "/guide/astroid/": "https://docs.astroidjs.org/guide/getting-started/",
    "/reference/astroid/": "https://docs.astroidjs.org/reference/config/",
  },
  integrations: [
    starlight({
      title: "Louise Toolkit",
      description:
        "The V8-native toolkit for building editable sites on Astro + Cloudflare Workers — content, commerce, media, forms, auth, and AI as composable primitives.",
      logo: { src: "./src/assets/louise-monogram.svg", replacesTitle: false },
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
