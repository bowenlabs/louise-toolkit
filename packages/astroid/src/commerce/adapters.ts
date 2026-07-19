// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Provider → `CatalogItem` normalizers.
//
// This is the file the whole module exists for. themidwestartist.com's loader
// says it outright: coracle runs the same helper over Square, "only the
// content/repo reads differ — issue: repo drift." Two sites, one intent, two
// hand-written translations that drifted apart. The translation is mechanical,
// so it belongs here once.
//
// Each provider's client already returns a normalized-for-that-provider shape
// (`SquareCatalogItem`, `FwProduct`); these functions take that last step to the
// shape the mirror stores. Deliberately pure — they take the provider's objects,
// not credentials or an `env`, so they're trivially testable and the caller
// keeps control of how the fetch happens (cached, paged, rate-limited).

import type { CatalogItem } from "./sync.js";

/** The subset of `SquareCatalogItem` the mirror reads. */
export interface SquareItemLike {
  id: string;
  name: string;
  imageUrl?: string | null;
  variations?: {
    id: string;
    name: string;
    sku?: string | null;
    priceCents: number;
    currency?: string;
  }[];
}

/** The subset of `FwProduct` the mirror reads. */
export interface FourthwallProductLike {
  id: string;
  name: string;
  slug?: string;
  images?: { url?: string }[];
  variants?: {
    id: string;
    name: string;
    sku?: string;
    unitPrice?: { value?: number; currency?: string } | null;
    stock?: unknown;
    attributes?: unknown;
  }[];
}

/** Minor units → major. Square prices in cents; the mirror stores dollars, since
 *  that's what a template renders and what an owner types into an overlay. */
const toMajor = (cents: number) => Math.round(cents) / 100;

/**
 * Square item → `CatalogItem`.
 *
 * `price` is the LOWEST variation price. A Square item is a family ("Bag of
 * beans" with 12oz and 2lb variations), so a single headline number has to mean
 * "from" — taking the first variation's price instead would change with Square's
 * ordering and quietly misprice the card.
 */
export function squareToCatalogItem(item: SquareItemLike): CatalogItem {
  const prices = (item.variations ?? []).map((v) => v.priceCents).filter((c) => Number.isFinite(c));
  return {
    externalId: item.id,
    name: item.name,
    price: prices.length ? toMajor(Math.min(...prices)) : 0,
    images: item.imageUrl ? [item.imageUrl] : [],
    variants: (item.variations ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku ?? null,
      price: toMajor(v.priceCents),
      currency: v.currency ?? "USD",
    })),
  };
}

/**
 * Fourthwall product → `CatalogItem`. Same "lowest variant wins" rule as Square,
 * for the same reason.
 *
 * Fourthwall already prices in major units, so there's no conversion — mirroring
 * `lowestPrice` in `louise-toolkit/commerce/fourthwall`.
 */
export function fourthwallToCatalogItem(product: FourthwallProductLike): CatalogItem {
  const prices = (product.variants ?? [])
    .map((v) => v.unitPrice?.value)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    externalId: product.id,
    name: product.name,
    price: prices.length ? Math.min(...prices) : 0,
    images: (product.images ?? [])
      .map((i) => i.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0),
    variants: (product.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku ?? null,
      price: v.unitPrice?.value ?? 0,
      currency: v.unitPrice?.currency ?? "USD",
      attributes: v.attributes ?? null,
      stock: v.stock ?? null,
    })),
    externalSlug: product.slug,
  };
}

/**
 * The normalizer for a storefront provider.
 *
 * Stripe is absent on purpose, not by omission: its client has no catalog API,
 * so it can only hold the invoicing role and never reaches a catalog sync. The
 * config validation in `assertCommerceRoles` makes that unreachable anyway; this
 * returns null rather than throwing so a caller can degrade.
 */
export function catalogNormalizer(provider: string): ((item: never) => CatalogItem) | null {
  switch (provider) {
    case "square":
      return squareToCatalogItem as (item: never) => CatalogItem;
    case "fourthwall":
      return fourthwallToCatalogItem as (item: never) => CatalogItem;
    default:
      return null;
  }
}
