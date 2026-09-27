// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: loyalty programs and accounts.

import type { SquareConfig } from "./client.js";
import type { SquareMoney } from "./money.js";
import { orNotFound, sqGet, sqPost } from "./request.js";
import { money } from "./wire.js";

export interface SquareLoyaltyAccount {
  id: string;
  programId: string | null;
  balance: number;
  lifetimePoints: number;
  customerId: string | null;
}

interface RawLoyaltyAccount {
  id?: string;
  program_id?: string;
  balance?: number;
  lifetime_points?: number;
  customer_id?: string;
}

function mapLoyalty(a: RawLoyaltyAccount): SquareLoyaltyAccount {
  return {
    id: a.id ?? "",
    programId: a.program_id ?? null,
    balance: a.balance ?? 0,
    lifetimePoints: a.lifetime_points ?? 0,
    customerId: a.customer_id ?? null,
  };
}

/**
 * The loyalty account for a Square customer (points balance / lifetime), or
 * null if they have none. POST /v2/loyalty/accounts/search.
 */
export async function retrieveLoyaltyAccountByCustomer(
  config: SquareConfig,
  customerId: string,
): Promise<SquareLoyaltyAccount | null> {
  const res = await sqPost<{ loyalty_accounts?: RawLoyaltyAccount[] }>(
    config,
    "/v2/loyalty/accounts/search",
    { query: { customer_ids: [customerId] }, limit: 1 },
  );
  const account = res.loyalty_accounts?.[0];
  return account ? mapLoyalty(account) : null;
}

export interface SquareLoyaltyAccrualRule {
  /** `"SPEND"`, `"VISIT"`, `"ITEM_VARIATION"` or `"CATEGORY"`—as Square sends it. */
  type: string;
  points: number;
  /** SPEND: points are earned per this much spend. */
  spendMoney: SquareMoney | null;
  /** VISIT: the minimum purchase for a visit to count. */
  visitMinimumMoney: SquareMoney | null;
  /** ITEM_VARIATION: the variation that earns. */
  itemVariationId: string | null;
  /** CATEGORY: the category that earns. */
  categoryId: string | null;
}

export interface SquareLoyaltyProgram {
  id: string;
  /** `"ACTIVE"` or `"INACTIVE"`. An inactive program earns nothing. */
  status: string;
  /** What the seller calls points, as set in the Dashboard, for example, Star / Stars. */
  terminology: { one: string; other: string } | null;
  accrualRules: SquareLoyaltyAccrualRule[];
  /** Cheapest first. */
  rewardTiers: { id: string; name: string; points: number }[];
}

interface RawLoyaltyProgram {
  id?: string;
  status?: string;
  terminology?: { one?: string; other?: string };
  reward_tiers?: { id?: string; name?: string; points?: number }[];
  accrual_rules?: {
    accrual_type?: string;
    points?: number;
    spend_data?: { amount_money?: { amount?: number; currency?: string } };
    visit_data?: { minimum_amount_money?: { amount?: number; currency?: string } };
    item_variation_data?: { item_variation_id?: string };
    category_data?: { category_id?: string };
  }[];
}

function mapLoyaltyProgram(p: RawLoyaltyProgram): SquareLoyaltyProgram {
  const optMoney = (m?: { amount?: number; currency?: string }) => (m ? money(m) : null);
  return {
    id: p.id ?? "",
    status: p.status ?? "",
    terminology:
      p.terminology?.one && p.terminology.other
        ? { one: p.terminology.one, other: p.terminology.other }
        : null,
    accrualRules: (p.accrual_rules ?? []).map((r) => ({
      type: r.accrual_type ?? "",
      points: r.points ?? 0,
      spendMoney: optMoney(r.spend_data?.amount_money),
      visitMinimumMoney: optMoney(r.visit_data?.minimum_amount_money),
      itemVariationId: r.item_variation_data?.item_variation_id ?? null,
      categoryId: r.category_data?.category_id ?? null,
    })),
    rewardTiers: (p.reward_tiers ?? [])
      .map((t) => ({ id: t.id ?? "", name: t.name ?? "", points: t.points ?? 0 }))
      .sort((a, b) => a.points - b.points),
  };
}

/**
 * The seller's loyalty program—its earn rules, reward tiers and what it
 * calls points—or `null` when the seller has none (Square answers 404).
 * GET /v2/loyalty/programs/main (`main` is Square's alias for the seller's one
 * program). Any other failure throws, so a transient error isn't mistaken for
 * "no program" and cached as one.
 *
 * Returned as Square has it, inactive programs included: check `status` before
 * advertising it.
 */
export async function retrieveLoyaltyProgram(
  config: SquareConfig,
): Promise<SquareLoyaltyProgram | null> {
  const res = await orNotFound(() =>
    sqGet<{ program?: RawLoyaltyProgram }>(config, "/v2/loyalty/programs/main"),
  );
  return res?.program ? mapLoyaltyProgram(res.program) : null;
}
