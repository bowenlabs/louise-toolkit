// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: the catalog: items, variations, images, and where each
// is sold.

import type { SquareConfig } from "./client.js";
import type { SquareMoney } from "./money.js";
import { sqGet, sqPost } from "./request.js";
import {
  archivedItemIds,
  type CatalogSearchResponse,
  imageUrlMap,
  isArchivedItem,
  type RawCatalogObject,
  type RawCustomAttributes,
  type RawPresence,
  type RawVariationData,
} from "./wire.js";

/** Where a catalog object is sold. Square models this as "everywhere except" or
 *  "nowhere except"—{@link presentAt} collapses that to a single predicate so
 *  callers never re-derive the logic. */
export interface SquarePresence {
  presentAtAllLocations: boolean;
  presentAtLocationIds: string[];
  absentAtLocationIds: string[];
}

/** A per-location price override on a variation. Absent `priceCents` means the
 *  override adjusts something other than price (availability, inventory
 *  tracking) and the base price still applies. */
export interface SquareLocationOverride {
  locationId: string;
  priceCents: number | null;
  currency: string | null;
  trackInventory: boolean | null;
  soldOut: boolean | null;
}

/**
 * Is this object sold at `locationId`?
 *
 * The two lists are not symmetric: `present_at_location_ids` is a whitelist used
 * when `present_at_all_locations` is false, `absent_at_location_ids` a blacklist
 * used when it is true. Getting this backwards silently shows a merchant
 * products they don't carry, so it lives in exactly one place.
 */
export function presentAt(presence: SquarePresence, locationId: string): boolean {
  return presence.presentAtAllLocations
    ? !presence.absentAtLocationIds.includes(locationId)
    : presence.presentAtLocationIds.includes(locationId);
}

/**
 * A custom attribute value on a catalog object: a field the seller defined,
 * such as tasting notes on an item or a description on a variation. Square
 * Dashboard shows these on items and variations; modifiers and categories
 * carry them only through the API.
 */
export interface SquareCustomAttribute {
  /** The CatalogCustomAttributeDefinition's id. */
  definitionId: string;
  /** The definition's key. Another application's key is prefixed with its
   *  application id and a colon. */
  key: string;
  /** The definition's name, as the seller sees it in the Square Dashboard. */
  name: string;
  /** `STRING`, `NUMBER`, `BOOLEAN`, or `SELECTION`. */
  type: string;
  stringValue: string | null;
  /** A decimal string, as Square sends it, so no precision is lost. */
  numberValue: string | null;
  booleanValue: boolean | null;
  /** The chosen options of a `SELECTION` attribute, by uid. */
  selectionUids: string[];
}

/**
 * The text of the `STRING` custom attribute called `name`, trimmed, or `null`
 * when the object has none or it's blank. Names match without regard to case,
 * so a seller who types "Online description" in the Square Dashboard matches
 * a site that asks for "online description".
 */
export function customAttributeText(
  attributes: readonly SquareCustomAttribute[] | undefined,
  name: string,
): string | null {
  const wanted = name.trim().toLowerCase();
  const found = attributes?.find(
    (a) => a.type === "STRING" && a.name.trim().toLowerCase() === wanted,
  );
  return found?.stringValue?.trim() || null;
}

export interface SquareVariation extends SquarePresence {
  id: string;
  name: string;
  sku: string | null;
  /** The BASE price. For what a given merchant charges, use
   *  {@link priceAtLocation}; the override wins where one exists. */
  priceCents: number;
  currency: string;
  /** Per-location price overrides, empty when the base price applies everywhere. */
  locationOverrides: SquareLocationOverride[];
  /** Seller-defined fields, empty when there are none. Optional so an object
   *  built by hand, or read from a cache written before this field, still
   *  type-checks; {@link mapCatalogItem} always sets it. */
  customAttributes?: SquareCustomAttribute[];
  /** Object version—pass back to {@link upsertCatalogItem} when updating. */
  version: number;
}

/**
 * The effective price of a variation at one location: the location's override
 * if it sets a price, otherwise the base price. This is the single definition of
 * "what does this cost here", and server-side re-pricing at checkout must use it
 * rather than trusting a client-submitted amount.
 */
export function priceAtLocation(variation: SquareVariation, locationId: string): SquareMoney {
  const override = variation.locationOverrides.find((o) => o.locationId === locationId);
  if (override?.priceCents != null) {
    return { amount: override.priceCents, currency: override.currency ?? variation.currency };
  }
  return { amount: variation.priceCents, currency: variation.currency };
}

/** One of an item's catalog images. */
export interface SquareItemImage {
  /** The catalog IMAGE object's id. */
  id: string;
  /** Square's CDN URL, or `null` when the response didn't carry the IMAGE
   *  object, as on a batch upsert or when the image was deleted. */
  url: string | null;
}

