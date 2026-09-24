import { describe, expect, it, vi } from "vitest";
import { majorToCents, parseMoneyInput } from "../../src/core/commerce/index.js";
import { isNoindexHost, louiseSecurityHeaders } from "../../src/core/security/index.js";
import { type KvCacheStore, kvBust, kvCached } from "../../src/core/worker/index.js";

function memoryKv(): KvCacheStore & { store: Map<string, string>; ttl: Map<string, number> } {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    store,
    ttl,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, o) => {
      store.set(k, v);
      if (o?.expirationTtl) ttl.set(k, o.expirationTtl);
    },
    delete: async (k) => void store.delete(k),
  };
}

describe("kvCached", () => {
  it("loads once, then serves from KV", async () => {
    const kv = memoryKv();
    const load = vi.fn(async () => ({ slug: "acme", plan: "pro" }));
    expect(await kvCached(kv, "tenant:acme", load, { ttlSeconds: 300 })).toEqual({
      slug: "acme",
      plan: "pro",
    });
    expect(await kvCached(kv, "tenant:acme", load, { ttlSeconds: 300 })).toEqual({
      slug: "acme",
      plan: "pro",
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(kv.ttl.get("tenant:acme")).toBe(300);
  });

  it("caches a miss, so a garbage key costs one load per TTL", async () => {
    const kv = memoryKv();
    const load = vi.fn(async () => null);
    for (let i = 0; i < 3; i++) {
      expect(await kvCached(kv, "tenant:nope", load, { ttlSeconds: 300 })).toBeNull();
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("can leave misses uncached", async () => {
    const kv = memoryKv();
    const load = vi.fn(async () => null);
    await kvCached(kv, "k", load, { ttlSeconds: 60, cacheMisses: false });
    await kvCached(kv, "k", load, { ttlSeconds: 60, cacheMisses: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails open: a KV that throws still returns the loaded value", async () => {
    const broken: KvCacheStore = {
      get: async () => {
        throw new Error("KV down");
      },
      put: async () => {
        throw new Error("KV down");
      },
      delete: async () => {
        throw new Error("KV down");
      },
    };
    expect(await kvCached(broken, "k", async () => 42, { ttlSeconds: 60 })).toBe(42);
    await expect(kvBust(broken, "k")).resolves.toBeUndefined();
  });

  it("treats an unparseable entry (an older deploy's format) as a miss", async () => {
    const kv = memoryKv();
    kv.store.set("k", "{not json");
    expect(await kvCached(kv, "k", async () => "fresh", { ttlSeconds: 60 })).toBe("fresh");
  });

  it("is just load() without a KV", async () => {
    expect(await kvCached(undefined, "k", async () => "v", { ttlSeconds: 60 })).toBe("v");
  });

  it("kvBust makes the next read load again", async () => {
    const kv = memoryKv();
    let n = 0;
    const load = async () => ++n;
    await kvCached(kv, "k", load, { ttlSeconds: 60 });
    await kvBust(kv, "k");
    expect(await kvCached(kv, "k", load, { ttlSeconds: 60 })).toBe(2);
  });

  it("refuses a TTL below KV's 60-second minimum", async () => {
    await expect(kvCached(memoryKv(), "k", async () => 1, { ttlSeconds: 30 })).rejects.toThrow(
      RangeError,
    );
  });

  it("round-trips falsy values that aren't null", async () => {
    const kv = memoryKv();
    const load = vi.fn(async () => 0);
    await kvCached(kv, "k", load, { ttlSeconds: 60 });
    expect(await kvCached(kv, "k", load, { ttlSeconds: 60 })).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("isNoindexHost", () => {
  it("covers Workers preview and version URLs by default", () => {
    expect(isNoindexHost("abc123-site.acct.workers.dev")).toBe(true);
    expect(isNoindexHost("SITE.ACCT.WORKERS.DEV.")).toBe(true);
    expect(isNoindexHost("example.com")).toBe(false);
  });

  it("adds the site's own prefixes, and only those", () => {
    const opts = { prefixes: ["preview.", "studio."] };
    expect(isNoindexHost("preview.example.com", opts)).toBe(true);
    expect(isNoindexHost("studio.example.com", opts)).toBe(true);
    expect(isNoindexHost("www.example.com", opts)).toBe(false);
    expect(isNoindexHost("preview.example.com")).toBe(false); // no default prefixes
  });

  it("lets the suffix list be replaced", () => {
    expect(isNoindexHost("a.workers.dev", { suffixes: [".pages.dev"] })).toBe(false);
    expect(isNoindexHost("a.pages.dev", { suffixes: [".pages.dev"] })).toBe(true);
  });
});

describe("louiseSecurityHeaders — noindex", () => {
  it("sends X-Robots-Tag only when asked", () => {
    const on = louiseSecurityHeaders(new Response(""), {
      hostname: "x.workers.dev",
      noindex: true,
    });
    expect(on.headers.get("x-robots-tag")).toBe("noindex");
    const off = louiseSecurityHeaders(new Response(""), { hostname: "example.com" });
    expect(off.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("majorToCents", () => {
  it("rounds exactly where Math.round(x * 100) drifts", () => {
    // 1.005 * 100 === 100.49999999999999—the naive version gives 100.
    expect(Math.round(1.005 * 100)).toBe(100);
    expect(majorToCents(1.005)).toBe(101);
    expect(majorToCents(8.345)).toBe(835);
    expect(majorToCents(0.29)).toBe(29);
    expect(majorToCents(19.99)).toBe(1999);
  });

  it("rounds half away from zero for negatives (a refund)", () => {
    expect(majorToCents(-1.005)).toBe(-101);
    expect(majorToCents(-12.5)).toBe(-1250);
  });

  it("takes the currency's minor-unit count", () => {
    expect(majorToCents(1250, 0)).toBe(1250); // JPY
    expect(majorToCents(1.2345, 3)).toBe(1235); // BHD
  });

  it("refuses a non-finite amount", () => {
    expect(() => majorToCents(Number.NaN)).toThrow(RangeError);
    expect(() => majorToCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("parseMoneyInput", () => {
  it("parses what a person types, exactly", () => {
    expect(parseMoneyInput("12")).toBe(1200);
    expect(parseMoneyInput("12.5")).toBe(1250);
    expect(parseMoneyInput(" 12.50 ")).toBe(1250);
    expect(parseMoneyInput("0.07")).toBe(7);
    expect(parseMoneyInput("12.")).toBe(1200);
    expect(parseMoneyInput("1.005".slice(0, 4))).toBe(100);
  });

  it("refuses anything that isn't a plain non-negative amount", () => {
    for (const input of ["", "abc", "-5", "+5", "1,200", "$12", "12.345", "1e3", "12,50", "."]) {
      expect(parseMoneyInput(input), input).toBeNull();
    }
  });

  it("follows the currency's minor-unit count", () => {
    expect(parseMoneyInput("1250", 0)).toBe(1250);
    expect(parseMoneyInput("12.5", 0)).toBeNull();
    expect(parseMoneyInput("1.234", 3)).toBe(1234);
  });

  it("refuses an amount too large to be exact", () => {
    expect(parseMoneyInput("99999999999999999999")).toBeNull();
  });
});
