import { describe, expect, it, vi } from "vitest";
import { LouiseCacheError, LouiseDbError, LouiseError } from "../../src/core/errors.js";
import {
  describeFailure,
  type HealingContext,
  TRANSIENT_CODES,
  withHealing,
} from "../../src/core/worker/index.js";

// --- test doubles ----------------------------------------------------------

/**
 * A fake ExecutionContext that records `waitUntil` promises so a test can
 * await escalation work that would otherwise be fire-and-forget.
 */
function makeCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(Promise.resolve(p).catch(() => {}));
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, settled: () => Promise.all(pending).then(() => undefined) };
}

const req = (url = "https://site.example/api", method = "GET") => new Request(url, { method });

// A route that throws `error` the first `failTimes` calls, then returns `ok`.
function flakyRoute(failTimes: number, error: () => LouiseError) {
  let calls = 0;
  const route = vi.fn(async () => {
    calls++;
    if (calls <= failTimes) throw error();
    return new Response("ok", { status: 200 });
  });
  return { route, calls: () => calls };
}

// --- retry -----------------------------------------------------------------

describe("withHealing — retry", () => {
  it("retries a transient error and succeeds without a fallback", async () => {
    const { ctx } = makeCtx();
    const { route, calls } = flakyRoute(2, () => new LouiseDbError("d1 blip"));
    const sleep = vi.fn(async () => {});

    const healed = withHealing(route, {
      rules: { DB_ERROR: { retries: 2, backoffMs: 50 } },
      sleep,
    });

    const res = await healed(req(), {}, ctx);
    expect(res?.status).toBe(200);
    expect(calls()).toBe(3); // 1 initial + 2 retries
  });

  it("applies exponential backoff between retries", async () => {
    const { ctx } = makeCtx();
    const { route } = flakyRoute(2, () => new LouiseDbError("d1 blip"));
    // Typed `ms` param so `sleep.mock.calls` is `[number][]` below.
    const sleep = vi.fn(async (_ms: number) => {});

    const healed = withHealing(route, {
      rules: { DB_ERROR: { retries: 2, backoffMs: 50 } },
      sleep,
    });

    await healed(req(), {}, ctx);
    // attempt 1 backoff = 50 * 2**0, attempt 2 = 50 * 2**1
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100]);
  });

  it("does not sleep when backoffMs is unset (immediate retry)", async () => {
    const { ctx } = makeCtx();
    const { route } = flakyRoute(1, () => new LouiseDbError("blip"));
    const sleep = vi.fn(async () => {});

    const healed = withHealing(route, {
      rules: { DB_ERROR: { retries: 1 } },
      sleep,
    });

    await healed(req(), {}, ctx);
    expect(sleep).not.toHaveBeenCalled();
  });
});

// --- stale-fallback --------------------------------------------------------

describe("withHealing — fallback", () => {
  it("serves the fallback Response once retries are exhausted", async () => {
    const { ctx } = makeCtx();
    const { route, calls } = flakyRoute(99, () => new LouiseDbError("down"));

    const healed = withHealing(route, {
      rules: {
        DB_ERROR: {
          retries: 1,
          fallback: () => new Response("stale", { status: 200 }),
        },
      },
      sleep: async () => {},
    });

    const res = await healed(req(), {}, ctx);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("stale");
    expect(calls()).toBe(2); // 1 initial + 1 retry, then fallback
  });

  it("passes the failing request + typed error to the fallback", async () => {
    const { ctx } = makeCtx();
    const route = vi.fn(async () => {
      throw new LouiseCacheError("kv miss");
    });
    let seen: HealingContext | undefined;

    const healed = withHealing(route, {
      rules: {
        CACHE_ERROR: {
          fallback: (c) => {
            seen = c;
            return new Response("", { status: 503 });
          },
        },
      },
    });

    await healed(req("https://site.example/x", "POST"), {}, ctx);
    expect(seen?.code).toBe("CACHE_ERROR");
    expect(seen?.error).toBeInstanceOf(LouiseCacheError);
    expect(seen?.request.method).toBe("POST");
    expect(seen?.attempts).toBe(1);
  });
});

// --- escalation ------------------------------------------------------------

