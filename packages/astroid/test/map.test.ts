import { describe, expect, it } from "vitest";
import { astroidCspOrigins } from "../src/astro/csp.js";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import { parseRangeHeader, type RangeReader, servePmtiles } from "../src/map/pmtiles.js";
import { generateMapEmbedComponent, generateMapTileRoute, usesMap } from "../src/map/scaffold.js";
import { astroidMapStyle } from "../src/map/style.js";

const SIZE = 10_000;

/** A reader over a fixed-size object, honouring offset/length/suffix the way R2
 *  does — including clamping a range that runs past the end. */
function bucket(size: number | null = SIZE): { read: RangeReader; asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    async read(range) {
      if (size === null) return null;
      asked.push(range ?? null);
      if (!range) return { body: null, size };
      if ("suffix" in range) {
        return { body: null, size, range: { offset: size - range.suffix, length: range.suffix } };
      }
      const offset = range.offset;
      const length = Math.min(range.length ?? size - offset, size - offset);
      return { body: null, size, range: { offset, length } };
    },
  };
}

const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("https://example.test/map/basemap.pmtiles", { method, headers });

describe("parseRangeHeader", () => {
  it("parses a bounded window", () => {
    expect(parseRangeHeader("bytes=0-1023", SIZE)).toEqual({
      kind: "range",
      offset: 0,
      length: 1024,
    });
  });

  it("parses an open-ended range", () => {
    expect(parseRangeHeader("bytes=1024-", SIZE)).toEqual({ kind: "range", offset: 1024 });
  });

  it("parses a SUFFIX range — the form the reference dropped", () => {
    // `bytes=-20000` means "the last n bytes", which is how a client reads a
    // footer without knowing the length. The implementation this generalizes
    // matched only `<start>-<end?>`, so this fell through to serving the ENTIRE
    // archive — a correct-looking response and a catastrophic one.
    expect(parseRangeHeader("bytes=-2000", SIZE)).toEqual({ kind: "suffix", suffix: 2000 });
  });

  it("clamps rather than failing when a range runs past the end", () => {
    expect(parseRangeHeader("bytes=9000-99999", SIZE)).toEqual({
      kind: "range",
      offset: 9000,
      length: 1000,
    });
    // A suffix longer than the object legally means the whole object.
    expect(parseRangeHeader("bytes=-99999", SIZE)).toEqual({ kind: "suffix", suffix: SIZE });
  });

  it("reports unsatisfiable ranges", () => {
    expect(parseRangeHeader("bytes=10000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=500-100", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores what it can't parse, per RFC 9110", () => {
    // An unparseable Range is ignored (serve the whole object), not rejected.
    for (const header of ["", "items=0-1", "bytes=abc", "bytes=", null]) {
      expect(parseRangeHeader(header, SIZE)).toBeNull();
    }
    // Multi-range needs a multipart response no PMTiles client asks for.
    expect(parseRangeHeader("bytes=0-99,200-299", SIZE)).toBeNull();
  });
});

describe("servePmtiles", () => {
  const opts = (b: { read: RangeReader }) => ({ read: b.read });

  it("serves the whole archive without a Range header", async () => {
    const res = await servePmtiles(get(), opts(bucket()));
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(SIZE));
  });

  it("answers a bounded range with 206 and an exact Content-Range", async () => {
    const res = await servePmtiles(get({ range: "bytes=0-1023" }), opts(bucket()));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-1023/${SIZE}`);
    expect(res.headers.get("content-length")).toBe("1024");
  });

  it("answers a suffix range against the END of the archive", async () => {
    const b = bucket();
    const res = await servePmtiles(get({ range: "bytes=-2000" }), opts(b));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 8000-9999/${SIZE}`);
    // And it asks R2 for a suffix rather than computing an offset itself.
    expect(b.asked.at(-1)).toEqual({ suffix: 2000 });
  });

  it("416s an unsatisfiable range, naming the real length", async () => {
    const res = await servePmtiles(get({ range: "bytes=99999-" }), opts(bucket()));
    expect(res.status).toBe(416);
    // RFC 9110: the 416 states the length so the client can retry correctly.
    expect(res.headers.get("content-range")).toBe(`bytes */${SIZE}`);
  });

  it("trusts what R2 returned over what was asked for", async () => {
    // R2 clamps; a Content-Range that disagrees with the body corrupts the
    // client's view of the archive.
    const res = await servePmtiles(get({ range: "bytes=9500-99999" }), opts(bucket()));
    expect(res.headers.get("content-range")).toBe(`bytes 9500-9999/${SIZE}`);
    expect(res.headers.get("content-length")).toBe("500");
  });

  it("404s a missing archive rather than erroring", async () => {
    // The module is usable before anyone uploads a basemap — dormant, not broken.
    expect((await servePmtiles(get(), opts(bucket(null)))).status).toBe(404);
    expect((await servePmtiles(get({ range: "bytes=0-10" }), opts(bucket(null)))).status).toBe(404);
  });

  it("answers HEAD with the headers but no body", async () => {
    const res = await servePmtiles(get({}, "HEAD"), opts(bucket()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(SIZE));
    expect(res.body).toBeNull();
  });

  it("caches hard — the archive is immutable", async () => {
    const res = await servePmtiles(get(), opts(bucket()));
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });
});

describe("astroidMapStyle", () => {
  it("routes the source through the pmtiles protocol", () => {
    const style = astroidMapStyle({ pmtilesUrl: "/map/basemap.pmtiles" });
    expect((style.sources.protomaps as { url: string }).url).toBe(
      "pmtiles:///map/basemap.pmtiles",
    );
    expect(style.version).toBe(8);
  });

  it("applies brand colours over the defaults", () => {
    const style = astroidMapStyle({ pmtilesUrl: "/x", colors: { water: "#123456" } });
    const water = style.layers.find((l) => l.id === "water") as { paint: Record<string, string> };
    expect(water.paint["fill-color"]).toBe("#123456");
    // Unset colours keep their default rather than becoming undefined.
    const bg = style.layers.find((l) => l.id === "background") as {
      paint: Record<string, string>;
    };
    expect(bg.paint["background-color"]).toBe("#faf7ef");
  });

  it("omits labels unless glyphs are supplied", () => {
    // Labels without self-hosted glyphs mean an external font host and a looser
    // CSP, so unlabelled is the honest default.
    const plain = astroidMapStyle({ pmtilesUrl: "/x" });
    expect(plain.glyphs).toBeUndefined();
    expect(plain.layers.some((l) => l.type === "symbol")).toBe(false);

    const labelled = astroidMapStyle({ pmtilesUrl: "/x", glyphs: "/map/fonts/{fontstack}/{range}.pbf" });
    expect(labelled.glyphs).toBe("/map/fonts/{fontstack}/{range}.pbf");
    expect(labelled.layers.some((l) => l.type === "symbol")).toBe(true);
  });

  it("draws road casings beneath the roads", () => {
    // Order is the whole trick — casings on top would draw over the fills.
    const style = astroidMapStyle({ pmtilesUrl: "/x" });
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf("roads-casing")).toBeLessThan(ids.indexOf("roads"));
  });

  it("credits OpenStreetMap by default", () => {
    // Protomaps basemaps derive from OSM and the licence requires the credit,
    // so attribution defaults to present.
    const source = astroidMapStyle({ pmtilesUrl: "/x" }).sources.protomaps as {
      attribution: string;
    };
    expect(source.attribution).toContain("OpenStreetMap");
  });
});

