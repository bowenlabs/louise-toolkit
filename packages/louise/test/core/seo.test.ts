import { describe, expect, it } from "vitest";
import { edgeCacheKeyUrl } from "../../src/core/worker/edge-cache.js";
import {
  canonicalUrl,
  pageHead,
  renderHeadTags,
  SEO_DESCRIPTION_MAX,
  shareImageSource,
} from "../../src/core/seo/index.js";

const origin = "https://example.com";
const page = { slug: "about", title: "About us" };

describe("canonicalUrl", () => {
  it("drops every query parameter and the fragment by default", () => {
    expect(canonicalUrl(origin, "/about?utm_source=mail&louise=off#team")).toBe(
      "https://example.com/about",
    );
  });

  it("keeps the listed parameters, sorted", () => {
    expect(canonicalUrl(origin, "/shop?sort=price&page=2&ref=x", ["sort", "page"])).toBe(
      "https://example.com/shop?page=2&sort=price",
    );
  });

  it("takes the origin, not the request's host", () => {
    expect(canonicalUrl(origin, "https://preview.example.net/about")).toBe(
      "https://preview.example.net/about",
    );
    expect(canonicalUrl(origin, "/about")).toBe("https://example.com/about");
  });
});

describe("the shared query filter", () => {
  it("still gives the edge cache key its tracking-free, sorted query", () => {
    expect(edgeCacheKeyUrl("https://example.com/a?utm_source=x&b=2&a=1")).toBe(
      "https://example.com/a?a=1&b=2",
    );
    expect(edgeCacheKeyUrl("https://example.com/a")).toBe("https://example.com/a");
  });
});

describe("shareImageSource", () => {
  it("prefers the page's own image, then the card, then the default", () => {
    expect(
      shareImageSource({ ogImage: " /own.png ", cards: true, defaultImage: "/d.png" }),
    ).toEqual({ kind: "image", src: "/own.png" });
    expect(shareImageSource({ ogImage: "", cards: true, defaultImage: "/d.png" })).toEqual({
      kind: "card",
    });
    expect(shareImageSource({ cards: false, defaultImage: "/d.png" })).toEqual({
      kind: "image",
      src: "/d.png",
    });
    expect(shareImageSource({ defaultImage: "  " })).toEqual({ kind: "none" });
  });
});

describe("pageHead", () => {
  it("uses the SEO title and runs it through the template", () => {
    const head = pageHead({
      page: { ...page, seoTitle: "About Example Organization" },
      settings: { siteName: "Example Organization" },
      origin,
      path: "/about",
      titleTemplate: (title, site) => (site ? `${title} | ${site}` : title),
    });
    expect(head.title).toBe("About Example Organization | Example Organization");
    expect(head.og.title).toBe("About Example Organization");
    expect(head.og.siteName).toBe("Example Organization");
  });

  it("falls back from the SEO description to the body, then the site", () => {
    const withSeo = pageHead({
      page: { ...page, seoDescription: "Written by hand.", body: "<p>Body text.</p>" },
      origin,
      path: "/about",
    });
    expect(withSeo.description).toBe("Written by hand.");

    const fromBody = pageHead({
      page: { ...page, body: `<p>${"word ".repeat(60)}</p>` },
      settings: { metaDescription: "Site-wide." },
      origin,
      path: "/about",
    });
    expect(fromBody.description?.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX);
    expect(fromBody.description).toMatch(/^word word/);

    const fromSite = pageHead({
      page: { ...page, body: "<p></p>" },
      settings: { metaDescription: "Site-wide." },
      origin,
      path: "/about",
    });
    expect(fromSite.description).toBe("Site-wide.");
  });

  it("omits the description, rather than printing it empty, when nothing describes the page", () => {
    const head = pageHead({ page, origin, path: "/about" });
    expect(head.description).toBeUndefined();
    expect(renderHeadTags(head)).not.toContain('name="description"');
  });

  it("marks noindex from the page or the site setting", () => {
    expect(pageHead({ page, origin, path: "/about" }).robots).toBeUndefined();
    expect(pageHead({ page: { ...page, noindex: true }, origin, path: "/about" }).robots).toBe(
      "noindex",
    );
    expect(
      pageHead({ page, settings: { disableIndexing: true }, origin, path: "/about" }).robots,
    ).toBe("noindex");
  });

  it("maps the home slug to the root", () => {
    const head = pageHead({
      page: { slug: "home", title: "Home" },
      origin,
      path: "/home?ref=x",
      homeSlug: "home",
    });
    expect(head.canonical).toBe("https://example.com/");
    expect(head.og.url).toBe("https://example.com/");
  });

  it("builds the card URL from the slug and the SEO title, absolute", () => {
    const head = pageHead({
      page: { ...page, seoTitle: "Meet the team" },
      settings: { defaultOgImageUrl: "/default.png" },
      origin,
      path: "/about",
      shareCardUrl: (slug, title) =>
        `/og.png?slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}`,
    });
    expect(head.og.image).toBe("https://example.com/og.png?slug=about&title=Meet%20the%20team");
    expect(head.twitterCard).toBe("summary_large_image");
  });

  it("falls back to the default image when the site renders no cards", () => {
    const head = pageHead({
      page,
      settings: { defaultOgImageUrl: "/default.png" },
      origin,
      path: "/about",
    });
    expect(head.og.image).toBe("https://example.com/default.png");
  });

  it("has no image, and a summary card, when nothing supplies one", () => {
    const head = pageHead({ page, origin, path: "/about" });
    expect(head.og.image).toBeUndefined();
    expect(head.twitterCard).toBe("summary");
  });

  it("drops an image URL that isn't http or https", () => {
    const head = pageHead({ page: { ...page, ogImage: "javascript:alert(1)" }, origin, path: "/" });
    expect(head.og.image).toBeUndefined();
  });

  it("uses the settings favicon, then the site's own", () => {
    expect(pageHead({ page, origin, path: "/", icon: "/favicon.svg" }).icon).toBe("/favicon.svg");
    expect(
      pageHead({
        page,
        settings: { faviconUrl: "/brand.png" },
        origin,
        path: "/",
        icon: "/favicon.svg",
      }).icon,
    ).toBe("/brand.png");
  });
});

describe("renderHeadTags", () => {
  it("escapes every value", () => {
    const html = renderHeadTags(
      pageHead({
        page: { slug: "q", title: 'Fish & "chips" <b>', seoDescription: 'A "quote" & <tag>' },
        origin,
        path: "/q",
      }),
    );
    expect(html).toContain("<title>Fish &amp; &quot;chips&quot; &lt;b&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="A &quot;quote&quot; &amp; &lt;tag&gt;">',
    );
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<tag>");
  });

  it("prints the canonical, Open Graph, and Twitter tags", () => {
    const html = renderHeadTags(
      pageHead({
        page: { ...page, ogImage: "https://cdn.example.com/share.png" },
        settings: { siteName: "Example Organization" },
        origin,
        path: "/about?utm_source=mail",
      }),
    );
    expect(html.split("\n")).toEqual([
      "<title>About us</title>",
      '<link rel="canonical" href="https://example.com/about">',
      '<meta property="og:title" content="About us">',
      '<meta property="og:url" content="https://example.com/about">',
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Example Organization">',
      '<meta property="og:image" content="https://cdn.example.com/share.png">',
      '<meta name="twitter:card" content="summary_large_image">',
    ]);
  });
});
