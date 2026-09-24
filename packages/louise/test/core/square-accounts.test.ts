import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCard,
  disableCard,
  ensureCustomer,
  listCards,
  retrieveLoyaltyProgram,
  SquareApiError,
  squareApplicationIdEnvironment,
  updateCustomer,
} from "../../src/core/commerce/square.js";

// The account-side calls coracle.coffee reached around the toolkit for with a
// hand-written fetch: cards on file, a customer's phone, and the loyalty
// program. Each test drives the real request path against a routed fake.

const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;

type Route = (url: URL, init: RequestInit) => { status?: number; body: unknown };

function route(handler: Route) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string, init: RequestInit) => {
      const url = new URL(raw);
      calls.push({
        method: String(init.method),
        path: url.pathname,
        search: url.search,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const { status = 200, body } = handler(url, init);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("SquareApiError", () => {
  it("carries the status and code, with the message it always had", async () => {
    route(() => ({ status: 404, body: { errors: [{ code: "NOT_FOUND", detail: "Not found" }] } }));
    const err = await listCards(CONFIG, { customerId: "C1" }).catch((e) => e);
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(err.message).toBe(
      "Square /v2/cards?customer_id=C1&include_disabled=false 404: Not found",
    );
  });
});

describe("updateCustomer", () => {
  it("sends only the fields given — the rest are left as they are", async () => {
    const calls = route(() => ({ body: { customer: { id: "C1", phone_number: "+19185550100" } } }));
    const c = await updateCustomer(CONFIG, "C1", { phoneNumber: "+19185550100" });
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "/v2/customers/C1",
      body: { phone_number: "+19185550100" },
    });
    expect(Object.keys(calls[0]?.body as object)).toEqual(["phone_number"]);
    expect(c.phoneNumber).toBe("+19185550100");
  });

  it("sends null to clear a field", async () => {
    const calls = route(() => ({ body: { customer: { id: "C1" } } }));
    await updateCustomer(CONFIG, "C1", { givenName: null });
    expect(calls[0]?.body).toEqual({ given_name: null });
  });
});

describe("ensureCustomer", () => {
  it("creates with the phone number when the customer is new", async () => {
    const calls = route((url) =>
      url.pathname.endsWith("/search")
        ? { body: { customers: [] } }
        : { body: { customer: { id: "C9" } } },
    );
    await ensureCustomer(CONFIG, { email: "a@x.com", phoneNumber: "+19185550100" });
    expect(calls[1]?.body).toMatchObject({ phone_number: "+19185550100" });
  });
});

describe("listCards", () => {
  it("lists a customer's enabled cards, following the cursor", async () => {
    const calls = route((url) =>
      url.searchParams.get("cursor")
        ? { body: { cards: [{ id: "K2", last_4: "4242", customer_id: "C1" }] } }
        : { body: { cards: [{ id: "K1", card_brand: "VISA", customer_id: "C1" }], cursor: "P2" } },
    );
    const cards = await listCards(CONFIG, { customerId: "C1" });
    expect(cards.map((c) => c.id)).toEqual(["K1", "K2"]);
    expect(cards[0]).toMatchObject({ cardBrand: "VISA", customerId: "C1", enabled: true });
    expect(calls[0]?.search).toContain("include_disabled=false");
    expect(calls[1]?.search).toContain("cursor=P2");
  });
});

describe("disableCard", () => {
  it("disables a card that is on file for this customer", async () => {
    const calls = route((url) =>
      url.pathname.endsWith("/disable")
        ? { body: { card: { id: "K1", enabled: false } } }
        : { body: { card: { id: "K1", customer_id: "C1" } } },
    );
    expect(await disableCard(CONFIG, "K1", { customerId: "C1" })).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v2/cards/K1",
      "POST /v2/cards/K1/disable",
    ]);
  });

  it("refuses another customer's card, and disables nothing", async () => {
    // A guessed card id from one signed-in customer must not remove another's.
    const calls = route(() => ({ body: { card: { id: "K1", customer_id: "SOMEONE_ELSE" } } }));
    expect(await disableCard(CONFIG, "K1", { customerId: "C1" })).toBe(false);
    expect(calls.some((c) => c.path.endsWith("/disable"))).toBe(false);
  });

  it("answers false for a card that doesn't exist", async () => {
    route(() => ({ status: 404, body: { errors: [{ code: "NOT_FOUND" }] } }));
    expect(await disableCard(CONFIG, "nope", { customerId: "C1" })).toBe(false);
  });

  it("still throws on a real failure", async () => {
    route(() => ({ status: 401, body: { errors: [{ code: "UNAUTHORIZED" }] } }));
    await expect(disableCard(CONFIG, "K1", { customerId: "C1" })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("createCard", () => {
  it("reports the card's customer and enabled state too", async () => {
    route(() => ({ body: { card: { id: "K1", last_4: "1111", customer_id: "C1" } } }));
    const card = await createCard(CONFIG, { sourceId: "cnon:x", customerId: "C1" });
    expect(card).toEqual({
      id: "K1",
      last4: "1111",
      cardBrand: null,
      expMonth: null,
      expYear: null,
      customerId: "C1",
      enabled: true,
    });
  });
});

describe("retrieveLoyaltyProgram", () => {
  it("maps the program as Square has it, reward tiers cheapest first", async () => {
    route(() => ({
      body: {
        program: {
          id: "LP1",
          status: "ACTIVE",
          terminology: { one: "Star", other: "Stars" },
          reward_tiers: [
            { id: "T2", name: "Free drink", points: 10 },
            { id: "T1", name: "Free shot", points: 4 },
          ],
          accrual_rules: [
            {
              accrual_type: "SPEND",
              points: 1,
              spend_data: { amount_money: { amount: 100, currency: "USD" } },
            },
            {
              accrual_type: "ITEM_VARIATION",
              points: 2,
              item_variation_data: { item_variation_id: "V1" },
            },
          ],
        },
      },
    }));
    const program = await retrieveLoyaltyProgram(CONFIG);
    expect(program).toMatchObject({
      id: "LP1",
      status: "ACTIVE",
      terminology: { one: "Star", other: "Stars" },
      rewardTiers: [
        { id: "T1", name: "Free shot", points: 4 },
        { id: "T2", name: "Free drink", points: 10 },
      ],
    });
    expect(program?.accrualRules[0]).toMatchObject({
      type: "SPEND",
      spendMoney: { amount: 100, currency: "USD" },
    });
    expect(program?.accrualRules[1]).toMatchObject({ itemVariationId: "V1" });
  });

  it("returns an inactive program too — whether to advertise it is the caller's call", async () => {
    route(() => ({ body: { program: { id: "LP1", status: "INACTIVE" } } }));
    expect(await retrieveLoyaltyProgram(CONFIG)).toMatchObject({ status: "INACTIVE" });
  });

  it("invents no terminology when Square sends none", async () => {
    route(() => ({ body: { program: { id: "LP1", status: "ACTIVE" } } }));
    expect((await retrieveLoyaltyProgram(CONFIG))?.terminology).toBeNull();
  });

  it("is null when the seller has no program (Square's 404)", async () => {
    route(() => ({ status: 404, body: { errors: [{ code: "NOT_FOUND" }] } }));
    expect(await retrieveLoyaltyProgram(CONFIG)).toBeNull();
  });

  it("throws on anything else, so a blip isn't cached as 'no program'", async () => {
    route(() => ({ status: 500, body: { errors: [{ code: "INTERNAL_SERVER_ERROR" }] } }));
    await expect(retrieveLoyaltyProgram(CONFIG)).rejects.toMatchObject({ status: 500 });
  });
});

describe("squareApplicationIdEnvironment", () => {
  it("reads the environment from the id's format", () => {
    expect(squareApplicationIdEnvironment("sandbox-sq0idb-AbC_12-x")).toBe("sandbox");
    expect(squareApplicationIdEnvironment(" sq0idp-AbC_12 ")).toBe("production");
  });

  it("is null for a placeholder, a typo, or a token in the wrong variable", () => {
    for (const id of [
      undefined,
      null,
      "",
      "REPLACE_ME",
      "sq0idb-x",
      "EAAAl-accesstoken",
      "sandbox-sq0idp-x",
    ]) {
      expect(squareApplicationIdEnvironment(id), String(id)).toBeNull();
    }
  });
});
