import { describe, expect, it, vi } from "vitest";
import type { AstroidConfig } from "../src/config.js";
import { generateAstroidWrangler } from "../src/project/generate.js";
import { astroidQueueHandler } from "../src/queues/consumer.js";
import {
  affectsCatalog,
  type AstroidQueueMessage,
  astroidCron,
  astroidQueueNames,
  astroidUsesQueues,
} from "../src/queues/messages.js";
import { generateAstroidQueueSeam, generateAstroidWebhookRoute } from "../src/queues/scaffold.js";
import { handleWebhook } from "../src/queues/webhook.js";
import { generateAstroidWorker } from "../src/worker/generate.js";

const base: AstroidConfig = {
  key: "acme",
  archetype: "marketing",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};
const shop: AstroidConfig = {
  ...base,
  archetype: "storefront",
  commerce: { provider: "square" },
};

describe("astroidUsesQueues / astroidCron", () => {
  it("switches on with commerce, because a webhook processed inline is a webhook you drop", () => {
    expect(astroidUsesQueues(base)).toBe(false);
    expect(astroidUsesQueues(shop)).toBe(true);
  });

  it("can be forced either way", () => {
    expect(astroidUsesQueues({ ...base, queues: { enabled: true } })).toBe(true);
    expect(astroidUsesQueues({ ...shop, queues: { enabled: false } })).toBe(false);
  });

  it("defaults to an hourly cron, honours an override, and `false` disables it", () => {
    expect(astroidCron(shop)).toBe("0 * * * *");
    expect(astroidCron({ ...shop, queues: { cron: "*/15 * * * *" } })).toBe("*/15 * * * *");
    expect(astroidCron({ ...shop, queues: { cron: false } })).toBeNull();
    // No consumer → nothing to schedule.
    expect(astroidCron(base)).toBeNull();
  });

  it("names the queue and its DLQ off the project key", () => {
    expect(astroidQueueNames(shop)).toEqual({ queue: "acme-commerce", dlq: "acme-commerce-dlq" });
  });
});

describe("affectsCatalog", () => {
  it("matches a provider's catalog event prefixes", () => {
    expect(affectsCatalog("square", "catalog.version.updated")).toBe(true);
    expect(affectsCatalog("square", "inventory.count.updated")).toBe(true);
    expect(affectsCatalog("stripe", "price.updated")).toBe(true);
    expect(affectsCatalog("fourthwall", "product.created")).toBe(true);
  });

  it("ignores order/payment traffic — nothing local to update", () => {
    // These arrive in volume on a busy day; treating them as actionable turns
    // a good sales day into a refresh storm.
    expect(affectsCatalog("square", "payment.created")).toBe(false);
    expect(affectsCatalog("square", "order.updated")).toBe(false);
    expect(affectsCatalog("stripe", "charge.succeeded")).toBe(false);
  });

  it("is inert for an unknown provider rather than matching everything", () => {
    expect(affectsCatalog("mystery", "catalog.updated")).toBe(false);
  });
});

describe("astroidQueueHandler", () => {
  const msg = (over: Partial<AstroidQueueMessage> = {}): AstroidQueueMessage =>
    ({
      kind: "webhook",
      provider: "square",
      type: "catalog.version.updated",
      payload: {},
      ...over,
    }) as AstroidQueueMessage;

  it("refreshes on a periodic refresh and on catalog-affecting webhooks only", async () => {
    const refreshCatalog = vi.fn();
    const handle = astroidQueueHandler({ refreshCatalog });

    await handle({ kind: "catalog_refresh" });
    expect(refreshCatalog).toHaveBeenCalledTimes(1);

    await handle(msg());
    expect(refreshCatalog).toHaveBeenCalledTimes(2);

    await handle(msg({ type: "payment.created" } as Partial<AstroidQueueMessage>));
    expect(refreshCatalog).toHaveBeenCalledTimes(2);
  });

  it("propagates a refresh failure so the message retries", async () => {
    // A failed refresh means the site is serving stale data — retry is right.
    const handle = astroidQueueHandler({
      refreshCatalog: () => {
        throw new Error("upstream down");
      },
    });
    await expect(handle({ kind: "catalog_refresh" })).rejects.toThrow("upstream down");
  });

  it("runs onMessage for every message, after the catalog dispatch", async () => {
    const order: string[] = [];
    const handle = astroidQueueHandler({
      refreshCatalog: () => {
        order.push("refresh");
      },
      onMessage: () => {
        order.push("onMessage");
      },
    });
    await handle({ kind: "catalog_refresh" });
    expect(order).toEqual(["refresh", "onMessage"]);
  });

  it("acks harmlessly with no options at all", async () => {
    await expect(astroidQueueHandler()({ kind: "catalog_refresh" })).resolves.toBeUndefined();
  });
});

