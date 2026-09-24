import { describe, expect, it } from "vitest";
import { vanishedRows } from "../../src/core/commerce/index.js";

// Ported from themidwestartist.com (vanishedFourthwallRows, its #192), with the
// column names turned into accessors so any provider's mirror can use it.

interface Row {
  slug: string;
  externalId: string | null;
  missingAt: Date | null;
}
const row = (id: string, missingAt: Date | null = null): Row => ({
  slug: id,
  externalId: id,
  missingAt,
});
const opts = {
  externalId: (r: Row) => r.externalId,
  alreadyMarked: (r: Row) => r.missingAt !== null,
};

describe("vanishedRows", () => {
  it("finds a stored product the catalog no longer returns", () => {
    // The live case: a product retired upstream stayed published at its
    // last-synced price forever.
    const gone = vanishedRows([row("old"), row("new")], new Set(["new"]), opts);
    expect(gone.map((r) => r.slug)).toEqual(["old"]);
  });

  it("leaves everything alone when the catalog is complete", () => {
    expect(vanishedRows([row("a"), row("b")], new Set(["a", "b"]), opts)).toEqual([]);
  });

  it("is idempotent — an already-marked row is not re-marked", () => {
    // Otherwise every sync re-stamps the same product, and a row the owner
    // deliberately republished is pulled back down on the next run.
    expect(vanishedRows([row("old", new Date("2026-08-01"))], new Set(["new"]), opts)).toEqual([]);
  });

  it("ignores rows the provider never owned", () => {
    const manual: Row = { slug: "hand-made", externalId: null, missingAt: null };
    expect(vanishedRows([manual], new Set(["other"]), opts)).toEqual([]);
  });

  it("would flag everything if handed an empty catalog — hence the caller's guard", () => {
    // Pinned so nobody "fixes" it here: a pure diff can't tell an empty shop
    // from a revoked token. The caller must refuse to act on an empty read.
    expect(vanishedRows([row("a"), row("b")], new Set(), opts)).toHaveLength(2);
  });

  it("works without alreadyMarked, for a mirror that deletes instead of marking", () => {
    expect(
      vanishedRows([row("a", new Date()), row("b")], new Set(["b"]), {
        externalId: (r) => r.externalId,
      }),
    ).toHaveLength(1);
  });

  it("handles a catalog larger than SQLite's bound-parameter cap", () => {
    // The reason this is an in-memory diff and not `NOT IN (…)`.
    const stored = Array.from({ length: 50_000 }, (_, i) => row(`p${i}`));
    const seen = new Set(stored.slice(1).map((r) => r.slug));
    expect(vanishedRows(stored, seen, opts).map((r) => r.slug)).toEqual(["p0"]);
  });
});
