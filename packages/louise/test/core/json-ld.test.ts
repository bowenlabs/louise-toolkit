import { describe, expect, it } from "vitest";
import {
  breadcrumbJsonLd,
  jsonLdScript,
  localBusinessJsonLd,
  organizationJsonLd,
  pageHead,
  productJsonLd,
  renderHeadTags,
} from "../../src/core/seo/index.js";

// #584: JSON-LD from stored facts, never from a default, and safe inside a
// `<script>` element.

const origin = "https://example.com";
const settings = {
  siteName: "Example Organization",
  tagline: "Coffee, roasted daily",
  logoUrl: "/media/logo.png",
  contactEmail: "hello@example.com",
  contactPhone: "800-555-0100",
  socialLinks: [
    { label: "Profile", href: "https://social.example/example-org" },
    { label: "Bad", href: "javascript:alert(1)" },
  ],
};

describe("organizationJsonLd", () => {
  it("builds the node from the settings row, with absolute URLs", () => {
    expect(organizationJsonLd(settings, { origin })).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Example Organization",
      url: "https://example.com/",
      description: "Coffee, roasted daily",
      email: "hello@example.com",
      telephone: "800-555-0100",
      sameAs: ["https://social.example/example-org"],
      logo: "https://example.com/media/logo.png",
    });
  });

  it("leaves out a missing fact, and returns nothing without a name", () => {
    expect(organizationJsonLd({ siteName: "Example Organization" }, { origin })).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Example Organization",
      url: "https://example.com/",
    });
    expect(organizationJsonLd({ siteName: "  " }, { origin })).toBeUndefined();
  });
});

describe("localBusinessJsonLd", () => {
  it("adds the site's type, address parts, and hours", () => {
    const node = localBusinessJsonLd(
      settings,
      {
        type: "CafeOrCoffeeShop",
        address: {
          streetAddress: "1 Main St",
          addressLocality: "Anytown",
          postalCode: "00000",
          addressCountry: "US",
        },
        openingHours: [{ days: ["Monday", "Tuesday"], opens: "07:00", closes: "15:00" }],
      },
      { origin },
    );
    expect(node).toMatchObject({
      "@type": "CafeOrCoffeeShop",
      name: "Example Organization",
      image: "https://example.com/media/logo.png",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1 Main St",
        addressLocality: "Anytown",
        postalCode: "00000",
        addressCountry: "US",
      },
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday"],
          opens: "07:00",
          closes: "15:00",
        },
      ],
    });
    expect(node).not.toHaveProperty("priceRange");
    expect(node).not.toHaveProperty("geo");
  });

  it("writes no address or hours it wasn't given", () => {
    const node = localBusinessJsonLd(settings, { type: "LocalBusiness", address: {} }, { origin });
    expect(node).not.toHaveProperty("address");
    expect(node).not.toHaveProperty("openingHoursSpecification");
  });
});

describe("productJsonLd", () => {
  it("writes the price in major units at the currency's precision", () => {
    const usd = productJsonLd(
      {
        name: "House blend",
        image: "/media/blend.jpg",
        url: "/shop/house-blend",
        price: { amount: 1250, currency: "usd" },
        availability: "InStock",
      },
      { origin },
    );
    expect(usd).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "House blend",
      image: ["https://example.com/media/blend.jpg"],
      url: "https://example.com/shop/house-blend",
      offers: {
        "@type": "Offer",
        price: "12.50",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: "https://example.com/shop/house-blend",
      },
    });
    const jpy = productJsonLd(
      { name: "Tea", price: { amount: 1250, currency: "JPY" } },
      { origin },
    );
    expect(jpy.offers).toMatchObject({ price: "1250", priceCurrency: "JPY" });
  });

  it("has no offer without a price", () => {
    expect(productJsonLd({ name: "Tea" }, { origin })).not.toHaveProperty("offers");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from 1, with absolute items", () => {
    expect(
      breadcrumbJsonLd(
        [
          { name: "Home", path: "/" },
          { name: "Shop", path: "/shop" },
        ],
        { origin },
      ).itemListElement,
    ).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" },
      { "@type": "ListItem", position: 2, name: "Shop", item: "https://example.com/shop" },
    ]);
  });
});

describe("jsonLdScript", () => {
  it("keeps owner text from closing the script element", () => {
    const html = jsonLdScript({
      "@type": "Thing",
      name: "</script><script>alert(1)</script> & co",
    });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html.endsWith("</script>")).toBe(true);
    const json = html.slice(html.indexOf(">") + 1, -"</script>".length);
    expect(JSON.parse(json).name).toBe("</script><script>alert(1)</script> & co");
  });
});

describe("pageHead with JSON-LD", () => {
  it("prints each node after the other tags, and skips an undefined one", () => {
    const head = pageHead({
      page: { slug: "about", title: "About" },
      origin,
      path: "/about",
      jsonLd: [organizationJsonLd(settings, { origin }), organizationJsonLd({}, { origin })],
    });
    expect(head.jsonLd).toHaveLength(1);
    const html = renderHeadTags(head);
    expect(html.split("\n").at(-1)).toMatch(/^<script type="application\/ld\+json">/);
  });

  it("adds no key when a page has no structured data", () => {
    const head = pageHead({ page: { slug: "about", title: "About" }, origin, path: "/about" });
    expect(head).not.toHaveProperty("jsonLd");
  });
});