export interface SquareCatalogItem extends SquarePresence {
  id: string;
  name: string;
  description: string;
  /** The primary image's URL: the first entry in {@link images}. */
  imageUrl: string | null;
  /** Every image on the item, in Square's order, primary first. Lets a site
   *  show an image other than the primary, which is also the register's tile. */
  images: SquareItemImage[];
  variations: SquareVariation[];
  /** Seller-defined fields, empty when there are none. Optional for the same
   *  reason as {@link SquareVariation.customAttributes}. */
  customAttributes?: SquareCustomAttribute[];
  /** Object version—pass back to {@link upsertCatalogItem} when updating. */
  version: number;
}

/** Normalize the three presence fields, defaulting to Square's own default
 *  (`present_at_all_locations` is true when the field is absent). */
function mapPresence(raw: RawPresence): SquarePresence {
  return {
    presentAtAllLocations: raw.present_at_all_locations ?? true,
    presentAtLocationIds: raw.present_at_location_ids ?? [],
    absentAtLocationIds: raw.absent_at_location_ids ?? [],
  };
}

function mapCustomAttributes(raw: RawCustomAttributes): SquareCustomAttribute[] {
  return Object.entries(raw.custom_attribute_values ?? {}).map(([key, v]) => ({
    definitionId: v.custom_attribute_definition_id ?? "",
    key: v.key ?? key,
    name: v.name ?? "",
    type: v.type ?? "",
    stringValue: v.string_value ?? null,
    numberValue: v.number_value ?? null,
    booleanValue: v.boolean_value ?? null,
    selectionUids: v.selection_uid_values ?? [],
  }));
}

function mapLocationOverrides(data: RawVariationData | undefined): SquareLocationOverride[] {
  return (data?.location_overrides ?? [])
    .filter((o) => o.location_id)
    .map((o) => ({
      locationId: o.location_id as string,
      priceCents: o.price_money?.amount ?? null,
      currency: o.price_money?.currency ?? null,
      trackInventory: o.track_inventory ?? null,
      soldOut: o.sold_out ?? null,
    }));
}

/** Map a raw ITEM object (+ resolved images) to the normalized shape. */
export function mapCatalogItem(
  obj: RawCatalogObject,
  images: Map<string, string>,
): SquareCatalogItem {
  const data = obj.item_data ?? {};
  const itemImages = (data.image_ids ?? []).map((id) => ({ id, url: images.get(id) ?? null }));
  const variations: SquareVariation[] = (data.variations ?? [])
    .filter((v) => v.type === "ITEM_VARIATION")
    .map((v) => ({
      id: v.id,
      name: v.item_variation_data?.name ?? "",
      sku: v.item_variation_data?.sku ?? null,
      priceCents: v.item_variation_data?.price_money?.amount ?? 0,
      currency: v.item_variation_data?.price_money?.currency ?? "USD",
      locationOverrides: mapLocationOverrides(v.item_variation_data),
      customAttributes: mapCustomAttributes(v),
      version: v.version ?? 0,
      ...mapPresence(v),
    }));
  return {
    id: obj.id,
    name: data.name ?? "",
    description: data.description ?? "",
    imageUrl: itemImages[0]?.url ?? null,
    images: itemImages,
    variations,
    customAttributes: mapCustomAttributes(obj),
    version: obj.version ?? 0,
    ...mapPresence(obj),
  };
}

/**
 * List every catalog ITEM that isn't deleted or archived, with its variations
 * and primary image.
 * Walks the search cursor (coffee catalogs are small; a safety cap bounds it).
 * POST /v2/catalog/search.
 */
export async function listCatalogItems(config: SquareConfig): Promise<SquareCatalogItem[]> {
  const items: SquareCatalogItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await sqPost<CatalogSearchResponse>(config, "/v2/catalog/search", {
      object_types: ["ITEM"],
      include_related_objects: true,
      include_deleted_objects: false,
      ...(cursor ? { cursor } : {}),
    });
    const images = imageUrlMap(res.related_objects);
    for (const obj of res.objects ?? []) {
      if (obj.type === "ITEM" && !obj.is_deleted && !isArchivedItem(obj)) {
        items.push(mapCatalogItem(obj, images));
      }
    }
    cursor = res.cursor;
    if (!cursor) break;
  }
  return items;
}

/** Retrieve a single catalog object (+ related images). GET /v2/catalog/object/{id}. */
export async function retrieveCatalogItem(
  config: SquareConfig,
  objectId: string,
): Promise<SquareCatalogItem | null> {
  const res = await sqGet<{ object?: RawCatalogObject; related_objects?: RawCatalogObject[] }>(
    config,
    `/v2/catalog/object/${encodeURIComponent(objectId)}?include_related_objects=true`,
  );
  if (!res.object || res.object.type !== "ITEM") return null;
  return mapCatalogItem(res.object, imageUrlMap(res.related_objects));
}