describe("map scaffold", () => {
  const config = (modules: AstroidConfig["modules"] = []): AstroidConfig =>
    defineAstroid({
      key: "acme",
      archetype: "storefront",
      theme: { name: "Acme", colors: { brand: "#1f6f78" } },
      modules,
    });

  it("emits nothing unless the module is enabled", () => {
    expect(usesMap(config())).toBe(false);
    expect(generateMapTileRoute(config())).toBeNull();
    expect(generateMapEmbedComponent(config())).toBeNull();
  });

  it("scaffolds the tile route and the component when it is", () => {
    const withMap = config(["map"]);
    expect(usesMap(withMap)).toBe(true);
    const route = generateMapTileRoute(withMap) as string;
    expect(route).toContain("servePmtiles");
    expect(route).toContain("map/basemap.pmtiles");
    // HEAD matters: a client learns the length before ranging into the archive.
    expect(route).toContain("export const HEAD = GET;");
    // And it tells you how to actually get an archive there.
    expect(route).toContain("wrangler r2 object put");
    expect(route).toContain("pmtiles extract");
  });

  it("bakes the brand colour into the generated component", () => {
    const component = generateMapEmbedComponent(config(["map"])) as string;
    expect(component).toContain("#1f6f78");
    // Lazy-loaded: MapLibre is ~1 MB and the map is usually below the fold.
    expect(component).toContain("IntersectionObserver");
    expect(component).toContain('import("maplibre-gl")');
    // Balanced frontmatter, or the whole component renders blank.
    expect(component.split("\n").filter((l) => l.trim() === "---")).toHaveLength(2);
  });

  it("allows blob: workers in the CSP only when the map is on", () => {
    // MapLibre builds its tile-decoding workers from blob: URLs; without this
    // the canvas is empty and the console fills with worker errors.
    expect(astroidCspOrigins(config(["map"])).worker).toContain("blob:");
    expect(astroidCspOrigins(config()).worker).not.toContain("blob:");
  });

  it("keeps connect-src free of any tile host", () => {
    // The entire argument for the self-hosted basemap: same-origin archive, so
    // there is no third party to allow.
    const origins = astroidCspOrigins(config(["map"]));
    expect(origins.connect.some((o) => /tile|maptiler|mapbox|protomaps/i.test(o))).toBe(false);
  });
});
