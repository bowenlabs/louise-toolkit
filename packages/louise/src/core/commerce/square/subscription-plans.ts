// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: subscription plans, the catalog side of a
// subscription. A plan says what can be subscribed to; each of its variations
// says how often and for how much, as a sequence of phases. Below the read,
// pure helpers turn the plans into the offers an item's page shows, and a
// chosen variation into the order templates `createSubscription` takes.

import { presentAt, type SquarePresence } from "./catalog.js";
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
  /** Every item is eligible; the two ID lists are then empty. */
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
 * plan ID. A variation whose plan isn't in the catalog is dropped: there's
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

/**
 * One way to subscribe to an item: a plan variation the item is eligible for,
 * with the cadence its ongoing phase bills at. `subscriptionOffersFor` builds
 * them from `listSubscriptionPlans`.
 */
export interface SquareSubscriptionOffer {
  planId: string;
  planName: string;
  /** The plan variation ID, which `createSubscription` enrolls in. */
  variationId: string;
  /** The variation's name, as the seller wrote it in Square. */
  name: string;
  /** Square's cadence name: `MONTHLY` and the like. */
  cadence: string;
  /** The cadence for a customer, from `cadenceLabel`: "Every 2 weeks". */
  every: string;
  /** The ongoing phase's pricing. Always `RELATIVE` for now; see
   *  `subscriptionOffersFor`. */
  pricingType: string;
  /** `null` for a `RELATIVE` offer, which bills the item at its catalog price,
   *  less the plan's discounts, rather than at a price of its own. */
  priceCents: number | null;
}

/** The item side of a plan's eligibility: a catalog item and the categories
 *  it's in. */
export interface SquareSubscribableItem {
  /** The catalog item ID, which a plan's `eligibleItemIds` names. */
  itemId: string;
  categoryIds: readonly string[];
}

/** What Square's cadence names mean to a customer, in English. */
const CADENCE_LABELS: Readonly<Record<string, string>> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  EVERY_TWO_WEEKS: "Every 2 weeks",
  THIRTY_DAYS: "Every 30 days",
  SIXTY_DAYS: "Every 60 days",
  NINETY_DAYS: "Every 90 days",
  MONTHLY: "Every month",
  EVERY_TWO_MONTHS: "Every 2 months",
  QUARTERLY: "Every 3 months",
  EVERY_FOUR_MONTHS: "Every 4 months",
  EVERY_SIX_MONTHS: "Every 6 months",
  ANNUAL: "Every year",
  EVERY_TWO_YEARS: "Every 2 years",
};

/**
 * A site's own words for Square's cadence names. A map replaces the built-in
 * label for each cadence it names and leaves the rest English. A function is
 * asked about every cadence, including one Square adds later, so a site in
 * another language never shows English; it returns `undefined` to fall back
 * to the built-in label.
 */
export type SquareCadenceLabels =
  | Readonly<Record<string, string>>
  | ((cadence: string) => string | undefined);

/**
 * A Square cadence name as a customer reads it: "Every 2 weeks" for
 * `EVERY_TWO_WEEKS`. A cadence the table doesn't know reads as Square names
 * it, lowercased ("Every five weeks" for `EVERY_FIVE_WEEKS`), so a new one is
 * odd rather than blank. An empty cadence gives `""`.
 *
 * The built-in table and the fallback are English. `labels` replaces either:
 * a map, cadence by cadence, or a function, for every cadence (see
 * `SquareCadenceLabels`).
 */
export function cadenceLabel(cadence: string, labels?: SquareCadenceLabels): string {
  if (typeof labels === "function") {
    const own = labels(cadence);
    if (own !== undefined) return own;
  } else if (labels && Object.hasOwn(labels, cadence)) return labels[cadence] ?? "";
  if (Object.hasOwn(CADENCE_LABELS, cadence)) return CADENCE_LABELS[cadence] ?? "";
  const words = cadence
    .toLowerCase()
    .replace(/^every_/, "")
    .replace(/_/g, " ")
    .trim();
  return words ? `Every ${words}` : "";
}

