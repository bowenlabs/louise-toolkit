import { describe, expect, it, vi } from "vitest";
import { crawlSite, pageSignals } from "../../src/core/browser/index.js";

// #588: the health scan's crawl—redirects, indexing directives, duplicate titles.

const html = (body: string, head = "") =>
  new Response(`<html><head>${head}</head><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const redirect = (to: string, status = 301) =>
  new Response(null, { status, headers: { location: to } });

/** A fake site: `routes[url]` answers; anything else is a 404. */
function site(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const answer = routes[String(input)];
    return answer ? answer() : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("pageSignals", () => {
  it("reads robots from the meta tag and the header, plus canonical, title, and description", () => {
    const signals = pageSignals(
      `<head><title> About &amp; us </title>
        <meta name="robots" content="NoFollow">
        <meta name="description" content="Who we are">
        <link rel="canonical" href="/about"></head>`,
      new Headers({ "x-robots-tag": "googlebot: noindex" }),
      "https://example.com/about?x=1",
    );
    expect(signals).toEqual({
      robots: ["noindex", "nofollow"],
      noindex: true,
      canonical: "https://example.com/about",
      title: "About & us",
      description: "Who we are",
    });
  });

  it("treats `none` as noindex, and leaves out what the page doesn't have", () => {
    expect(
      pageSignals('<meta name="robots" content="none">', new Headers(), "https://example.com/"),
    ).toEqual({
      robots: ["none"],
      noindex: true,
    });
  });
});

describe("crawlSite", () => {
  it("follows same-origin pages within the caps", async () => {
    const fetchImpl = site({
      "https://example.com/": () => html('<a href="/a">a</a><a href="/b">b</a>'),
      "https://example.com/a": () => html('<a href="/a/deep">deep</a>'),
      "https://example.com/b": () => html(""),
      "https://example.com/a/deep": () => html('<a href="/too-deep">x</a>'),
    });
    const report = await crawlSite({
      base: "https://example.com",
      paths: ["/"],
      fetch: fetchImpl,
      crawl: { maxPages: 10, maxDepth: 2 },
    });
    expect(report.pages).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/a/deep",
    ]);
    // Past maxDepth, a link is checked but its page isn't read.
    expect(report.brokenLinks).toEqual([
      { url: "https://example.com/too-deep", from: "https://example.com/a/deep", status: 404 },
    ]);
  });

  it("reports an internal redirect against the page holding the link, and a chain", async () => {
    const fetchImpl = site({
      "https://example.com/": () => html('<a href="/old">old</a><a href="/older">older</a>'),
      "https://example.com/old": () => redirect("/new"),
      "https://example.com/older": () => redirect("/old", 308),
      "https://example.com/new": () => html(""),
    });
    const report = await crawlSite({ base: "https://example.com", paths: ["/"], fetch: fetchImpl });
    expect(report.redirects).toEqual([
      {
        url: "https://example.com/old",
        from: "https://example.com/",
        status: 301,
        to: "https://example.com/new",
        hops: 1,
        finalStatus: 200,
      },
      {
        url: "https://example.com/older",
        from: "https://example.com/",
        status: 308,
        to: "https://example.com/new",
        hops: 2,
        finalStatus: 200,
      },
    ]);
    expect(report.brokenLinks).toEqual([]);
  });

  it("counts a redirect that ends at an error as broken too", async () => {
    const fetchImpl = site({
      "https://example.com/": () => html('<a href="/moved">m</a>'),
      "https://example.com/moved": () => redirect("/gone"),
    });
    const report = await crawlSite({ base: "https://example.com", paths: ["/"], fetch: fetchImpl });
    expect(report.redirects[0]).toMatchObject({ finalStatus: 404 });
    expect(report.brokenLinks).toEqual([
      { url: "https://example.com/moved", from: "https://example.com/", status: 404 },
    ]);
  });

  it("stops a redirect loop", async () => {
    const fetchImpl = site({
      "https://example.com/": () => html('<a href="/loop">l</a>'),
      "https://example.com/loop": () => redirect("/loop"),
    });
    const report = await crawlSite({ base: "https://example.com", paths: ["/"], fetch: fetchImpl });
    expect(report.brokenLinks[0]).toMatchObject({
      url: "https://example.com/loop",
      status: "error",
    });
  });

  it("flags noindex, a canonical off the origin or at another page, and shared titles", async () => {
    const fetchImpl = site({
      "https://example.com/": () =>
        html(
          '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a>',
          "<title>Home</title>",
        ),
      "https://example.com/a": () =>
        html("", '<title>Shop</title><meta name="robots" content="noindex">'),
      "https://example.com/b": () =>
        html("", '<title>Shop</title><link rel="canonical" href="https://old.example.net/b">'),
      "https://example.com/c": () =>
        html("", '<title>Shop</title><link rel="canonical" href="/b">'),
      "https://example.com/d": () =>
        html("", '<title>Home</title><link rel="canonical" href="/d">'),
    });
    const report = await crawlSite({
      base: "https://example.com",
      paths: ["/"],
      fetch: fetchImpl,
      crawl: { maxPages: 10, maxDepth: 1 },
    });
    expect(report.indexing).toEqual([
      { url: "https://example.com/a", issue: "noindex" },
      {
        url: "https://example.com/b",
        issue: "canonical-off-origin",
        canonical: "https://old.example.net/b",
      },
      {
        url: "https://example.com/c",
        issue: "canonical-elsewhere",
        canonical: "https://example.com/b",
      },
    ]);
    // A noindex page's title doesn't count: it isn't competing in search.
    expect(report.duplicateTitles).toEqual([
      { title: "Home", pages: ["https://example.com/", "https://example.com/d"] },
      { title: "Shop", pages: ["https://example.com/b", "https://example.com/c"] },
    ]);
  });

  it("stops at maxRequests and says so", async () => {
    const fetchImpl = site({
      "https://example.com/": () => html('<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>'),
    });
    const report = await crawlSite({
      base: "https://example.com",
      paths: ["/"],
      fetch: fetchImpl,
      maxRequests: 2,
    });
    expect(report.truncated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("checks links past maxPages without reading them", async () => {
    const fetchImpl = site({
      "https://example.com/": () => html('<a href="/a">a</a><a href="/b">b</a>'),
      "https://example.com/a": () => html('<a href="/never">n</a>'),
      "https://example.com/b": () => html('<a href="/never">n</a>'),
    });
    const report = await crawlSite({
      base: "https://example.com",
      paths: ["/"],
      fetch: fetchImpl,
      crawl: { maxPages: 2, maxDepth: 3 },
    });
    expect(report.pages).toEqual(["https://example.com/", "https://example.com/a"]);
    expect(report.brokenLinks.map((b) => b.url)).toEqual(["https://example.com/never"]);
  });
});
