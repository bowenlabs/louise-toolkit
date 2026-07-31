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

/** Where a Square object is sold, as `louise-toolkit/commerce/square` reports it.
 *  Optional throughout, so an item assembled by hand or by an older client still
 *  satisfies the type and reads as "sold everywhere". */
export interface SquarePresenceLike {
  presentAtAllLocations?: boolean;
  presentAtLocationIds?: string[];
  absentAtLocationIds?: string[];
}

/** A per-location price override. A null/absent `priceCents` means the override
 *  adjusts something other than price, and the base price still applies. */
export interface SquareLocationOverrideLike {
  locationId: string;
  priceCents?: number | null;
  currency?: string | null;
  soldOut?: boolean | null;
}

/** The subset of `SquareCatalogItem` the mirror reads. */
export interface SquareItemLike extends SquarePresenceLike {
  id: string;
  name: string;
  imageUrl?: string | null;
  variations?: ({
    id: string;
    name: string;
    sku?: string | null;
    /** The BASE price. A location override wins over it where one exists. */
    priceCents: number;
    currency?: string;
    locationOverrides?: SquareLocationOverrideLike[];
  } & SquarePresenceLike)[];
}

/**
 * Is this object sold at `locationId`?
 *
 * Mirrors `presentAt` in `louise-toolkit/commerce/square`, but tolerant of the
 * fields being absent. The two lists are NOT symmetric — `presentAtLocationIds`
 * is a whitelist consulted when `presentAtAllLocations` is false,
 * `absentAtLocationIds` a blacklist consulted when it is true. Reading them the
 * other way round shows a merchant products they do not carry.
 */
function presentAtLocation(o: SquarePresenceLike, locationId: string): boolean {
  return o.presentAtAllLocations === false
    ? (o.presentAtLocationIds ?? []).includes(locationId)
    : !(o.absentAtLocationIds ?? []).includes(locationId);
}

/** The effective price of a variation at one location: the override's price if
 *  it sets one, otherwise the base price. */
function variationPriceAt(
  v: NonNullable<SquareItemLike["variations"]>[number],
  locationId: string,
): number {
  const override = (v.locationOverrides ?? []).find((o) => o.locationId === locationId);
  return override?.priceCents != null ? override.priceCents : v.priceCents;
}

/** Options for {@link squareToCatalogItem}. */
export interface SquareAdapterOptions {
  /**
   * Resolve prices and presence for one merchant location. Omit for a
   * single-location account, where base prices are the only prices.
   */
  locationId?: string;
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
 * Is this item sold at `locationId` at all?
 *
 * Exported because a location-scoped sync needs to SKIP items the merchant
 * doesn't carry, and `squareToCatalogItem` can't do that for you — it returns
 * one item, and "don't store this row" isn't a `CatalogItem`. Without the guard
 * an unstocked item mirrors as a $0 card with no variants, which looks like a
 * pricing bug rather than a catalog decision.
 *
 * ```ts
 * const rows = items
 *   .filter((i) => squareItemSoldAt(i, locationId))
 *   .map((i) => squareToCatalogItem(i, { locationId }));
 * ```
 */
export function squareItemSoldAt(item: SquareItemLike, locationId: string): boolean {
  if (!presentAtLocation(item, locationId)) return false;
  return (item.variations ?? []).some((v) => presentAtLocation(v, locationId));
}

/**
 * Square item → `CatalogItem`.
 *
 * `price` is the LOWEST variation price. A Square item is a family ("Bag of
 * beans" with 12oz and 2lb variations), so a single headline number has to mean
 * "from" — taking the first variation's price instead would change with Square's
 * ordering and quietly misprice the card.
 *
 * ## Scoping to one merchant
 *
 * Pass `locationId` and both halves resolve at that location: variations the
 * merchant doesn't carry are dropped, and the rest price through
 * `location_overrides` rather than the base price.
 *
 * The headline number has to be scoped for the same reason the variants are.
 * "From $8" computed over the whole catalog, on a page where the $8 size isn't
 * stocked, advertises a price this merchant will never honour — and because the
 * dropped variation is usually the cheap one, the error runs in the direction a
 * customer notices at the till.
 *
 * Unscoped behaviour is unchanged: no `locationId` means base prices and every
 * variation, which is correct for a single-location account.
 *
 * An item sold nowhere at `locationId` yields no variants and a price of 0 —
 * filter with {@link squareItemSoldAt} before calling rather than storing that.
 */
export function squareToCatalogItem(
  item: SquareItemLike,
  options: SquareAdapterOptions = {},
): CatalogItem {
  const locationId = options.locationId;
  const variations = (item.variations ?? []).filter(
    (v) => locationId === undefined || presentAtLocation(v, locationId),
  );
  const priceOf = (v: (typeof variations)[number]) =>
    locationId === undefined ? v.priceCents : variationPriceAt(v, locationId);

  const prices = variations.map(priceOf).filter((c) => Number.isFinite(c));
  return {
    externalId: item.id,
    name: item.name,
    price: prices.length ? toMajor(Math.min(...prices)) : 0,
    images: item.imageUrl ? [item.imageUrl] : [],
    variants: variations.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku ?? null,
      price: toMajor(priceOf(v)),
      currency:
        (locationId === undefined
          ? undefined
          : (v.locationOverrides ?? []).find((o) => o.locationId === locationId)?.currency) ??
        v.currency ??
        "USD",
      // Only meaningful when scoped: `sold_out` is a per-location flag, so an
      // unscoped read has no single answer and omits it rather than guessing.
      ...(locationId === undefined
        ? {}
        : {
            soldOut:
              (v.locationOverrides ?? []).find((o) => o.locationId === locationId)?.soldOut ??
              false,
          }),
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