/**
 * The phase a subscription settles into: the last one, since an earlier phase,
 * such as a trial, ends, and the last may run forever. `undefined` for a
 * variation with no phases.
 */
export function ongoingPhase(
  variation: Pick<SquareSubscriptionPlanVariation, "phases">,
): SquareSubscriptionPhase | undefined {
  return variation.phases.at(-1);
}

/** Whether a plan covers an item: it names the item, one of the item's
 *  categories, or every item. */
export function planCoversItem(
  plan: Pick<SquareSubscriptionPlan, "allItems" | "eligibleItemIds" | "eligibleCategoryIds">,
  item: SquareSubscribableItem,
): boolean {
  return (
    plan.allItems ||
    plan.eligibleItemIds.includes(item.itemId) ||
    plan.eligibleCategoryIds.some((id) => item.categoryIds.includes(id))
  );
}

/**
 * The ways to subscribe to an item, in the plans' order. A plan has to cover
 * the item (see `planCoversItem`). When you pass `locationId`, both the plan
 * and the variation have to be present at that location; without it, no
 * location filter applies.
 *
 * Only a variation whose ongoing phase prices `RELATIVE` is offered. Square
 * bills a `RELATIVE` phase by copying the order template the enrollment
 * builds, so each cycle can carry the item, a shipment, and a shipping charge.
 * A `STATIC` variation raises an invoice only, with no order to fulfill, and a
 * variation with no phase has nothing to bill.
 *
 * `options.labels` goes to `cadenceLabel` for each offer's `every`.
 */
export function subscriptionOffersFor(
  plans: readonly SquareSubscriptionPlan[],
  item: SquareSubscribableItem,
  locationId?: string,
  options: { labels?: SquareCadenceLabels } = {},
): SquareSubscriptionOffer[] {
  const offers: SquareSubscriptionOffer[] = [];
  for (const plan of plans) {
    if (!planCoversItem(plan, item)) continue;
    if (locationId && !presentAt(plan, locationId)) continue;
    for (const variation of plan.variations) {
      const phase = ongoingPhase(variation);
      if (!phase || phase.pricingType !== "RELATIVE") continue;
      if (locationId && !presentAt(variation, locationId)) continue;
      offers.push({
        planId: plan.id,
        planName: plan.name,
        variationId: variation.id,
        name: variation.name,
        cadence: phase.cadence,
        every: cadenceLabel(phase.cadence, options.labels),
        pricingType: phase.pricingType,
        // Relative pricing bills the item at its catalog price each cycle.
        priceCents: null,
      });
    }
  }
  return offers;
}

/**
 * The offer for one plan variation ID, or `null` when the item has no such
 * offer: the variation doesn't exist, the item isn't eligible, it isn't
 * present at `locationId`, or `subscriptionOffersFor` doesn't offer it. Check a
 * plan variation ID a client sent with this before you enroll in it.
 */
export function findSubscriptionOffer(
  plans: readonly SquareSubscriptionPlan[],
  item: SquareSubscribableItem,
  planVariationId: string,
  locationId?: string,
  options: { labels?: SquareCadenceLabels } = {},
): SquareSubscriptionOffer | null {
  return (
    subscriptionOffersFor(plans, item, locationId, options).find(
      (offer) => offer.variationId === planVariationId,
    ) ?? null
  );
}

/**
 * The `phases` that `createSubscription` takes for a variation: one entry per
 * `RELATIVE` phase, by ordinal, each naming `templateOrderId`, the `DRAFT`
 * order from `createOrder` that Square copies each cycle. A `STATIC` phase
 * bills the plan's own price and takes no template, so a variation with no
 * `RELATIVE` phase gives `[]`.
 */
export function templatePhases(
  variation: Pick<SquareSubscriptionPlanVariation, "phases">,
  templateOrderId: string,
): { ordinal: number; orderTemplateId: string }[] {
  return variation.phases
    .filter((phase) => phase.pricingType === "RELATIVE")
    .map((phase) => ({ ordinal: phase.ordinal, orderTemplateId: templateOrderId }));
}