describe("withHealing — escalate", () => {
  it("escalates out-of-band via waitUntil and still returns the fallback", async () => {
    const { ctx, settled } = makeCtx();
    const route = vi.fn(async () => {
      throw new LouiseDbError("down");
    });
    // Typed `ctx` param so `escalate.mock.calls[0][0]` is a HealingContext.
    const escalate = vi.fn(async (_ctx: HealingContext) => {});

    const healed = withHealing(route, {
      rules: {
        DB_ERROR: {
          escalate,
          fallback: () => new Response("degraded", { status: 200 }),
        },
      },
    });

    const res = await healed(req(), {}, ctx);
    expect(res?.status).toBe(200);
    await settled();
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(escalate.mock.calls[0]?.[0].code).toBe("DB_ERROR");
  });

  it("a throwing escalate never breaks the response", async () => {
    const { ctx, settled } = makeCtx();
    const route = vi.fn(async () => {
      throw new LouiseDbError("down");
    });

    const healed = withHealing(route, {
      rules: {
        DB_ERROR: {
          escalate: () => {
            throw new Error("escalation pipeline is down");
          },
          fallback: () => new Response("degraded", { status: 200 }),
        },
      },
    });

    const res = await healed(req(), {}, ctx);
    expect(res?.status).toBe(200); // response unaffected
    await settled(); // rejected waitUntil is swallowed by the fake ctx
  });

  it("re-throws when a rule escalates but has no fallback", async () => {
    const { ctx, settled } = makeCtx();
    const route = vi.fn(async () => {
      throw new LouiseDbError("down");
    });
    const escalate = vi.fn(async () => {});

    const healed = withHealing(route, {
      rules: { DB_ERROR: { escalate } },
    });

    await expect(healed(req(), {}, ctx)).rejects.toBeInstanceOf(LouiseDbError);
    await settled();
    expect(escalate).toHaveBeenCalledTimes(1); // escalated even though it re-threw
  });
});

// --- pass-through / rethrow ------------------------------------------------

describe("withHealing — pass-through & rethrow", () => {
  it("returns a healthy Response untouched", async () => {
    const { ctx } = makeCtx();
    const route = vi.fn(async () => new Response("ok", { status: 201 }));
    const healed = withHealing(route, { rules: {} });
    const res = await healed(req(), {}, ctx);
    expect(res?.status).toBe(201);
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("passes undefined (route declined) straight through", async () => {
    const { ctx } = makeCtx();
    const route = vi.fn(async () => undefined);
    const healed = withHealing(route, {
      rules: { DB_ERROR: { fallback: () => new Response("x") } },
    });
    expect(await healed(req(), {}, ctx)).toBeUndefined();
  });

  it("re-throws a non-LouiseError without healing", async () => {
    const { ctx } = makeCtx();
    const boom = new TypeError("real bug");
    const route = vi.fn(async () => {
      throw boom;
    });
    const healed = withHealing(route, {
      rules: { DB_ERROR: { fallback: () => new Response("x") } },
    });
    await expect(healed(req(), {}, ctx)).rejects.toBe(boom);
    expect(route).toHaveBeenCalledTimes(1); // never retried
  });

  it("re-throws a LouiseError whose code has no rule", async () => {
    const { ctx } = makeCtx();
    const route = vi.fn(async () => {
      throw new LouiseCacheError("kv down");
    });
    const healed = withHealing(route, {
      rules: { DB_ERROR: { retries: 3, fallback: () => new Response("x") } },
    });
    await expect(healed(req(), {}, ctx)).rejects.toBeInstanceOf(LouiseCacheError);
    expect(route).toHaveBeenCalledTimes(1); // CACHE_ERROR isn't DB_ERROR
  });

  it("uses fallbackRule for an unlisted code", async () => {
    const { ctx } = makeCtx();
    const route = vi.fn(async () => {
      throw new LouiseCacheError("kv down");
    });
    const healed = withHealing(route, {
      rules: {},
      fallbackRule: { fallback: () => new Response("catch-all", { status: 200 }) },
    });
    const res = await healed(req(), {}, ctx);
    expect(await res?.text()).toBe("catch-all");
  });
});

// --- describeFailure / TRANSIENT_CODES -------------------------------------

describe("describeFailure", () => {
  it("builds a flat, serializable report from the healing context", () => {
    const context: HealingContext = {
      request: req("https://site.example/api/x?token=secret", "POST"),
      env: {},
      ctx: makeCtx().ctx,
      error: new LouiseDbError("connection reset"),
      code: "DB_ERROR",
      attempts: 3,
    };
    const report = describeFailure(context, 1_700_000_000_000);
    expect(report).toEqual({
      code: "DB_ERROR",
      message: "connection reset",
      method: "POST",
      // The pathname only: the query string can carry a token.
      url: "/api/x",
      attempts: 3,
      at: 1_700_000_000_000,
    });
    // Survives a queue boundary.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("TRANSIENT_CODES", () => {
  it("lists the retry-eligible infrastructure error codes", () => {
    expect(TRANSIENT_CODES).toContain("DB_ERROR");
    expect(TRANSIENT_CODES).toContain("CACHE_ERROR");
    expect(TRANSIENT_CODES).toContain("STORAGE_ERROR");
    expect(TRANSIENT_CODES).toContain("QUEUE_ERROR");
  });
});
