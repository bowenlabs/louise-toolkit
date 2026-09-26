import { describe, expect, it } from "vitest";
import type { BrokenLink } from "../../src/core/browser/index.js";
import {
  type HealthKV,
  type HealthSummary,
  HEALTH_KV_KEY,
  HEALTH_STALE_AFTER_MS,
  MAX_BROKEN_LINK_DETAILS,
  healthIssueCount,
  isStale,
  readHealthSummary,
  summarizeHealth,
  writeHealthSummary,
} from "../../src/core/health/index.js";

const link = (url: string): BrokenLink => ({ url, from: "/", status: 404 });

function fakeKV() {
  const store = new Map<string, string>();
  const puts: { key: string; value: string; options?: { expirationTtl?: number } }[] = [];
  const kv: HealthKV = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, o) => {
      store.set(k, v);
      puts.push({ key: k, value: v, options: o });
    },
  };
  return { kv, store, puts };
}

describe("summarizeHealth", () => {
  it("derives counts, timestamps from `now`, and samples broken-link details", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const s = summarizeHealth({
      brokenLinks: [link("/a"), link("/b")],
      missingAlt: 3,
      seoGaps: 1,
      now,
    });
    expect(s).toMatchObject({ brokenLinks: 2, missingAlt: 3, seoGaps: 1 });
    expect(s.checkedAt).toBe("2026-07-17T12:00:00.000Z");
    expect(s.brokenLinkDetails).toHaveLength(2);
  });

  it("caps stored broken-link details but keeps the exact count", () => {
    const many = Array.from({ length: MAX_BROKEN_LINK_DETAILS + 20 }, (_, i) => link(`/x${i}`));
    const s = summarizeHealth({ brokenLinks: many, missingAlt: 0, seoGaps: 0 });
    expect(s.brokenLinks).toBe(MAX_BROKEN_LINK_DETAILS + 20); // exact count
    expect(s.brokenLinkDetails).toHaveLength(MAX_BROKEN_LINK_DETAILS); // capped sample
  });

  it("guards bad counts to a non-negative integer", () => {
    const s = summarizeHealth({ brokenLinks: [], missingAlt: -5, seoGaps: 2.9 });
    expect(s.missingAlt).toBe(0);
    expect(s.seoGaps).toBe(2);
  });

  it("healthIssueCount sums every category", () => {
    const s = summarizeHealth({ brokenLinks: [link("/a")], missingAlt: 2, seoGaps: 3 });
    expect(healthIssueCount(s)).toBe(6);
  });

  it("carries pending migrations only when there are some, and counts each", () => {
    const clean = summarizeHealth({
      brokenLinks: [],
      missingAlt: 0,
      seoGaps: 0,
      pendingMigrations: [],
    });
    expect(clean).not.toHaveProperty("pendingMigrations");
    const behind = summarizeHealth({
      brokenLinks: [],
      missingAlt: 1,
      seoGaps: 0,
      pendingMigrations: ["0004_a.sql", "0005_b.sql"],
    });
    expect(behind.pendingMigrations).toEqual(["0004_a.sql", "0005_b.sql"]);
    expect(healthIssueCount(behind)).toBe(3);
  });
});

describe("read/writeHealthSummary", () => {
  const summary: HealthSummary = {
    brokenLinks: 1,
    missingAlt: 0,
    seoGaps: 0,
    checkedAt: "2026-07-17T12:00:00.000Z",
    brokenLinkDetails: [link("/a")],
  };

  it("round-trips through KV on the default key", async () => {
    const { kv, store } = fakeKV();
    await writeHealthSummary(kv, summary);
    expect(store.has(HEALTH_KV_KEY)).toBe(true);
    expect(await readHealthSummary(kv)).toEqual(summary);
  });

  it("returns null when nothing is stored", async () => {
    const { kv } = fakeKV();
    expect(await readHealthSummary(kv)).toBeNull();
  });

  it("returns null (never throws) on a corrupt blob", async () => {
    const { kv, store } = fakeKV();
    store.set(HEALTH_KV_KEY, "{not json");
    expect(await readHealthSummary(kv)).toBeNull();
  });

  it("passes a TTL through and honours a custom key", async () => {
    const { kv, puts, store } = fakeKV();
    await writeHealthSummary(kv, summary, { key: "custom:health", ttlSeconds: 3600 });
    expect(store.has("custom:health")).toBe(true);
    expect(puts[0]?.options).toEqual({ expirationTtl: 3600 });
    expect(await readHealthSummary(kv, "custom:health")).toEqual(summary);
  });
});

