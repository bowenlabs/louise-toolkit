// core/commerce/square/subscription-plans—the pure helpers below
// listSubscriptionPlans: how a cadence reads, which plans cover an item, the
// offers an item gets, and the order templates an enrollment names.
import { describe, expect, it } from "vitest";
import {
  cadenceLabel,
  type createSubscription,
  findSubscriptionOffer,
  ongoingPhase,
  planCoversItem,
  type SquareSubscriptionPhase,
  type SquareSubscriptionPlan,
  type SquareSubscriptionPlanVariation,
  subscriptionOffersFor,
  templatePhases,
} from "../../src/core/commerce/square.js";

const EVERYWHERE = {
  presentAtAllLocations: true,
  presentAtLocationIds: [],
  absentAtLocationIds: [],
};

function phase(
  cadence: string,
  extra: Partial<SquareSubscriptionPhase> = {},
): SquareSubscriptionPhase {
  return {
    uid: null,
    ordinal: 0,
    cadence,
    periods: null,
    pricingType: "RELATIVE",
    priceCents: null,
    currency: null,
    discountIds: [],
    ...extra,
  };
}

function variation(
  id: string,
  name: string,
  phases: SquareSubscriptionPhase[],
  extra: Partial<SquareSubscriptionPlanVariation> = {},
): SquareSubscriptionPlanVariation {
  return {
    ...EVERYWHERE,
    id,
    planId: "PLAN",
    name,
    phases,
    monthlyBillingAnchorDate: null,
    canProrate: false,
    version: 1,
    ...extra,
  };
}

const PLAN: SquareSubscriptionPlan = {
  ...EVERYWHERE,
  id: "PLAN",
  name: "Coffee",
  allItems: false,
  eligibleItemIds: ["ITEM_BEANS"],
  eligibleCategoryIds: ["CAT_COFFEE"],
  version: 1,
  variations: [
    variation("V_2W", "Every two weeks", [phase("EVERY_TWO_WEEKS")]),
    // A discounted first phase, then the ongoing one: the offer is the ongoing phase.
    variation("V_M", "Monthly", [
      phase("MONTHLY", { discountIds: ["TRIAL"], periods: 1 }),
      phase("MONTHLY", { ordinal: 1, discountIds: ["SUBSCRIBER_10"] }),
    ]),
    // A fixed price raises an invoice with nothing to fulfill, so it isn't offered.
    variation("V_FIXED", "Fixed", [
      phase("MONTHLY", { pricingType: "STATIC", priceCents: 1800, currency: "USD" }),
    ]),
    variation("V_EMPTY", "Nothing", []),
    variation("V_ELSEWHERE", "Another location", [phase("WEEKLY")], {
      presentAtAllLocations: false,
      presentAtLocationIds: ["L2"],
    }),
  ],
};

const BEANS = { itemId: "ITEM_BEANS", categoryIds: [] };
const MUG = { itemId: "ITEM_MUG", categoryIds: ["CAT_MERCH"] };

describe("cadenceLabel", () => {
  it("reads Square's cadence names as a customer would", () => {
    expect(cadenceLabel("EVERY_TWO_WEEKS")).toBe("Every 2 weeks");
    expect(cadenceLabel("MONTHLY")).toBe("Every month");
    expect(cadenceLabel("QUARTERLY")).toBe("Every 3 months");
    expect(cadenceLabel("ANNUAL")).toBe("Every year");
  });

  it("falls back to Square's own words for a cadence it doesn't know", () => {
    expect(cadenceLabel("EVERY_FIVE_WEEKS")).toBe("Every five weeks");
    expect(cadenceLabel("FORTNIGHTLY")).toBe("Every fortnightly");
    expect(cadenceLabel("")).toBe("");
  });

  it("doesn't read a property of Object.prototype as a label", () => {
    expect(cadenceLabel("constructor")).toBe("Every constructor");
  });

  it("takes a site's own label over the table, and the table for the rest", () => {
    const labels = { MONTHLY: "Chaque mois", EVERY_FIVE_WEEKS: "Toutes les cinq semaines" };
    expect(cadenceLabel("MONTHLY", labels)).toBe("Chaque mois");
    expect(cadenceLabel("EVERY_FIVE_WEEKS", labels)).toBe("Toutes les cinq semaines");
    expect(cadenceLabel("WEEKLY", labels)).toBe("Every week");
  });

  it("asks a labels function about every cadence, and falls back on undefined", () => {
    const labels = (cadence: string) =>
      cadence === "WEEKLY" ? undefined : `Cadence ${cadence.toLowerCase()}`;
    expect(cadenceLabel("MONTHLY", labels)).toBe("Cadence monthly");
    expect(cadenceLabel("EVERY_FIVE_WEEKS", labels)).toBe("Cadence every_five_weeks");
    expect(cadenceLabel("WEEKLY", labels)).toBe("Every week");
  });
});