/** Batch-retrieve variations with their parent ITEMs, which is how the price
 *  lookups tell a variation of an archived item apart from a live one. */
async function retrieveVariations(
  config: SquareConfig,
  variationIds: string[],
): Promise<RawCatalogObject[]> {
  const res = await sqPost<{ objects?: RawCatalogObject[]; related_objects?: RawCatalogObject[] }>(
    config,
    "/v2/catalog/batch-retrieve",
    { object_ids: variationIds, include_related_objects: true },
  );
  const archived = archivedItemIds(res.related_objects);
  return (res.objects ?? []).filter((obj) => !archived.has(obj.item_variation_data?.item_id ?? ""));
}

/**
 * Batch-retrieve catalog objects by id—used at checkout to verify cart prices
 * against the live catalog before charging. POST /v2/catalog/batch-retrieve.
 * Returns a map of variationId → priceCents for the ITEM_VARIATION objects.
 *
 * A variation of an archived item is omitted, like an unknown id, so a caller
 * that requires every id to resolve won't sell something the shop took down.
 */
export async function retrieveVariationPrices(
  config: SquareConfig,
  variationIds: string[],
): Promise<Map<string, SquareMoney>> {
  const prices = new Map<string, SquareMoney>();
  for (const obj of await retrieveVariations(config, variationIds)) {
    if (obj.type === "ITEM_VARIATION") {
      // batch-retrieve returns variations as top-level objects with
      // item_variation_data on the object itself.
      const price = obj.item_variation_data?.price_money;
      prices.set(obj.id, { amount: price?.amount ?? 0, currency: price?.currency ?? "USD" });
    }
  }
  return prices;
}

/** Square's ceiling on `object_ids` in one `/v2/catalog/batch-retrieve` call. */
const BATCH_RETRIEVE_LIMIT = 1000;

/**
 * Which of `ids` still exist in the catalog—present and not deleted,
 * optionally only of one object `type` (for example, `"MODIFIER"`, so a variation id
 * can't pass for an add-on). A deleted or unknown id is simply absent. POST
 * /v2/catalog/batch-retrieve, chunked at Square's 1000-id limit; no request at
 * all for an empty list.
 *
 * The add-on half of cart verification: pass the result as `liveModifierIds`
 * to `cartIssues` (louise-toolkit/commerce). A deleted modifier reaching
 * `createOrder` makes Square reject the whole order, with nothing to tell the
 * customer which add-on it was.
 */
export async function retrieveLiveCatalogObjectIds(
  config: SquareConfig,
  ids: readonly string[],
  options: { type?: string } = {},
): Promise<Set<string>> {
  const live = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += BATCH_RETRIEVE_LIMIT) {
    const res = await sqPost<{ objects?: RawCatalogObject[] }>(
      config,
      "/v2/catalog/batch-retrieve",
      { object_ids: unique.slice(i, i + BATCH_RETRIEVE_LIMIT) },
    );
    for (const obj of res.objects ?? []) {
      if (obj.is_deleted) continue;
      if (options.type && obj.type !== options.type) continue;
      live.add(obj.id);
    }
  }
  return live;
}

/**
 * Like {@link retrieveVariationPrices}, but resolves each price **at a specific
 * location**—the location's `location_overrides` price where one exists, else
 * the base price.
 *
 * This is the multi-merchant checkout guard. One shared catalog is sold at
 * different prices per merchant to absorb each shop's commission, so verifying a
 * cart against base prices would let a customer pay the cheapest merchant's
 * price at the dearest merchant's storefront. Re-price against the location the
 * order is actually being placed at, never against the client's numbers.
 *
 * A variation absent at `locationId`, or of an archived item, is omitted from
 * the result entirely, so a caller that requires every id to resolve will fail
 * closed rather than silently selling something the merchant does not carry.
 */
export async function retrieveVariationPricesAt(
  config: SquareConfig,
  variationIds: string[],
  locationId: string,
): Promise<Map<string, SquareMoney>> {
  const prices = new Map<string, SquareMoney>();
  for (const obj of await retrieveVariations(config, variationIds)) {
    if (obj.type !== "ITEM_VARIATION") continue;
    if (!presentAt(mapPresence(obj), locationId)) continue;

    const data = obj.item_variation_data;
    const override = mapLocationOverrides(data).find((o) => o.locationId === locationId);
    if (override?.priceCents != null) {
      prices.set(obj.id, {
        amount: override.priceCents,
        currency: override.currency ?? data?.price_money?.currency ?? "USD",
      });
      continue;
    }
    prices.set(obj.id, {
      amount: data?.price_money?.amount ?? 0,
      currency: data?.price_money?.currency ?? "USD",
    });
  }
  return prices;
}
