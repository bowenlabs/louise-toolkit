import { afterEach, describe, expect, it, vi } from "vitest";
import { defineImageProxy } from "../../src/core/media/index.js";

// The scenario is themidwestartist.com's /api/img/fw: signed third-party image
// URLs fixed at 1920px, resized at the edge on the way through.

const HOST = "imgproxy.example.dev";
const SRC = `https://${HOST}/sig/w:1920/photo.jpg`;
const proxy = defineImageProxy({ path: "/api/img", allowHosts: [HOST], widths: [640, 320, 960] });

const req = (params: Record<string, string>, accept = "image/avif,image/webp,*/*") =>
  new Request(`https://site.example/api/img?${new URLSearchParams(params)}`, {
    headers: { accept },
  });

function stubFetch(response: () => Response | Promise<Response>) {
  const calls: { url: string; cf: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit & { cf?: unknown }) => {
      calls.push({ url, cf: init.cf });
      return response();
    }),
  );
  return calls;
}
const image = (type = "image/avif") =>
  new Response("bytes", { status: 200, headers: { "content-type": type } });

afterEach(() => vi.unstubAllGlobals());

describe("defineImageProxy — handle", () => {
  it("resizes an allowed image at an allowed width, negotiating the format", async () => {
    const calls = stubFetch(() => image());
    const res = await proxy.handle(req({ src: SRC, w: "640" }));
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual({
      url: SRC,
      cf: { image: { width: 640, fit: "scale-down", format: "avif" } },
    });
    expect(res.headers.get("vary")).toBe("Accept");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("falls back to webp, then to no format, by Accept", async () => {
    const calls = stubFetch(() => image("image/webp"));
    await proxy.handle(req({ src: SRC, w: "640" }, "image/webp,*/*"));
    await proxy.handle(req({ src: SRC, w: "640" }, "image/jpeg"));
    expect((calls[0]?.cf as { image: { format?: string } }).image.format).toBe("webp");
    expect((calls[1]?.cf as { image: object }).image).not.toHaveProperty("format");
  });

  it("refuses any other host — it is not an open proxy", async () => {
    const calls = stubFetch(() => image());
    for (const src of [
      "https://evil.example/x.jpg",
      `https://${HOST}@evil.example/x.jpg`, // userinfo trick: host is evil.example
      `http://${HOST}/x.jpg`, // not https
      `https://${HOST}:8443/x.jpg`, // same hostname, other port
      `https://sub.${HOST}/x.jpg`,
      "not a url",
      "",
    ]) {
      expect((await proxy.handle(req({ src, w: "640" }))).status, src).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a width outside the configured set", async () => {
    const calls = stubFetch(() => image());
    for (const w of ["641", "1920", "0", "", "abc"]) {
      expect((await proxy.handle(req({ src: SRC, w }))).status, w).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("redirects to the original when the resize fails, whatever the reason", async () => {
    // Locally, or on a zone without Image Resizing, this is every request.
    for (const failing of [
      () => new Response("nope", { status: 500 }),
      () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => Promise.reject(new Error("network")),
    ]) {
      stubFetch(failing);
      const res = await proxy.handle(req({ src: SRC, w: "640" }));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(SRC);
    }
  });

  it("can answer 502 instead of redirecting", async () => {
    stubFetch(() => new Response("nope", { status: 500 }));
    const strict = defineImageProxy({
      path: "/api/img",
      allowHosts: [HOST],
      widths: [640],
      onFailure: "error",
    });
    expect((await strict.handle(req({ src: SRC, w: "640" }))).status).toBe(502);
  });

  it("passes quality, fit, edge cache and Cache-Control only when configured", async () => {
    const calls = stubFetch(() => image());
    const tuned = defineImageProxy({
      path: "/api/img",
      allowHosts: [HOST],
      widths: [640],
      quality: 82,
      fit: "cover",
      edgeCacheTtl: 2_592_000,
      cacheControl: "public, max-age=31536000, immutable",
    });
    const res = await tuned.handle(req({ src: SRC, w: "640" }));
    expect(calls[0]?.cf).toEqual({
      image: { width: 640, fit: "cover", quality: 82, format: "avif" },
      cacheEverything: true,
      cacheTtl: 2_592_000,
    });
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("defineImageProxy — url / srcset", () => {
  it("builds the proxied URL from the same config the route checks", () => {
    const u = proxy.url(SRC, 640);
    expect(u.startsWith("/api/img?")).toBe(true);
    const q = new URL(u, "https://site.example").searchParams;
    expect(q.get("w")).toBe("640");
    expect(q.get("src")).toBe(SRC);
  });

  it("leaves another host's image untouched", () => {
    expect(proxy.url("https://cdn.other.example/a.jpg", 640)).toBe(
      "https://cdn.other.example/a.jpg",
    );
    expect(proxy.srcset("https://cdn.other.example/a.jpg")).toBeUndefined();
  });

  it("emits every configured width, ascending", () => {
    const widths = proxy
      .srcset(SRC)
      ?.split(", ")
      .map((part) => part.split(" ")[1]);
    expect(widths).toEqual(["320w", "640w", "960w"]);
  });

  it("round-trips: every srcset URL is one the route accepts", async () => {
    stubFetch(() => image());
    for (const part of proxy.srcset(SRC)?.split(", ") ?? []) {
      const path = part.split(" ")[0] ?? "";
      const res = await proxy.handle(new Request(new URL(path, "https://site.example")));
      expect(res.status, path).toBe(200);
    }
  });

  it("honours custom parameter names on both sides", async () => {
    stubFetch(() => image());
    const custom = defineImageProxy({
      path: "/img",
      allowHosts: [HOST],
      widths: [640],
      params: { src: "u", width: "size" },
    });
    const path = custom.url(SRC, 640);
    expect(path).toContain("size=640");
    expect((await custom.handle(new Request(new URL(path, "https://s.example")))).status).toBe(200);
  });
});
