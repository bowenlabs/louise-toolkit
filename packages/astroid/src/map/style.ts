// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// A MapLibre style, built from brand colours.
//
// Deliberately dependency-free: a style is JSON, so this returns a plain object
// rather than importing `maplibre-gl` (a megabyte) or `protomaps-themes-base`
// for its types. astroidjs stays installable by a project that will never draw
// a map, and a project that wants Protomaps' full maintained theme can swap
// this out — the only contract is "an object MapLibre accepts".
//
// The layer set is the quiet-basemap subset: land, water, green space, a road
// ramp with casings, buildings, and admin boundaries. Labels are opt-in and
// need `glyphs`, because self-hosted SDF glyph ranges are a provisioning step
// (and the reason the reference site could keep `font-src 'self'`).
//
// Source layer names follow the Protomaps v3 schema, which is what a `pmtiles`
// archive built with `pmtiles extract` / planetiler contains.

/** Brand colours the style is built from. Every one has a sensible default, so
 *  `astroidMapStyle({ pmtilesUrl })` already produces a usable map. */
export interface MapColors {
  /** Land / page background. */
  land?: string;
  water?: string;
  /** Parks, woods, scrub. */
  green?: string;
  /** Minor roads. */
  road?: string;
  /** Arterials and highways. */
  arterial?: string;
  /** Hairline road edges. */
  casing?: string;
  building?: string;
  boundary?: string;
  /** Label ink, when `glyphs` is supplied. */
  label?: string;
  /** Label halo, when `glyphs` is supplied. */
  labelHalo?: string;
}

const DEFAULTS: Required<MapColors> = {
  land: "#faf7ef",
  water: "#9fdad8",
  green: "#e9efdc",
  road: "#fffdf7",
  arterial: "#f3eee0",
  casing: "#ece5d2",
  building: "#f0e9d9",
  boundary: "#cfc6b0",
  label: "#2a2a2a",
  labelHalo: "#fffdf7",
};

export interface MapStyleOptions {
  /**
   * URL of the archive, same-origin. Passed to MapLibre as `pmtiles://<url>`,
   * which the `pmtiles` protocol handler turns into range reads.
   */
  pmtilesUrl: string;
  colors?: MapColors;
  /**
   * SDF glyph URL template (e.g. `"/map/fonts/{fontstack}/{range}.pbf"`).
   * Omit for an unlabelled map — which is the honest default, since labels
   * without self-hosted glyphs mean an external font host and a looser CSP.
   */
  glyphs?: string;
  /** Font stack for labels. Only used when `glyphs` is set. */
  fontstack?: string;
  /** Attribution shown in the corner. Protomaps basemaps derive from OSM, and
   *  the licence requires the credit — so it defaults to present, not absent. */
  attribution?: string;
}

/** A MapLibre style. Typed loosely on purpose — see the header. */
export interface MapStyle {
  version: 8;
  glyphs?: string;
  sources: Record<string, unknown>;
  layers: Record<string, unknown>[];
}

/**
 * Build a brand-recoloured basemap style over a self-hosted PMTiles archive.
 *
 * ```ts
 * const style = astroidMapStyle({
 *   pmtilesUrl: `${location.origin}/map/basemap.pmtiles`,
 *   colors: { water: theme.colors.brand },
 * });
 * ```
 */
export function astroidMapStyle(options: MapStyleOptions): MapStyle {
  const c = { ...DEFAULTS, ...options.colors };
  const {
    pmtilesUrl,
    glyphs,
    fontstack = "Noto Sans Regular",
    attribution = '<a href="https://openstreetmap.org">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
  } = options;

  const layers: Record<string, unknown>[] = [
    { id: "background", type: "background", paint: { "background-color": c.land } },
    {
      id: "earth",
      type: "fill",
      source: "protomaps",
      "source-layer": "earth",
      paint: { "fill-color": c.land },
    },
    {
      id: "landuse",
      type: "fill",
      source: "protomaps",
      "source-layer": "landuse",
      // Only the green classes; leaving the rest unpainted keeps the map quiet
      // rather than blotchy.
      filter: ["in", "pmap:kind", "park", "forest", "wood", "grass", "scrub", "farmland"],
      paint: { "fill-color": c.green },
    },
    {
      id: "water",
      type: "fill",
      source: "protomaps",
      "source-layer": "water",
      paint: { "fill-color": c.water },
    },
    {
      id: "buildings",
      type: "fill",
      source: "protomaps",
      "source-layer": "buildings",
      // Buildings only resolve once you're zoomed in; drawing them earlier is
      // noise at city scale.
      minzoom: 14,
      paint: { "fill-color": c.building },
    },
    // Casings sit UNDER the road fills, so a road reads as a stroked ribbon
    // rather than a flat band. Order matters more than colour here.
    {
      id: "roads-casing",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      paint: {
        "line-color": c.casing,
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 1.5, 16, 10],
      },
    },
    {
      id: "roads",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      paint: {
        "line-color": [
          "match",
          ["get", "pmap:kind"],
          "highway",
          c.arterial,
          "major_road",
          c.arterial,
          c.road,
        ],
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 0.8, 16, 7],
      },
    },
    {
      id: "boundaries",
      type: "line",
      source: "protomaps",
      "source-layer": "boundaries",
      paint: { "line-color": c.boundary, "line-width": 0.8, "line-dasharray": [3, 2] },
    },
  ];

  if (glyphs) {
    layers.push(
      {
        id: "roads-labels",
        type: "symbol",
        source: "protomaps",
        "source-layer": "roads",
        minzoom: 14,
        layout: {
          "text-field": ["get", "name"],
          "text-font": [fontstack],
          "text-size": 11,
          "symbol-placement": "line",
        },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.5 },
      },
      {
        id: "places-labels",
        type: "symbol",
        source: "protomaps",
        "source-layer": "places",
        layout: { "text-field": ["get", "name"], "text-font": [fontstack], "text-size": 13 },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.5 },
      },
    );
  }

  return {
    version: 8,
    ...(glyphs ? { glyphs } : {}),
    sources: {
      protomaps: {
        type: "vector",
        // The `pmtiles://` prefix is what routes reads through the protocol
        // handler the page registers, instead of MapLibre fetching tile URLs.
        url: `pmtiles://${pmtilesUrl}`,
        attribution,
      },
    },
    layers,
  };
}
