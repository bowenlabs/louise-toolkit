// The kit's own fallbacks report themselves (#556). One test per kind of
// degrade: fail-open, best-effort side effect, corrupt stored state, served
// fallback, and a "not found" that could hide an outage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProduct } from "../../src/core/commerce/fourthwall.js";
import { LouiseDbError, onDegraded, type DegradedEvent } from "../../src/core/errors.js";
import { notifySubmission } from "../../src/core/forms/notify.js";
import { readHealthSummary } from "../../src/core/health/index.js";
import { rateLimit } from "../../src/core/security/rate-limit.js";
import { readSecret } from "../../src/core/security/secrets.js";
import { kvBust, kvCached } from "../../src/core/worker/kv-cache.js";
import { withHealing } from "../../src/core/worker/healing.js";

let events: DegradedEvent[];
let off: () => void;

beforeEach(() => {
  events = [];
  off = onDegraded((event) => events.push(event));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  off();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const names = () => events.map((event) => event.name);

const brokenKv = {
  get: () => Promise.reject(new Error("KV down")),
  put: () => Promise.reject(new Error("KV down")),
  delete: () => Promise.reject(new Error("KV down")),
};

describe("the kit reports its own fallbacks", () => {
  it("a rate limiter that fails open, without the key", async () => {
    const result = await rateLimit(brokenKv, "192.0.2.1", 5, 60);
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "security.rateLimit",
      message: "Error: KV down",
      details: { backend: "kv" },
    });
    expect(JSON.stringify(events[0]!.details)).not.toContain("192.0.2.1");
  });

  it("a form notification that fails, without failing the submission", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const mailer = () => Promise.reject(new Error("mail down"));
    await notifySubmission(
      {
        name: "contact",
        fields: {},
        notify: { webhook: "https://hooks.example.com/in", email: { to: "alex@example.com" } },
      },
      {},
      mailer,
    );
    expect(names().sort()).toEqual(["forms.notify.email", "forms.notify.webhook"]);
    expect(events.every((event) => event.details?.form === "contact")).toBe(true);
  });

  it("a stored health summary that no longer parses", async () => {
    const kv = { get: async () => "{not json", put: async () => {} };
    expect(await readHealthSummary(kv)).toBeNull();
    expect(names()).toEqual(["health.summary"]);
  });

  it("a declared secret binding that can't be read", async () => {
    const binding = { get: () => Promise.reject(new Error("store not provisioned")) };
    expect(await readSecret(binding)).toBeNull();
    expect(names()).toEqual(["security.readSecret"]);
  });

  it("a KV cache that can't be read, written, or busted", async () => {
    expect(await kvCached(brokenKv, "k", async () => 1, { ttlSeconds: 60 })).toBe(1);
    await kvBust(brokenKv, "k");
    expect(names()).toEqual(["worker.kvCache.read", "worker.kvCache.write", "worker.kvCache.bust"]);
  });

  it("a healed route that serves its fallback, with the pathname only", async () => {
    const route = withHealing(
      async () => {
        throw new LouiseDbError("D1 unavailable");
      },
      { rules: { DB_ERROR: { fallback: () => new Response("stale") } } },
    );
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const res = await route(new Request("https://site.example/menu?token=secret"), {}, ctx);
    expect(await res?.text()).toBe("stale");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "worker.healing",
      message: "LouiseDbError: D1 unavailable",
      details: { code: "DB_ERROR", attempts: 1, path: "/menu" },
    });
  });

  it("a product lookup that fails for a reason other than 404", async () => {
    vi.stubGlobal("fetch", async () => new Response("unauthorized", { status: 401 }));
    expect(await getProduct("token", "tote")).toBeNull();
    expect(names()).toEqual(["commerce.fourthwall.product"]);
  });

  it("but not a product that's really missing", async () => {
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    expect(await getProduct("token", "tote")).toBeNull();
    expect(events).toEqual([]);
  });
});
