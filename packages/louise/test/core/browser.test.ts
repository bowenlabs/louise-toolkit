import { describe, expect, it, vi } from "vitest";
import {
  checkLinks,
  createResvgRenderer,
  extractLinks,
  ogCacheKey,
  ogCardSvg,
  ogImage,
  type OgImageCache,
  wrapTitle,
} from "../../src/core/browser/index.js";

// --- ogImage / ogCacheKey --------------------------------------------------

function makeCache(): { cache: OgImageCache; store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    cache: {
      async get(key) {
        return store.get(key) ?? null;
      },
      async put(key, bytes) {
        store.set(key, bytes);
      },
    },
  };
}

describe("ogCacheKey", () => {
  it("is deterministic for the same slug+content and changes when content changes", async () => {
    const a = await ogCacheKey("/docs/guide", "hello");
    const b = await ogCacheKey("/docs/guide", "hello");
    const c = await ogCacheKey("/docs/guide", "hello world");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^og\/docs\/guide-[0-9a-f]{16}\.png$/);
  });

  it("sanitizes the slug and honors prefix/ext", async () => {
    const key = await ogCacheKey("/Weird Path!/x", "c", { prefix: "cards", ext: "webp" });
    expect(key).toMatch(/^cards\/Weird-Path-\/x-[0-9a-f]{16}\.webp$/);
  });
});

describe("ogImage", () => {
  it("renders and caches on a miss, then serves from cache with no second render", async () => {
    const { cache, store } = makeCache();
    const render = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const first = await ogImage({ cacheKey: "og/x.png", markup: "<h1>x</h1>", render, cache });
    expect(first).toEqual({ bytes: new Uint8Array([1, 2, 3]), cached: false });
    expect(render).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);

    const second = await ogImage({ cacheKey: "og/x.png", markup: "<h1>x</h1>", render, cache });
    expect(second.cached).toBe(true);
    expect(render).toHaveBeenCalledTimes(1); // NOT called again — no browser session
  });

  it("always renders when no cache is provided", async () => {
    const render = vi.fn(async () => new Uint8Array([9]));
    const res = await ogImage({ cacheKey: "k", markup: "<h1/>", render });
    expect(res).toEqual({ bytes: new Uint8Array([9]), cached: false });
    expect(render).toHaveBeenCalledTimes(1);
  });
});

// --- OG card SVG + resvg renderer ------------------------------------------

