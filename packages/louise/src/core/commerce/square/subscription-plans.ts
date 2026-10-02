// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: subscription plans, the catalog side of a
// subscription. A plan says what can be subscribed to; each of its variations
// says how often and for how much, as a sequence of phases.

import type { SquarePresence } from "./catalog.js";
import type { SquareConfig } from "./client.js";
import { sqPost } from "./request.js";
import { type CatalogSearchResponse, mapPresence, type RawCatalogObject } from "./wire.js";

/**
 * One billing phase of a plan variation. Square bills `cadence` by `cadence`
 * for `periods` of them, then moves to the next phase; the last phase may run
 * forever. A free trial is a first phase with a 100% discount.
 */
export interface SquareSubscriptionPhase {
  uid: string | null;
  /** Position in the variation's phases, from 0. */
  ordinal: number;
  /** Square's cadence name: `WEEKLY`, `EVERY_TWO_WEEKS`, `MONTHLY`,
   *  `QUARTERLY`, `ANNUAL`, and so on. */
  cadence: string;
  /** How many cadences the phase lasts; `null` means it never ends. */
  periods: number | null;
  /** `STATIC` bills `priceCents` each cadence. `RELATIVE` bills the order
   *  template a subscription names for the phase, less `discountIds`. */
  pricingType: string;
  priceCents: number | null;
  /** The price's ISO 4217 code, or `null` when Square sent none. */
  currency: string | null;
  discountIds: string[];
}

/** How often, and for how much: what a customer subscribes to. */
export interface SquareSubscriptionPlanVariation extends SquarePresence {
  id: string;
  planId: string | null;
  name: string;
  phases: SquareSubscriptionPhase[];
  /** Day of the month billing starts on, for a monthly cadence. */
  monthlyBillingAnchorDate: number | null;
  canProrate: boolean;
  version: number;
}

/** What can be subscribed to, with the ways to subscribe to it. */
export interface SquareSubscriptionPlan extends SquarePresence {
  id: string;
  name: string;
  /** Every item is eligible; the two id lists are then empty. */
  allItems: boolean;
  eligibleItemIds: string[];
  eligibleCategoryIds: string[];
  variations: SquareSubscriptionPlanVariation[];
  version: number;
}

function mapVariation(obj: RawCatalogObject): SquareSubscriptionPlanVariation {
  const d = obj.subscription_plan_variation_data ?? {};
  return {
    id: obj.id,
    planId: d.subscription_plan_id ?? null,
    name: d.name ?? "",
    phases: (d.phases ?? []).map((p, i) => {
      const price = p.pricing?.price_money ?? p.recurring_price_money;
      return {
        uid: p.uid ?? null,
        ordinal: p.ordinal ?? i,
        cadence: p.cadence ?? "",
        periods: p.periods ?? null,
        pricingType: p.pricing?.type ?? (price ? "STATIC" : ""),
        priceCents: price?.amount ?? null,
        currency: price?.currency ?? null,
        discountIds: p.pricing?.discount_ids ?? [],
      };
    }),
    monthlyBillingAnchorDate: d.monthly_billing_anchor_date ?? null,
    canProrate: d.can_prorate ?? false,
    version: obj.version ?? 0,
    ...mapPresence(obj),
  };
}

/**
 * List every non-deleted subscription plan with its variations.
 * POST /v2/catalog/search over SUBSCRIPTION_PLAN and SUBSCRIPTION_PLAN_VARIATION.
 *
 * Square returns a variation two ways, nested under its plan and as an object
 * of its own, and either can arrive alone, so both are read and joined on the
 * plan id. A variation whose plan isn't in the catalog is dropped: there's
 * nothing to subscribe it to. Deleted plans and variations are skipped.
 */
export async function listSubscriptionPlans(
  config: SquareConfig,
): Promise<SquareSubscriptionPlan[]> {
  const plans = new Map<string, SquareSubscriptionPlan>();
  const variations = new Map<string, SquareSubscriptionPlanVariation>();
  const takeVariation = (obj: RawCatalogObject | undefined) => {
    if (!obj || obj.type !== "SUBSCRIPTION_PLAN_VARIATION" || obj.is_deleted) return;
    if (!variations.has(obj.id)) variations.set(obj.id, mapVariation(obj));
  };
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await sqPost<CatalogSearchResponse>(config, "/v2/catalog/search", {
      object_types: ["SUBSCRIPTION_PLAN", "SUBSCRIPTION_PLAN_VARIATION"],
      include_deleted_objects: false,
      ...(cursor ? { cursor } : {}),
    });
    for (const obj of res.objects ?? []) {
      if (obj.is_deleted) continue;
      if (obj.type === "SUBSCRIPTION_PLAN") {
        const d = obj.subscription_plan_data ?? {};
        plans.set(obj.id, {
          id: obj.id,
          name: d.name ?? "",
          allItems: d.all_items ?? false,
          eligibleItemIds: d.eligible_item_ids ?? [],
          eligibleCategoryIds: d.eligible_category_ids ?? [],
          variations: [],
          version: obj.version ?? 0,
          ...mapPresence(obj),
        });
        for (const v of d.subscription_plan_variations ?? []) takeVariation(v);
      } else takeVariation(obj);
    }
    cursor = res.cursor;
    if (!cursor) break;
  }
  for (const v of variations.values()) {
    const plan = v.planId ? plans.get(v.planId) : undefined;
    if (plan) plan.variations.push(v);
  }
  return [...plans.values()];
}