describe("handleWebhook", () => {
  const url = new URL("https://acme.coffee/api/webhooks/square");
  const req = (body: string) => new Request(url, { method: "POST", body });
  const queue = () => ({ send: vi.fn(async (_message: AstroidQueueMessage) => {}) });

  it("enqueues a verified event and answers 202", async () => {
    const q = queue();
    const res = await handleWebhook(req('{"type":"catalog.version.updated"}'), url, {
      provider: "square",
      secret: "real",
      queue: q,
      verify: () => true,
    });
    // 202, not 200: accepted for processing, which is the point of enqueuing.
    expect(res.status).toBe(202);
    expect(q.send).toHaveBeenCalledWith({
      kind: "webhook",
      provider: "square",
      type: "catalog.version.updated",
      payload: { type: "catalog.version.updated" },
    });
  });

  it("verifies the RAW body, before anything parses it", async () => {
    const raw = '{"type":"a"}';
    const verify = vi.fn(() => true);
    await handleWebhook(req(raw), url, {
      provider: "square",
      secret: "sk",
      queue: queue(),
      verify,
    });
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ raw, secret: "sk", url, headers: expect.any(Headers) }),
    );
  });

  it("rejects a bad signature terminally (401), without parsing or enqueuing", async () => {
    // A signature that fails now will fail on retry; asking the provider to keep
    // trying turns a misconfiguration into a self-inflicted flood.
    const q = queue();
    const res = await handleWebhook(req("not even json"), url, {
      provider: "square",
      secret: "real",
      queue: q,
      verify: () => false,
    });
    expect(res.status).toBe(401);
    expect(q.send).not.toHaveBeenCalled();
  });

  it("treats a throwing verifier as a failed signature, not a crash", async () => {
    const res = await handleWebhook(req("{}"), url, {
      provider: "square",
      secret: "real",
      queue: queue(),
      verify: () => {
        throw new Error("bad key length");
      },
    });
    expect(res.status).toBe(401);
  });

  it("answers 503 while the module is dormant, so events aren't lost", async () => {
    // 5xx keeps the provider retrying: deliveries during the gap land once the
    // secret is provisioned, instead of being acked into the void.
    const res = await handleWebhook(req("{}"), url, {
      provider: "square",
      secret: null,
      queue: queue(),
      verify: () => true,
    });
    expect(res.status).toBe(503);
  });

  it("answers 503 when the queue isn't provisioned", async () => {
    const res = await handleWebhook(req('{"type":"a"}'), url, {
      provider: "square",
      secret: "real",
      queue: null,
      verify: () => true,
    });
    expect(res.status).toBe(503);
  });

  it("asks for redelivery (503) when enqueuing fails", async () => {
    // The signature checked out, so the event is real and worth keeping.
    const res = await handleWebhook(req('{"type":"a"}'), url, {
      provider: "square",
      secret: "real",
      queue: {
        send: async () => {
          throw new Error("queue down");
        },
      },
      verify: () => true,
    });
    expect(res.status).toBe(503);
  });

  it("rejects an unparseable body terminally (400)", async () => {
    const res = await handleWebhook(req("<html>"), url, {
      provider: "square",
      secret: "real",
      queue: queue(),
      verify: () => true,
    });
    expect(res.status).toBe(400);
  });

  it("acks without enqueuing when `accept` filters the event out", async () => {
    const q = queue();
    const res = await handleWebhook(req('{"type":"payment.created"}'), url, {
      provider: "square",
      secret: "real",
      queue: q,
      verify: () => true,
      accept: (type) => type.startsWith("catalog."),
    });
    expect(res.status).toBe(202);
    expect(q.send).not.toHaveBeenCalled();
  });

  it("uses a custom event-type reader, and tolerates a missing type", async () => {
    const q = queue();
    await handleWebhook(req('{"event":{"name":"product.created"}}'), url, {
      provider: "fourthwall",
      secret: "real",
      queue: q,
      verify: () => true,
      eventType: (p) => (p as { event: { name: string } }).event.name,
    });
    expect(q.send.mock.calls[0][0]).toMatchObject({ type: "product.created" });

    const q2 = queue();
    await handleWebhook(req("{}"), url, {
      provider: "square",
      secret: "real",
      queue: q2,
      verify: () => true,
    });
    expect(q2.send.mock.calls[0][0]).toMatchObject({ type: "" });
  });
});

