// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The map module's scaffold-once files: the tile route and `<MapEmbed>`.
//
// GENERATED rather than shipped as a component, for a concrete reason. MapLibre
// GL is ~1 MB and `pmtiles` is its companion; a `MapEmbed.astro` living in
// astroid's own `src/components/` would make both a hard requirement of the
// package — every project installing them, and the CI probe that type-checks
// the component library needing them too — for a feature most sites never turn
// on. Generating the component into the projects that enable the module keeps
// the dependency where the decision was made.
//
// It also puts the pin, the gesture handling, and the placeholder in the
// project's hands, which is right: those are brand, and brand is site-owned.

import type { AstroidConfig } from "../config.js";

/** Default R2 object key for the basemap archive. */
export const ASTROID_PMTILES_KEY = "map/basemap.pmtiles";
/** Default route the archive is served from, same-origin. */
export const ASTROID_PMTILES_PATH = "/map/basemap.pmtiles";

/** True when this project switched the map module on. */
export const usesMap = (config: AstroidConfig): boolean =>
  (config.modules ?? []).includes("map");

/**
 * `src/pages/map/basemap.pmtiles.ts` — the range-serving tile route.
 *
 * Thin: `servePmtiles` owns range parsing, the 206/416 contract, and trusting
 * R2's clamped range over the requested one. What's here is which bucket and
 * which key.
 */
export function generateMapTileRoute(config: AstroidConfig): string | null {
  if (!usesMap(config)) return null;

  return [
    "// Serves the self-hosted Protomaps basemap (one PMTiles archive) from R2,",
    "// same-origin, with HTTP range support — the client reads only the byte",
    "// ranges it needs per tile.",
    "//",
    "// Same-origin is the point: no external tile host and no API key means the",
    "// CSP stays at `connect-src 'self'`, and any CORS policy on the bucket is",
    "// irrelevant.",
    "//",
    "// Upload an archive to this key before the map draws anything (until then",
    "// the canvas shows its background and pin — the module is dormant, not",
    "// broken):",
    `//   wrangler r2 object put ${config.key}-media/${ASTROID_PMTILES_KEY} \\`,
    "//     --file=extract.pmtiles --content-type=application/octet-stream --remote",
    "//",
    "// Build an extract for your area with the Protomaps CLI:",
    "//   pmtiles extract https://build.protomaps.com/<date>.pmtiles extract.pmtiles \\",
    "//     --bbox=<minLon,minLat,maxLon,maxLat>",
    'import type { APIRoute } from "astro";',
    'import { servePmtiles } from "astroidjs";',
    'import { env } from "cloudflare:workers";',
    "",
    "export const prerender = false;",
    "",
    `const KEY = ${JSON.stringify(ASTROID_PMTILES_KEY)};`,
    "",
    "export const GET: APIRoute = ({ request }) =>",
    "  servePmtiles(request, {",
    "    // The reader is a closure rather than the bucket itself: R2Bucket.get is",
    "    // overloaded with a required-options first signature, which no structural",
    "    // interface can accept. Calling it here uses R2's own types.",
    "    read: (range) => env.MEDIA.get(KEY, range ? { range } : undefined),",
    "  });",
    "",
    "// HEAD lets a client learn the archive's length before ranging into it.",
    "export const HEAD = GET;",
    "",
  ].join("\n");
}

/**
 * `src/components/MapEmbed.astro` — the map itself.
 *
 * The lazy load is not an optimisation detail, it's the reason this is usable:
 * MapLibre is ~1 MB, and a location map is almost always below the fold. The
 * library is fetched only once a container nears the viewport, and memoized so
 * two maps on a page download it once.
 */