describe("ongoingPhase", () => {
  it("is the last phase, or undefined for a variation with none", () => {
    expect(ongoingPhase(PLAN.variations[1]!)?.ordinal).toBe(1);
    expect(ongoingPhase({ phases: [] })).toBeUndefined();
  });
});

describe("planCoversItem", () => {
  it("covers an item the plan names", () => {
    expect(planCoversItem(PLAN, BEANS)).toBe(true);
  });

  it("covers an item in one of the plan's categories", () => {
    expect(
      planCoversItem(PLAN, { itemId: "ITEM_OTHER", categoryIds: ["CAT_X", "CAT_COFFEE"] }),
    ).toBe(true);
  });

  it("covers every item when the plan says so", () => {
    expect(
      planCoversItem(
        { ...PLAN, allItems: true, eligibleItemIds: [], eligibleCategoryIds: [] },
        MUG,
      ),
    ).toBe(true);
  });

  it("covers nothing else", () => {
    expect(planCoversItem(PLAN, MUG)).toBe(false);
  });
});

describe("subscriptionOffersFor", () => {
  it("offers each RELATIVE variation at the location, from its ongoing phase", () => {
    expect(subscriptionOffersFor([PLAN], BEANS, "L1")).toEqual([
      {
        planId: "PLAN",
        planName: "Coffee",
        variationId: "V_2W",
        name: "Every two weeks",
        cadence: "EVERY_TWO_WEEKS",
        every: "Every 2 weeks",
        pricingType: "RELATIVE",
        priceCents: null,
      },
      {
        planId: "PLAN",
        planName: "Coffee",
        variationId: "V_M",
        name: "Monthly",
        cadence: "MONTHLY",
        every: "Every month",
        pricingType: "RELATIVE",
        priceCents: null,
      },
    ]);
  });

  it("skips a STATIC variation and one with no phase", () => {
    const ids = subscriptionOffersFor([PLAN], BEANS).map((o) => o.variationId);
    expect(ids).not.toContain("V_FIXED");
    expect(ids).not.toContain("V_EMPTY");
  });

  it("offers a STATIC trial followed by a RELATIVE ongoing phase", () => {
    const trial = variation("V_TRIAL", "Trial first", [
      phase("MONTHLY", { pricingType: "STATIC", priceCents: 0, currency: "USD", periods: 1 }),
      phase("MONTHLY", { ordinal: 1 }),
    ]);
    const offers = subscriptionOffersFor([{ ...PLAN, variations: [trial] }], BEANS, "L1");
    expect(offers.map((o) => o.variationId)).toEqual(["V_TRIAL"]);
  });

  it("skips a RELATIVE trial followed by a STATIC ongoing phase", () => {
    const fixedAfter = variation("V_THEN_FIXED", "Fixed after", [
      phase("MONTHLY", { periods: 1 }),
      phase("MONTHLY", { ordinal: 1, pricingType: "STATIC", priceCents: 1800, currency: "USD" }),
    ]);
    expect(subscriptionOffersFor([{ ...PLAN, variations: [fixedAfter] }], BEANS, "L1")).toEqual([]);
  });

  it("skips a variation absent at the location", () => {
    expect(subscriptionOffersFor([PLAN], BEANS, "L1").map((o) => o.variationId)).not.toContain(
      "V_ELSEWHERE",
    );
    expect(subscriptionOffersFor([PLAN], BEANS, "L2").map((o) => o.variationId)).toContain(
      "V_ELSEWHERE",
    );
  });

  it("skips every variation of a plan absent at the location", () => {
    const elsewhere = { ...PLAN, presentAtAllLocations: false, presentAtLocationIds: ["L2"] };
    expect(subscriptionOffersFor([elsewhere], BEANS, "L1")).toEqual([]);
    const excluded = { ...PLAN, absentAtLocationIds: ["L1"] };
    expect(subscriptionOffersFor([excluded], BEANS, "L1")).toEqual([]);
  });

  it("applies no location filter when no location is given", () => {
    const elsewhere = { ...PLAN, presentAtAllLocations: false, presentAtLocationIds: ["L2"] };
    expect(subscriptionOffersFor([elsewhere], BEANS).map((o) => o.variationId)).toEqual([
      "V_2W",
      "V_M",
      "V_ELSEWHERE",
    ]);
  });

  it("offers nothing for an item no plan covers", () => {
    expect(subscriptionOffersFor([PLAN], MUG, "L1")).toEqual([]);
  });

  it("keeps the plans' order", () => {
    const second = {
      ...PLAN,
      id: "PLAN_2",
      name: "Second",
      variations: [variation("V_W", "Weekly", [phase("WEEKLY")])],
    };
    expect(subscriptionOffersFor([second, PLAN], BEANS, "L1").map((o) => o.variationId)).toEqual([
      "V_W",
      "V_2W",
      "V_M",
    ]);
  });

  it("reads each cadence with the labels it's given", () => {
    const offers = subscriptionOffersFor([PLAN], BEANS, "L1", {
      labels: { MONTHLY: "Chaque mois" },
    });
    expect(offers.map((o) => o.every)).toEqual(["Every 2 weeks", "Chaque mois"]);
  });
});

