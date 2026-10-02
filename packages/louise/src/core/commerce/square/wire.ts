// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: Square's wire shapes, and the mappers that more than
// one area reads.
//
// Internal: `square.ts` doesn't re-export this file, so nothing here is public.

import type { SquarePresence } from "./catalog.js";
import type { SquareMoney } from "./money.js";
import type { SquareOrderLineItem } from "./orders.js";

/** Per-location presence, carried on the CatalogObject itself (not inside
 *  `item_data`). Square's model is "present everywhere except…" or "present
 *  nowhere except…", selected by `present_at_all_locations`. */
export interface RawPresence {
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
}

/** Normalize the three presence fields, defaulting to Square's own default
 *  (`present_at_all_locations` is true when the field is absent). Shared by
 *  the catalog items and the subscription plans. */
export function mapPresence(raw: RawPresence): SquarePresence {
  return {
    presentAtAllLocations: raw.present_at_all_locations ?? true,
    presentAtLocationIds: raw.present_at_location_ids ?? [],
    absentAtLocationIds: raw.absent_at_location_ids ?? [],
  };
}

/** A per-location price/inventory override on an ITEM_VARIATION. This is what
 *  makes one shared catalog serve many merchants at different prices. */
interface RawLocationOverride {
  location_id?: string;
  price_money?: { amount?: number; currency?: string };
  pricing_type?: string;
  track_inventory?: boolean;
  sold_out?: boolean;
}

/** One entry in a catalog object's `custom_attribute_values` map. Square fills
 *  `name` from the definition, so a reader can find a value by the name the
 *  seller gave it in the Square Dashboard. */
export interface RawCustomAttributeValue {
  name?: string;
  key?: string;
  custom_attribute_definition_id?: string;
  type?: string;
  string_value?: string;
  number_value?: string;
  boolean_value?: boolean;
  selection_uid_values?: string[];
}

/** Carried on the CatalogObject itself, keyed by each definition's key. */
export interface RawCustomAttributes {
  custom_attribute_values?: Record<string, RawCustomAttributeValue>;
}

export interface RawVariationData {
  /** The parent ITEM's id. */
  item_id?: string;
  name?: string;
  sku?: string;
  price_money?: { amount?: number; currency?: string };
  location_overrides?: RawLocationOverride[];
}

export interface RawCatalogObject extends RawPresence, RawCustomAttributes {
  id: string;
  type: string;
  version?: number;
  is_deleted?: boolean;
  /** Present on ITEM_VARIATION objects returned top-level (batch-retrieve). */
  item_variation_data?: RawVariationData;
  item_data?: {
    name?: string;
    description?: string;
    is_archived?: boolean;
    image_ids?: string[];
    variations?: ({
      id: string;
      type: string;
      version?: number;
      item_variation_data?: RawVariationData;
    } & RawPresence &
      RawCustomAttributes)[];
    // Detailed-extraction fields (see listCatalogDetailed). Optional + ignored by
    // the plain listCatalogItems, so adding them is backwards-compatible.
    reporting_category?: { id?: string };
    categories?: { id?: string }[];
    modifier_list_info?: {
      modifier_list_id?: string;
      min_selected_modifiers?: number;
      max_selected_modifiers?: number;
      enabled?: boolean;
    }[];
  };
  // Present on CATEGORY / MODIFIER_LIST search results (listCategories /
  // listModifierLists).
  category_data?: {
    name?: string;
    category_type?: string;
    is_top_level?: boolean;
    ordinal?: number;
    parent_category?: { id?: string; ordinal?: number };
  };
  modifier_list_data?: {
    name?: string;
    selection_type?: string;
    modifiers?: {
      id: string;
      is_deleted?: boolean;
      modifier_data?: {
        name?: string;
        price_money?: { amount?: number };
        ordinal?: number;
        on_by_default?: boolean;
      };
    }[];
  };
  image_data?: { url?: string };
  // Present on SUBSCRIPTION_PLAN / SUBSCRIPTION_PLAN_VARIATION search results
  // (listSubscriptionPlans). A plan can carry its variations nested; a
  // variation can also come back top-level, naming its plan.
  subscription_plan_data?: {
    name?: string;
    all_items?: boolean;
    eligible_item_ids?: string[];
    eligible_category_ids?: string[];
    subscription_plan_variations?: RawCatalogObject[];
  };
  subscription_plan_variation_data?: {
    name?: string;
    subscription_plan_id?: string;
    monthly_billing_anchor_date?: number;
    can_prorate?: boolean;
    successor_plan_variation_id?: string;
    phases?: {
      uid?: string;
      ordinal?: number;
      cadence?: string;
      periods?: number;
      /** The pre-`pricing` field; Square still sends it for a STATIC phase. */
      recurring_price_money?: { amount?: number; currency?: string };
      pricing?: {
        type?: string;
        price_money?: { amount?: number; currency?: string };
        discount_ids?: string[];
      };
    }[];
  };
}

export interface CatalogSearchResponse {
  objects?: RawCatalogObject[];
  related_objects?: RawCatalogObject[];
  cursor?: string;
}

/** Square's archive hides an ITEM from the point of sale and the online store
 *  without deleting it, so a storefront treats an archived item as gone. */
export function isArchivedItem(obj: RawCatalogObject): boolean {
  return obj.type === "ITEM" && obj.item_data?.is_archived === true;
}

/** Ids of the archived ITEMs in a related-objects list. A batch-retrieve of
 *  variations with `include_related_objects` returns each parent ITEM there. */
export function archivedItemIds(related: RawCatalogObject[] | undefined): Set<string> {
  return new Set((related ?? []).filter(isArchivedItem).map((obj) => obj.id));
}

/** Resolve IMAGE object urls from a related-objects list, keyed by image id. */
export function imageUrlMap(related: RawCatalogObject[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of related ?? []) {
    if (obj.type === "IMAGE" && obj.image_data?.url) map.set(obj.id, obj.image_data.url);
  }
  return map;
}

/**
 * Square's money in this client's shape. Square leaves a zero amount out, often
 * a tip, so pass `fallback`, the currency of the amounts around it, and a
 * missing one reads in the store's currency. USD is left only for a response
 * that carries no currency anywhere.
 */
export function money(m?: { amount?: number; currency?: string }, fallback?: string): SquareMoney {
  return { amount: m?.amount ?? 0, currency: m?.currency ?? fallback ?? "USD" };
}

/**
 * Create an Order from cart line items (catalog references, so Square computes
 * the authoritative total + taxes). POST /v2/orders.
 */
/** One line item in Square's wire shape. Shared by {@link createOrder} and
 *  {@link createPaymentLink} so the two can't drift—an ad-hoc item (no
 *  catalog object) must carry `base_price_money`, a catalog-backed one must
 *  NOT, since Square prices that from the catalog. */
export function orderLineItemBody(li: SquareOrderLineItem) {
  return "catalogObjectId" in li
    ? {
        catalog_object_id: li.catalogObjectId,
        quantity: String(li.quantity),
        // Omitted rather than `[]` when there are none: Square accepts an empty
        // array, but the key would then show up in every body assertion.
        ...(li.modifierIds?.length
          ? { modifiers: li.modifierIds.map((id) => ({ catalog_object_id: id })) }
          : {}),
      }
    : {
        name: li.name,
        quantity: String(li.quantity),
        base_price_money: { amount: li.priceCents, currency: li.currency ?? "USD" },
      };
}
