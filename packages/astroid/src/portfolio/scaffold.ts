// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The `portfolio` archetype's scaffold-once page: a justified gallery over the
// media library.
//
// Scaffold-once, not regenerated, for the usual reason — this is the first file
// a portfolio site edits (which assets appear, in what order, whether tiles link
// to a detail page), so `astroid generate` must never rewrite it.
//
// It exists because the primitives alone don't finish the job. `<MediaSlot>` and
// `<JustifiedGallery>` are archetype-agnostic, but the wiring between them and
// the media registry — the public URL shape, filtering to images, carrying
// alt/caption and intrinsic dimensions through so the first paint isn't a guess
// — is identical every time, and is exactly what the consuming sites hand-wrote.

import type { AstroidConfig } from "../config.js";

/**
 * `src/pages/work.astro` — the portfolio gallery. Null for any other archetype.
 *
 * Intrinsic `width`/`height` are carried through deliberately: they feed the
 * pre-decode layout, so a library with dimensions recorded lays out correctly on
 * first paint instead of reflowing once the images decode.
 */
export function generateAstroidGalleryPage(config: AstroidConfig): string | null {
  if (config.archetype !== "portfolio") return null;
  const mediaBase = config.deploy?.mediaBase ?? "/media";

  return [
    "---",
    "// The work gallery — a justified grid over the media library.",
    "//",
    "// Scaffolded once; yours to edit. The layout primitive is general",
    "// (astroidjs/components/JustifiedGallery.astro); what lives here is this",
    "// project's own answer to *which* assets appear and in what order.",
    "//",
    "// Rows carry `alt`/`caption` from the media registry, so an editor fixes alt",
    "// text once in the library and every gallery showing that asset picks it up.",
    "// Assets missing width/height still render — the client corrects the layout",
    "// once the image decodes — but they cost a visible reflow, so it's worth",
    "// backfilling dimensions on older uploads.",
    'import JustifiedGallery from "astroidjs/components/JustifiedGallery.astro";',
    'import type { GalleryItem } from "astroidjs/components/justify";',
    'import { env } from "cloudflare:workers";',
    'import Site from "../layouts/Site.astro";',
    "",
    "export const prerender = false;",
    "",
    "interface MediaRow {",
    "  key: string;",
    "  alt: string | null;",
    "  caption: string | null;",
    "  width: number | null;",
    "  height: number | null;",
    "}",
    "",
    "let rows: MediaRow[] = [];",
    "try {",
    "  const result = await env.DB.prepare(",
    '    "SELECT key, alt, caption, width, height FROM media" +',
    "      \" WHERE content_type LIKE 'image/%' ORDER BY uploaded_at DESC LIMIT 120\",",
    "  ).all<MediaRow>();",
    "  rows = result.results ?? [];",
    "} catch {",
    "  // No DB binding yet (pre-provision) — render the empty state.",
    "}",
    "",
    "const items: GalleryItem[] = rows.map((row) => ({",
    `  src: \`${mediaBase}/\${row.key}\`,`,
    '  // An asset with no alt gets "" rather than its filename: an empty alt makes',
    "  // a screen reader skip a decorative tile, while a filename is read aloud",
    "  // character by character and tells the listener nothing.",
    '  alt: row.alt ?? "",',
    "  ...(row.caption ? { caption: row.caption } : {}),",
    "  ...(row.width ? { width: row.width } : {}),",
    "  ...(row.height ? { height: row.height } : {}),",
    "}));",
    "---",
    "",
    '<Site title="Work">',
    '  <main class="mx-auto max-w-6xl px-6 py-16">',
    '    <h1 class="text-4xl font-bold">Work</h1>',
    "    {",
    "      items.length > 0 ? (",
    '        <JustifiedGallery items={items} class="mt-8" />',
    "      ) : (",
    '        <p class="mt-6 opacity-70">',
    "          Upload images in the media library and they&apos;ll appear here.",
    "        </p>",
    "      )",
    "    }",
    "  </main>",
    "</Site>",
    "",
  ].join("\n");
}
