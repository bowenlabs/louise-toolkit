// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/seo—JSON-LD structured data from stored facts (#584).
//
// Search engines read schema.org markup to learn outright what a page is
// about: an organization and its profiles, a shop's address and hours, a
// product's price. Each builder takes its facts from the site's settings row or
// an argument and never supplies one of its own: no default business type,
// currency, or country. A fact that's missing is left out rather than guessed,
// and a builder whose one required fact is missing returns `undefined`.
//
// Mark up only what the page visibly shows. `jsonLdScript` serializes the
// result so owner text can't close the `<script>` element it sits in.

import { centsToMajor, currencyDigits } from "../commerce/money.js";
import type { Money } from "../commerce/index.js";

/** One schema.org node, ready for {@link jsonLdScript}. */
export type JsonLd = { "@context"?: string; "@type": string } & Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** The settings fields the organization builders read. A `site_settings` row fits as it is. */
export interface JsonLdSettings {
  siteName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** `[{ label, href }]`, as the Settings panel stores it. */
  socialLinks?: unknown;
}

/** A schema.org `PostalAddress`, in parts. Store them as parts, not one text block. */
export interface JsonLdAddress {
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2, such as `"US"`. */
  addressCountry?: string;
}

/** The days schema.org names in opening hours. */
export type JsonLdDay =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

/** One run of opening hours: these days, from `opens` to `closes`, as `HH:MM`. */
export interface JsonLdOpeningHours {
  days: readonly JsonLdDay[];
  opens: string;
  closes: string;
}

/** The facts a local business needs beyond its settings row. All are the site's. */
export interface LocalBusinessFacts {
  /** The schema.org type: `"LocalBusiness"` or a subtype, such as `"CafeOrCoffeeShop"`. */
  type: string;
  address?: JsonLdAddress;
  openingHours?: readonly JsonLdOpeningHours[];
  /** Shown as a range, such as `"$$"`. */
  priceRange?: string;
  geo?: { latitude: number; longitude: number };
}

/** A product, in a shape no commerce provider owns: map yours onto it. */
export interface JsonLdProduct {
  name: string;
  description?: string | null;
  /** One URL or several; relative ones resolve against `origin`. */
  image?: string | readonly string[] | null;
  sku?: string | null;
  brand?: string | null;
  /** The product page, relative or absolute. */
  url?: string | null;
  /** The price in the currency's minor unit, as commerce stores it. */
  price?: Money | null;
  availability?: "InStock" | "OutOfStock" | "PreOrder" | "BackOrder" | "SoldOut";
}

/** One step of a breadcrumb trail: its label and path. */
export interface JsonLdCrumb {
  name: string;
  path: string;
}

/** Where relative URLs resolve. */
export interface JsonLdOptions {
  /** The site's public origin, `https://example.com`. */
  origin: string;
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function absolute(src: string | null | undefined, origin: string): string | undefined {
  const value = present(src);
  if (value === undefined) return undefined;
  try {
    const url = new URL(value, origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Drop `undefined` values and empty arrays, so a missing fact leaves no key. */
function compact<T extends Record<string, unknown>>(node: T): T {
  return Object.fromEntries(
    Object.entries(node).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  ) as T;
}

function sameAs(links: unknown, origin: string): string[] {
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => absolute((link as { href?: string } | null)?.href, origin))
    .filter((href): href is string => href !== undefined);
}

function organizationFields(settings: JsonLdSettings, origin: string) {
  return {
    name: present(settings.siteName),
    url: absolute("/", origin),
    description: present(settings.tagline),
    email: present(settings.contactEmail),
    telephone: present(settings.contactPhone),
    sameAs: sameAs(settings.socialLinks, origin),
  };
}

/**
 * An `Organization` node from the settings row: the site name, the home URL,
 * the logo, the tagline, the contact email and phone, and the social links as
 * `sameAs`. `undefined` when the settings have no site name.
 */
export function organizationJsonLd(
  settings: JsonLdSettings,
  options: JsonLdOptions,
): JsonLd | undefined {
  const fields = organizationFields(settings, options.origin);
  if (fields.name === undefined) return undefined;
  return compact({
    "@context": CONTEXT,
    "@type": "Organization",
    ...fields,
    logo: absolute(settings.logoUrl, options.origin),
  });
}

/**
 * A local business node: the organization's facts from the settings row, plus
 * the type, address, opening hours, price range, and location from `facts`.
 * `undefined` when the settings have no site name.
 */
export function localBusinessJsonLd(
  settings: JsonLdSettings,
  facts: LocalBusinessFacts,
  options: JsonLdOptions,
): JsonLd | undefined {
  const fields = organizationFields(settings, options.origin);
  if (fields.name === undefined) return undefined;
  const address = facts.address ? compact({ ...facts.address }) : undefined;
  return compact({
    "@context": CONTEXT,
    "@type": facts.type,
    ...fields,
    image: absolute(settings.logoUrl, options.origin),
    address:
      address && Object.keys(address).length > 0
        ? { "@type": "PostalAddress", ...address }
        : undefined,
    openingHoursSpecification: (facts.openingHours ?? []).map((run) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [...run.days],
      opens: run.opens,
      closes: run.closes,
    })),
    priceRange: present(facts.priceRange),
    geo: facts.geo
      ? { "@type": "GeoCoordinates", latitude: facts.geo.latitude, longitude: facts.geo.longitude }
      : undefined,
  });
}

/**
 * A `Product` node, with an `Offer` when it has a price. The price is written
 * in major units at the currency's own precision (`"12.50"` USD, `"1250"` JPY),
 * with its ISO 4217 code.
 */
export function productJsonLd(product: JsonLdProduct, options: JsonLdOptions): JsonLd {
  const images = (typeof product.image === "string" ? [product.image] : (product.image ?? []))
    .map((src) => absolute(src, options.origin))
    .filter((src): src is string => src !== undefined);
  const url = absolute(product.url, options.origin);
  const price = product.price;
  const digits = price ? currencyDigits(price.currency) : 0;
  const offer = price
    ? compact({
        "@type": "Offer",
        price: centsToMajor(price.amount, digits).toFixed(digits),
        priceCurrency: price.currency.toUpperCase(),
        availability: product.availability
          ? `https://schema.org/${product.availability}`
          : undefined,
        url,
      })
    : undefined;
  return compact({
    "@context": CONTEXT,
    "@type": "Product",
    name: product.name,
    description: present(product.description),
    image: images,
    sku: present(product.sku),
    brand: present(product.brand) ? { "@type": "Brand", name: present(product.brand) } : undefined,
    url,
    offers: offer,
  });
}

/** A `BreadcrumbList` from a trail of `{ name, path }`, first step first. */
export function breadcrumbJsonLd(trail: readonly JsonLdCrumb[], options: JsonLdOptions): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) =>
      compact({
        "@type": "ListItem",
        position: i + 1,
        name: crumb.name,
        item: absolute(crumb.path, options.origin),
      }),
    ),
  };
}

/**
 * One node as a `<script type="application/ld+json">` element. `<`, `>`, and
 * `&` are written as JSON escapes, so owner text like `</script>` stays inside
 * the string rather than closing the element.
 */
export function jsonLdScript(data: JsonLd): string {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return `<script type="application/ld+json">${json}</script>`;
}
