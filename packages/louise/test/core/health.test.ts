import { describe, expect, it } from "vitest";
import type { BrokenLink } from "../../src/core/browser/index.js";
import {
  type HealthKV,
  type HealthSummary,
  HEALTH_KV_KEY,
  MAX_BROKEN_LINK_DETAILS,
  healthIssueCount,
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
