import { describe, expect, it, vi } from "vitest";
import {
  checkLinks,
  extractLinks,
  ogCacheKey,
  ogImage,
  type OgImageCache,
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

    const first = await ogImage({ cacheKey: "og/x.png", html: "<h1>x</h1>", render, cache });
    expect(first).toEqual({ bytes: new Uint8Array([1, 2, 3]), cached: false });
    expect(render).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);

    const second = await ogImage({ cacheKey: "og/x.png", html: "<h1>x</h1>", render, cache });
    expect(second.cached).toBe(true);
    expect(render).toHaveBeenCalledTimes(1); // NOT called again — no browser session
  });

  it("always renders when no cache is provided", async () => {
    const render = vi.fn(async () => new Uint8Array([9]));
    const res = await ogImage({ cacheKey: "k", html: "<h1/>", render });
    expect(res).toEqual({ bytes: new Uint8Array([9]), cached: false });
    expect(render).toHaveBeenCalledTimes(1);
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
