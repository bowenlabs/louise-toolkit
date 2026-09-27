// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: Square's wire shapes, and the mappers that more than
// one area reads.
//
// Internal: `square.ts` doesn't re-export this file, so nothing here is public.

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

/** A per-location price/inventory override on an ITEM_VARIATION. This is what
 *  makes one shared catalog serve many merchants at different prices. */
interface RawLocationOverride {
  location_id?: string;
  price_money?: { amount?: number; currency?: string };
  pricing_type?: string;
  track_inventory?: boolean;
  sold_out?: boolean;
}

export interface RawVariationData {
  name?: string;
  sku?: string;
  price_money?: { amount?: number; currency?: string };
  location_overrides?: RawLocationOverride[];
}

export interface RawCatalogObject extends RawPresence {
  id: string;
  type: string;
  version?: number;
  is_deleted?: boolean;
  /** Present on ITEM_VARIATION objects returned top-level (batch-retrieve). */
  item_variation_data?: RawVariationData;
  item_data?: {
    name?: string;
    description?: string;
    image_ids?: string[];
    variations?: ({
      id: string;
      type: string;
      version?: number;
      item_variation_data?: RawVariationData;
    } & RawPresence)[];
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
}

export interface CatalogSearchResponse {
  objects?: RawCatalogObject[];
  related_objects?: RawCatalogObject[];
  cursor?: string;
}

/** Resolve IMAGE object urls from a related-objects list, keyed by image id. */
export function imageUrlMap(related: RawCatalogObject[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of related ?? []) {
    if (obj.type === "IMAGE" && obj.image_data?.url) map.set(obj.id, obj.image_data.url);
  }
  return map;
}

export function money(m?: { amount?: number; currency?: string }): SquareMoney {
  return { amount: m?.amount ?? 0, currency: m?.currency ?? "USD" };
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
