import { describe, expect, it } from "vitest";
import { parseWebhookEvent } from "../../src/core/commerce/index.js";
import {
  fourthwallOrderEventSchema,
  mapFourthwallOrder,
} from "../../src/core/commerce/fourthwall.js";
import { squareWebhookEventSchema } from "../../src/core/commerce/square.js";
import { stripeWebhookEventSchema } from "../../src/core/commerce/stripe.js";

// These schemas run AFTER the HMAC check—they prove the payload's *shape*,
// which the signature alone does not. parseWebhookEvent folds JSON.parse +
// validation so a handler branches once on `ok`.

describe("stripeWebhookEventSchema (post-verify)", () => {
  it("validates the envelope and keeps the polymorphic object", async () => {
    const body = JSON.stringify({
      id: "evt_1",
      type: "payment_intent.succeeded",
      api_version: "2026-06-24",
      data: { object: { id: "pi_123", amount: 4200 } },
    });
    const r = await parseWebhookEvent(stripeWebhookEventSchema, body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("payment_intent.succeeded");
      expect(r.value.data.object.id).toBe("pi_123");
      // Envelope-only keys are dropped.
      expect("api_version" in r.value).toBe(false);
    }
  });

  it("rejects a body missing required envelope fields", async () => {
    const r = await parseWebhookEvent(stripeWebhookEventSchema, '{"type":"x"}');
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed body as a violation, not a throw", async () => {
    const r = await parseWebhookEvent(stripeWebhookEventSchema, "not-json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.message).toBe("Invalid JSON");
  });
});

describe("squareWebhookEventSchema (post-verify)", () => {
  it("validates the envelope with the nested data.object", async () => {
    const body = JSON.stringify({
      merchant_id: "M1",
      type: "payment.updated",
      event_id: "e_1",
      data: { type: "payment", id: "p_1", object: { payment: { status: "COMPLETED" } } },
    });
    const r = await parseWebhookEvent(squareWebhookEventSchema, body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("payment.updated");
      expect(r.value.data.type).toBe("payment");
    }
  });
});

describe("fourthwallOrderEventSchema (post-verify) → mapFourthwallOrder", () => {
  it("validates the envelope and maps the order", async () => {
    const body = JSON.stringify({
      type: "order.placed",
      data: {
        id: "fw_123",
        friendlyId: "MB-1001",
        total: { value: 42, currency: "USD" },
        offers: [{ slug: "sunset", name: "Sunset print", quantity: 2, price: { value: 21 } }],
      },
    });
    const r = await parseWebhookEvent(fourthwallOrderEventSchema, body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const order = mapFourthwallOrder(r.value);
      expect(order?.fourthwallOrderId).toBe("fw_123");
      expect(order?.amount).toBe(4200);
      expect(order?.items).toEqual([
        { slug: "sunset", name: "Sunset print", qty: 2, unitPrice: 2100 },
      ]);
    }
  });

  it("rejects a JSON array body (not an event object)", async () => {
    const r = await parseWebhookEvent(fourthwallOrderEventSchema, "[]");
    expect(r.ok).toBe(false);
  });
});