describe("wrapTitle", () => {
  it("wraps to fit the width and keeps every word", () => {
    const lines = wrapTitle("The V8-native toolkit for Cloudflare Workers", {
      maxWidth: 1040,
      fontSize: 76,
    });
    expect(lines.length).toBeGreaterThan(1);
    // No line exceeds the estimated character budget (1040 / (76*0.56) ≈ 24).
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
    // A short title stays on one line.
    expect(wrapTitle("Hello world", { maxWidth: 1040, fontSize: 76 })).toEqual(["Hello world"]);
  });

  it("caps lines and ellipsizes an overflowing title", () => {
    const lines = wrapTitle(
      "one two three four five six seven eight nine ten eleven twelve thirteen",
      { maxWidth: 200, fontSize: 76, maxLines: 2 },
    );
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("never drops a single word longer than a line", () => {
    const lines = wrapTitle("supercalifragilisticexpialidocious", { maxWidth: 100, fontSize: 76 });
    expect(lines).toEqual(["supercalifragilisticexpialidocious"]);
  });
});

describe("ogCardSvg", () => {
  it("emits a well-formed SVG with the brand, title, and footer", () => {
    const svg = ogCardSvg("Ship faster", { brand: "louise", footer: "louisetoolkit.com" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('viewBox="0 0 1200 630"');
    expect(svg).toContain(">louise<");
    expect(svg).toContain(">Ship faster<");
    expect(svg).toContain(">louisetoolkit.com<");
  });

  it("escapes XML-significant characters in dynamic text", () => {
    const svg = ogCardSvg('A & B <are> "quoted"');
    expect(svg).toContain("A &amp; B");
    expect(svg).toContain("&lt;are&gt;");
    expect(svg).not.toMatch(/<are>/);
  });
});

describe("createResvgRenderer", () => {
  function fakeResvg() {
    const ctorOpts: unknown[] = [];
    const Resvg = vi.fn(function (this: unknown, _svg: string, opts: unknown) {
      ctorOpts.push(opts);
      return {
        render: () => ({ asPng: () => new Uint8Array([137, 80, 78, 71]) }),
      };
    }) as unknown as typeof import("@resvg/resvg-wasm").Resvg;
    const initWasm = vi.fn(async () => {});
    return { mod: { initWasm, Resvg }, initWasm, ctorOpts };
  }

  it("initializes the WASM once across renders, then rasterizes to PNG bytes", async () => {
    const { mod, initWasm } = fakeResvg();
    const render = createResvgRenderer({
      wasm: new Uint8Array([0]),
      fonts: [new Uint8Array([1, 2, 3])],
      loadResvg: async () => mod,
    });

    const png = await render(ogCardSvg("hi"));
    expect(Array.from(png)).toEqual([137, 80, 78, 71]);
    expect(initWasm).toHaveBeenCalledTimes(1);

    // A second render — even a second renderer over the same module — must not
    // re-init (initWasm throws on a double init).
    await render(ogCardSvg("again"));
    const render2 = createResvgRenderer({
      wasm: new Uint8Array([0]),
      fonts: [],
      loadResvg: async () => mod,
    });
    await render2("<svg/>");
    expect(initWasm).toHaveBeenCalledTimes(1);
  });

  it("passes font buffers (normalized to Uint8Array) and fit options", async () => {
    const { mod, ctorOpts } = fakeResvg();
    const ab = new Uint8Array([9, 9]).buffer; // an ArrayBuffer, must be normalized
    const render = createResvgRenderer({
      wasm: new Uint8Array([0]),
      fonts: [ab],
      defaultFontFamily: "Roboto Flex",
      width: 1200,
      loadResvg: async () => mod,
    });
    await render("<svg/>");
    const opts = ctorOpts[0] as {
      fitTo: { mode: string; value?: number };
      font: { fontBuffers: Uint8Array[]; loadSystemFonts: boolean; defaultFontFamily?: string };
    };
    expect(opts.fitTo).toEqual({ mode: "width", value: 1200 });
    expect(opts.font.loadSystemFonts).toBe(false);
    expect(opts.font.defaultFontFamily).toBe("Roboto Flex");
    expect(opts.font.fontBuffers[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(opts.font.fontBuffers[0])).toEqual([9, 9]);
  });

  it("renders at intrinsic size when no width is given", async () => {
    const { mod, ctorOpts } = fakeResvg();
    const render = createResvgRenderer({
      wasm: new Uint8Array([0]),
      fonts: [],
      loadResvg: async () => mod,
    });
    await render("<svg/>");
    expect((ctorOpts[0] as { fitTo: unknown }).fitTo).toEqual({ mode: "original" });
  });
});

// --- link checking ---------------------------------------------------------

describe("extractLinks", () => {
  it("resolves relative hrefs and drops anchors / non-http schemes", () => {
    const html = `
      <a href="/docs/a">a</a>
      <a href="https://ext.example/b">b</a>
      <a href="#top">skip</a>
      <a href="mailto:x@y.z">skip</a>
      <a href="page">rel</a>`;
    const links = extractLinks(html, "https://site.example/docs/");
    expect(links).toContain("https://site.example/docs/a");
    expect(links).toContain("https://ext.example/b");
    expect(links).toContain("https://site.example/docs/page");
    expect(links.some((l) => l.includes("#top") || l.startsWith("mailto"))).toBe(false);
  });
});

describe("checkLinks", () => {
  it("reports broken links (non-ok / thrown) and skips healthy same-origin ones", async () => {
    const pages: Record<string, string> = {
      "https://site.example/docs/":
        '<a href="/ok">ok</a><a href="/gone">gone</a><a href="/boom">boom</a>',
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://site.example/docs/") return new Response(pages[url], { status: 200 });
      if (url === "https://site.example/ok") return new Response("", { status: 200 });
      if (url === "https://site.example/gone") return new Response("", { status: 404 });
      if (url === "https://site.example/boom") throw new Error("network");
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;

    const broken = await checkLinks({
      base: "https://site.example",
      paths: ["/docs/"],
      fetch: fetchImpl,
    });

    expect(broken).toContainEqual({
      url: "https://site.example/gone",
      from: "https://site.example/docs/",
      status: 404,
    });
    expect(broken).toContainEqual({
      url: "https://site.example/boom",
      from: "https://site.example/docs/",
      status: "error",
    });
    expect(broken.some((b) => b.url.endsWith("/ok"))).toBe(false);
  });

  it("skips external links when sameOriginOnly (default)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://site.example/p") {
        return new Response('<a href="https://other.example/x">ext</a>', { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const broken = await checkLinks({
      base: "https://site.example",
      paths: ["/p"],
      fetch: fetchImpl,
    });
    expect(broken).toEqual([]); // external 404 never checked
    // Only the page itself was fetched — the external link was skipped.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