export function generateMapEmbedComponent(config: AstroidConfig): string | null {
  if (!usesMap(config)) return null;
  const brand = config.theme.colors.brand;

  return [
    "---",
    "// A MapLibre map over the self-hosted PMTiles basemap, centred on exact",
    "// coordinates. Scaffolded once; yours to edit — the pin, the gestures, and",
    "// the placeholder are brand decisions.",
    "//",
    "// Coordinates, never a geocoded address string: geocoding at render time is",
    "// a network call that can fail, drift, or land on the wrong side of the",
    "// street. Renders the slot (your placeholder) when they're missing.",
    'import { astroidMapStyle } from "astroidjs";',
    "",
    "interface Props {",
    "  // Section fields arrive as strings; a literal number is fine too.",
    "  lat?: number | string;",
    "  lng?: number | string;",
    "  zoom?: number;",
    "  aspect?: string;",
    "}",
    "",
    'const { lat, lng, zoom = 15, aspect = "4/3" } = Astro.props;',
    'const num = (v: number | string | undefined) => (v === "" || v == null ? Number.NaN : Number(v));',
    "const nlat = num(lat);",
    "const nlng = num(lng);",
    "const show = Number.isFinite(nlat) && Number.isFinite(nlng);",
    "",
    "// Built here and handed to the client as data, so the brand palette lives in",
    "// one place instead of being duplicated into the script.",
    "const style = JSON.stringify(",
    "  astroidMapStyle({",
    `    pmtilesUrl: ${JSON.stringify(ASTROID_PMTILES_PATH)},`,
    `    colors: { water: ${JSON.stringify(brand)} },`,
    "  }),",
    ");",
    "---",
    "",
    "{",
    "  show ? (",
    '    <div',
    '      class="astroid-map"',
    "      data-astroid-map",
    "      data-lat={nlat}",
    "      data-lng={nlng}",
    "      data-zoom={zoom}",
    "      data-style={style}",
    "      style={`aspect-ratio:${aspect}`}",
    "    />",
    "  ) : (",
    "    <slot />",
    "  )",
    "}",
    "",
    "<style>",
    "  .astroid-map {",
    "    overflow: hidden;",
    "    border-radius: 1rem;",
    `    background: ${brand}1a;`,
    "  }",
    "</style>",
    "",
    "<script>",
    "  // MapLibre is ~1 MB and a location map is almost always below the fold, so",
    "  // nothing is downloaded until a container nears the viewport. The loader is",
    "  // memoized: two maps on a page fetch the library once.",
    '  const els = [...document.querySelectorAll<HTMLElement>("[data-astroid-map]")];',
    "",
    "  if (els.length > 0) {",
    "    let loader: Promise<{ maplibregl: any; Protocol: any }> | null = null;",
    "    const load = () =>",
    "      (loader ??= Promise.all([",
    '        import("maplibre-gl"),',
    '        import("pmtiles"),',
    '        import("maplibre-gl/dist/maplibre-gl.css"),',
    "      ]).then(([maplibre, pmtiles]) => ({",
    "        // maplibre-gl ships as CJS: under ESM interop the API may be on",
    "        // `.default` or be the namespace itself. Accept either.",
    "        maplibregl: (maplibre as any).default ?? maplibre,",
    "        Protocol: (pmtiles as any).Protocol,",
    "      })));",
    "",
    "    const init = async (el: HTMLElement) => {",
    '      const lat = Number(el.dataset.lat);',
    '      const lng = Number(el.dataset.lng);',
    "      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;",
    "",
    "      const { maplibregl, Protocol } = await load();",
    '      // Register the pmtiles:// protocol once so MapLibre range-reads the',
    "      // archive instead of requesting tile URLs.",
    '      maplibregl.addProtocol("pmtiles", new Protocol().tile);',
    "",
    "      const map = new maplibregl.Map({",
    "        container: el,",
    '        style: JSON.parse(el.dataset.style ?? "{}"),',
    "        center: [lng, lat],",
    '        zoom: Number(el.dataset.zoom ?? 15),',
    "        // A map that swallows page scroll is a trap on mobile; cooperative",
    "        // gestures require an explicit modifier/two fingers to pan.",
    "        cooperativeGestures: true,",
    "        dragRotate: false,",
    "        pitchWithRotate: false,",
    "        touchPitch: false,",
    "      });",
    '      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");',
    "",
    "      const pin = document.createElement(\"div\");",
    "      pin.style.cssText =",
    `        "width:18px;height:18px;border-radius:999px;background:${brand};" +`,
    '        "border:3px solid #fff;box-shadow:0 0 0 6px rgba(0,0,0,0.12);";',
    "      new maplibregl.Marker({ element: pin }).setLngLat([lng, lat]).addTo(map);",
    "    };",
    "",
    "    const io = new IntersectionObserver(",
    "      (entries, obs) => {",
    "        for (const entry of entries) {",
    "          if (!entry.isIntersecting) continue;",
    "          obs.unobserve(entry.target);",
    "          init(entry.target as HTMLElement);",
    "        }",
    "      },",
    '      { rootMargin: "200px" },',
    "    );",
    "    for (const el of els) io.observe(el);",
    "  }",
    "</script>",
    "",
  ].join("\n");
}

/** The npm dependencies the map module needs in the scaffold. */
export const ASTROID_MAP_DEPENDENCIES = {
  "maplibre-gl": "^5.9.0",
  pmtiles: "^4.4.0",
} as const;