describe("findSubscriptionOffer", () => {
  it("finds the offer for a plan variation id", () => {
    expect(findSubscriptionOffer([PLAN], BEANS, "V_M", "L1")).toMatchObject({
      variationId: "V_M",
      every: "Every month",
    });
  });

  it("passes the labels through", () => {
    expect(
      findSubscriptionOffer([PLAN], BEANS, "V_M", "L1", { labels: { MONTHLY: "Chaque mois" } })
        ?.every,
    ).toBe("Chaque mois");
  });

  it("is null for an id that isn't a variation", () => {
    expect(findSubscriptionOffer([PLAN], BEANS, "V_MISSING", "L1")).toBeNull();
  });

  it("is null for a variation that isn't offered", () => {
    expect(findSubscriptionOffer([PLAN], BEANS, "V_FIXED", "L1")).toBeNull();
    expect(findSubscriptionOffer([PLAN], BEANS, "V_ELSEWHERE", "L1")).toBeNull();
  });

  it("is null for an item the plan doesn't cover", () => {
    expect(findSubscriptionOffer([PLAN], MUG, "V_M", "L1")).toBeNull();
  });
});

describe("templatePhases", () => {
  it("names the template for every RELATIVE phase, by ordinal", () => {
    const mixed = {
      phases: [
        phase("MONTHLY"),
        phase("MONTHLY", { ordinal: 1, pricingType: "STATIC", priceCents: 1800 }),
        phase("MONTHLY", { ordinal: 2 }),
      ],
    };
    const phases = templatePhases(mixed, "ORD");
    expect(phases).toEqual([
      { ordinal: 0, orderTemplateId: "ORD" },
      { ordinal: 2, orderTemplateId: "ORD" },
    ]);
    // What createSubscription takes, with no conversion.
    phases satisfies NonNullable<Parameters<typeof createSubscription>[1]["phases"]>;
  });

  it("names none for a variation with no RELATIVE phase", () => {
    expect(templatePhases(PLAN.variations[2]!, "ORD")).toEqual([]);
    expect(templatePhases({ phases: [] }, "ORD")).toEqual([]);
  });
});
