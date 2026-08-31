import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  type DurableRateLimitResult,
  durableRateLimitStorage,
  type RateLimitNamespace,
} from "../../src/core/security/index.js";

/** Minimal DurableObjectState: a Map plus the one alarm a DO can hold. */
const fakeCtx = () => {
  const store = new Map<string, unknown>();
  const alarm = { at: null as number | null };
  return {
    store,
    alarm,
    ctx: {
      storage: {
        get: async (key: string) => store.get(key),
        put: async (key: string, value: unknown) => {
          store.set(key, value);
        },
        delete: async (key: string) => {
          store.delete(key);
        },
        setAlarm: async (at: number) => {
          alarm.at = at;
        },
      },
    } as unknown as DurableObjectState,
  };
};

/** Drive the limiter the way the site's subclass would. */
const consume = async (
  limiter: { fetch(r: Request): Promise<Response> },
  rule: { window: number; max: number },
) => {
  const res = await limiter.fetch(
    new Request("https://rate-limit.louise/consume", {
      method: "POST",
      body: JSON.stringify(rule),
    }),
  );
  return { status: res.status, body: (await res.json()) as DurableRateLimitResult };
};

describe("createRateLimiter (the atomic counter)", () => {
  it("allows up to the budget, then blocks with a retryAfter", async () => {
    let now = 1_000_000;
    const { ctx } = fakeCtx();
    const rl = createRateLimiter(ctx, () => now);
    const rule = { window: 60, max: 3 };

    for (const _ of [1, 2, 3]) {
      expect((await consume(rl, rule)).body.allowed).toBe(true);
    }
    const blocked = await consume(rl, rule);
    expect(blocked.body.allowed).toBe(false);
    expect(blocked.body.retryAfter).toBe(60);
  });

  it("does NOT extend the window while blocking", async () => {
    // The failure this guards: if a rejected request pushed `resetAt` forward, a
    // client under sustained load would never be let back in.
    let now = 1_000_000;
    const { ctx } = fakeCtx();
    const rl = createRateLimiter(ctx, () => now);
    const rule = { window: 60, max: 1 };

    expect((await consume(rl, rule)).body.allowed).toBe(true);
    now += 30_000;
    expect((await consume(rl, rule)).body.retryAfter).toBe(30); // half the window gone
    now += 20_000;
    expect((await consume(rl, rule)).body.retryAfter).toBe(10); // still counting down
    now += 10_001;
    expect((await consume(rl, rule)).body.allowed).toBe(true); // window genuinely ended
  });

  it("starts a fresh window at 1 once the old one has passed", async () => {
    let now = 1_000_000;
    const { ctx, store } = fakeCtx();
    const rl = createRateLimiter(ctx, () => now);
    const rule = { window: 10, max: 2 };

    await consume(rl, rule);
    await consume(rl, rule);
    expect((await consume(rl, rule)).body.allowed).toBe(false);

    now += 10_001;
    expect((await consume(rl, rule)).body.allowed).toBe(true);
    expect((store.get("counter") as { count: number }).count).toBe(1);
  });

  it("schedules a reap so an idle key stops occupying storage", async () => {
    let now = 1_000_000;
    const { ctx, alarm, store } = fakeCtx();
    const rl = createRateLimiter(ctx, () => now);

    await consume(rl, { window: 60, max: 5 });
    expect(alarm.at).toBe(now + 60_000 + 1000);

    now += 61_001;
    await rl.alarm();
    expect(store.has("counter")).toBe(false);
  });

  it("re-arms rather than reaping when a newer window is open", async () => {
    // An alarm can fire late, by which time a fresh window may have started.
    // Deleting then would hand the client a free budget.
    let now = 1_000_000;
    const { ctx, alarm, store } = fakeCtx();
    const rl = createRateLimiter(ctx, () => now);

    await consume(rl, { window: 60, max: 5 });
    now += 61_001;
    await consume(rl, { window: 600, max: 5 }); // opens a long new window
    await rl.alarm();

    expect(store.has("counter")).toBe(true);
    expect(alarm.at).toBeGreaterThan(now);
  });

  it("rejects a malformed rule instead of inventing a budget", async () => {
    const { ctx } = fakeCtx();
    const rl = createRateLimiter(ctx);
    for (const body of ['{"window":0,"max":5}', '{"window":60}', "not json"]) {
      const res = await rl.fetch(
        new Request("https://rate-limit.louise/consume", { method: "POST", body }),
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("durableRateLimitStorage (the caller side)", () => {
  const nsWith = (
    fetchImpl: (r: Request) => Promise<Response>,
  ): { ns: RateLimitNamespace; names: string[] } => {
    const names: string[] = [];
    return {
      names,
      ns: {
        idFromName: (name: string) => {
          names.push(name);
          return name;
        },
        get: () => ({ fetch: fetchImpl }),
      },
    };
  };

  it("routes each key to its own object", async () => {
    const { ns, names } = nsWith(async () => Response.json({ allowed: true, retryAfter: null }));
    const storage = durableRateLimitStorage(ns);
    await storage.consume("ip:1.2.3.4", { window: 60, max: 5 });
    await storage.consume("ip:5.6.7.8", { window: 60, max: 5 });
    expect(names).toEqual(["ip:1.2.3.4", "ip:5.6.7.8"]);
  });

  it("passes a definite block through", async () => {
    const { ns } = nsWith(async () => Response.json({ allowed: false, retryAfter: 42 }));
    expect(await durableRateLimitStorage(ns).consume("k", { window: 60, max: 1 })).toEqual({
      allowed: false,
      retryAfter: 42,
    });
  });

  it("fails OPEN when the object is unreachable", async () => {
    // Deliberate: an unreachable limiter must not lock every editor out of their
    // own site. Matches `security/rate-limit`.
    const { ns } = nsWith(async () => {
      throw new Error("no route to object");
    });
    expect(await durableRateLimitStorage(ns).consume("k", { window: 60, max: 1 })).toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it("fails open on an error status or an unreadable body", async () => {
    for (const impl of [
      async () => new Response("boom", { status: 500 }),
      async () => new Response("not json", { status: 200 }),
    ]) {
      const { ns } = nsWith(impl);
      expect((await durableRateLimitStorage(ns).consume("k", { window: 60, max: 1 })).allowed).toBe(
        true,
      );
    }
  });

  it("falls back to the rule's window when a block carries no usable retryAfter", async () => {
    const { ns } = nsWith(async () => Response.json({ allowed: false }));
    expect(await durableRateLimitStorage(ns).consume("k", { window: 90, max: 1 })).toEqual({
      allowed: false,
      retryAfter: 90,
    });
  });
});