describe("isStale", () => {
  const HOUR = 60 * 60 * 1000;
  const now = new Date("2026-09-26T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("defaults the threshold to 36 hours", () => {
    expect(HEALTH_STALE_AFTER_MS).toBe(36 * HOUR);
  });

  it("is fresh inside the threshold and stale past it", () => {
    expect(isStale(ago(HOUR), HEALTH_STALE_AFTER_MS, now)).toBe(false);
    expect(isStale(ago(35 * HOUR), HEALTH_STALE_AFTER_MS, now)).toBe(false);
    expect(isStale(ago(37 * HOUR), HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale(ago(7 * 24 * HOUR), HEALTH_STALE_AFTER_MS, now)).toBe(true);
  });

  it("counts an age of exactly the threshold as fresh", () => {
    expect(isStale(ago(36 * HOUR), HEALTH_STALE_AFTER_MS, now)).toBe(false);
    expect(isStale(ago(36 * HOUR + 1), HEALTH_STALE_AFTER_MS, now)).toBe(true);
  });

  it("accepts an ISO string, epoch milliseconds, or a Date, and a numeric `now`", () => {
    const then = now.getTime() - 2 * HOUR;
    expect(isStale(new Date(then).toISOString(), HOUR, now)).toBe(true);
    expect(isStale(then, HOUR, now)).toBe(true);
    expect(isStale(new Date(then), HOUR, now)).toBe(true);
    expect(isStale(then, 3 * HOUR, now.getTime())).toBe(false);
  });

  it("treats a missing or unparseable timestamp as stale", () => {
    expect(isStale(undefined, HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale(null, HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale("", HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale("not a date", HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale(Number.NaN, HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale(new Date("nope"), HEALTH_STALE_AFTER_MS, now)).toBe(true);
  });

  it("treats a timestamp in the future as fresh (clock skew)", () => {
    expect(isStale(ago(-HOUR), HEALTH_STALE_AFTER_MS, now)).toBe(false);
  });

  it("never flags anything with an Infinity threshold", () => {
    expect(isStale(ago(365 * 24 * HOUR), Number.POSITIVE_INFINITY, now)).toBe(false);
  });

  it("never flags anything with a NaN threshold, and flags everything with a negative one", () => {
    expect(isStale(ago(365 * 24 * HOUR), Number.NaN, now)).toBe(false);
    expect(isStale(ago(0), -1, now)).toBe(true);
    // Age 0, not negative, so skew can't outrun a negative threshold.
    expect(isStale(ago(-HOUR), -1, now)).toBe(true);
  });

  it("counts a number outside the Date range as unreadable", () => {
    // `new Date(1e16)` is an invalid date, not a time in the far future.
    expect(isStale(1e16, HEALTH_STALE_AFTER_MS, now)).toBe(true);
    expect(isStale(-1e16, HEALTH_STALE_AFTER_MS, now)).toBe(true);
  });

  it("defaults `now` to the current time", () => {
    expect(isStale(new Date().toISOString(), HOUR)).toBe(false);
    expect(isStale(new Date(Date.now() - 2 * HOUR).toISOString(), HOUR)).toBe(true);
  });

  it("reads a summary's `checkedAt` directly", () => {
    const summary = summarizeHealth({
      brokenLinks: [],
      missingAlt: 0,
      seoGaps: 0,
      now: new Date(now.getTime() - 48 * HOUR),
    });
    expect(isStale(summary.checkedAt, HEALTH_STALE_AFTER_MS, now)).toBe(true);
  });
});