describe("generated worker", () => {
  it("stays fetch-only without queues", () => {
    const out = generateAstroidWorker(base);
    expect(out).not.toContain("queue:");
    expect(out).not.toContain("scheduled:");
    expect(out).not.toContain("processBatch");
    expect(out).not.toContain("./queue.js");
  });

  it("composes fetch + queue + scheduled when commerce is on", () => {
    const out = generateAstroidWorker(shop);
    expect(out).toContain('import { processBatch } from "louise-toolkit/queues";');
    expect(out).toContain('import { handleQueueMessage } from "./queue.js";');
    expect(out).toContain("queue: (batch, env) => processBatch(batch,");
    expect(out).toContain("scheduled:");
    // The cron ENQUEUES rather than running inline, so the refresh takes the
    // same retry + DLQ path as everything else.
    expect(out).toContain('env.COMMERCE_QUEUE.send({ kind: "catalog_refresh" })');
  });

  it("keeps the consumer but drops the cron when it's disabled", () => {
    const out = generateAstroidWorker({ ...shop, queues: { cron: false } });
    expect(out).toContain("queue: (batch, env)");
    expect(out).not.toContain("scheduled:");
  });
});

describe("generated wrangler", () => {
  it("omits queues + triggers entirely without a consumer", () => {
    const out = generateAstroidWrangler(base);
    expect(out).not.toContain('"queues"');
    expect(out).not.toContain('"triggers"');
  });

  it("emits the producer, consumer, DLQ, and cron", () => {
    const out = generateAstroidWrangler(shop);
    expect(out).toContain('"triggers": { "crons": ["0 * * * *"] }');
    expect(out).toContain('"queue": "acme-commerce", "binding": "COMMERCE_QUEUE"');
    expect(out).toContain('"dead_letter_queue": "acme-commerce-dlq"');
    expect(out).toContain('"max_retries": 5');
  });

  it("honours tuned batch + retry settings", () => {
    const out = generateAstroidWrangler({
      ...shop,
      queues: { maxRetries: 2, maxBatchSize: 25, maxBatchTimeout: 5 },
    });
    expect(out).toContain('"max_retries": 2');
    expect(out).toContain('"max_batch_size": 25');
    expect(out).toContain('"max_batch_timeout": 5');
  });
});

describe("scaffold-once files", () => {
  it("emits a consumer seam that delegates to astroidQueueHandler", () => {
    const out = generateAstroidQueueSeam(shop);
    expect(out).toContain(
      'import { astroidQueueHandler, type AstroidQueueMessage } from "astroidjs";',
    );
    expect(out).toContain("export async function handleQueueMessage(");
    expect(out).toContain("refreshCatalog:");
  });

  it("emits a provider-specific webhook route", () => {
    const square = generateAstroidWebhookRoute(shop);
    expect(square).toContain(
      'import { verifySquareSignature } from "louise-toolkit/commerce/square";',
    );
    expect(square).toContain('const HEADER = "x-square-hmacsha256-signature";');
    // Square signs notificationUrl + body, so the URL must reach the verifier.
    expect(square).toContain("verifySquareSignature(url.href, raw,");
    expect(square).toContain("readModuleSecret(env.SQUARE_WEBHOOK_SECRET)");

    const stripe = generateAstroidWebhookRoute({ ...shop, commerce: { provider: "stripe" } });
    expect(stripe).toContain("verifyStripeSignature(raw,");
    expect(stripe).toContain("Math.floor(Date.now() / 1000)");
    expect(stripe).toContain('const HEADER = "stripe-signature";');

    const fw = generateAstroidWebhookRoute({ ...shop, commerce: { provider: "fourthwall" } });
    expect(fw).toContain("verifyFourthwallSignature(raw, headers.get(HEADER), secret)");
  });

  it("emits no webhook route without a commerce provider", () => {
    expect(generateAstroidWebhookRoute(base)).toBeNull();
  });
});
