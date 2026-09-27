import { describe, expect, it } from "vitest";
import { seoHead } from "../src/seo.js";

const page = { slug: "about", title: "About" };

describe("seoHead", () => {
  it("takes the canonical origin from the configured site, not the request", () => {
    const html = seoHead(
      {
        site: new URL("https://example.com"),
        url: new URL("https://preview.example.net/about?ref=x"),
      },
      { page },
    );
    expect(html).toContain('<link rel="canonical" href="https://example.com/about">');
  });

  it("falls back to the request's origin without a configured site", () => {
    const html = seoHead({ url: new URL("https://example.com/about") }, { page });
    expect(html).toContain('<link rel="canonical" href="https://example.com/about">');
  });

  it("prefers an explicit origin over both", () => {
    const html = seoHead(
      { site: new URL("https://example.com"), url: new URL("https://example.com/about") },
      { page, origin: "https://www.example.com" },
    );
    expect(html).toContain('href="https://www.example.com/about"');
  });

  it("keeps the query parameters the page asks for", () => {
    const html = seoHead(
      { url: new URL("https://example.com/about?page=2&utm_source=mail") },
      { page, keepParams: ["page"] },
    );
    expect(html).toContain('href="https://example.com/about?page=2"');
  });
});
