import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchUpsertCatalogObjects,
  deletePaymentLink,
  retrieveTeamMember,
  retrieveTimecard,
} from "../../src/core/commerce/square.js";

// #700: two retrieves read a 404 as "none," an empty 2xx body doesn't throw a
// TypeError, and a batch catalog write respects Square's object limits.

const config = { accessToken: "sq-test", environment: "sandbox" as const };

afterEach(() => vi.unstubAllGlobals());

function square(answer: (path: string, body: unknown) => Response) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      return answer(path, body);
    }),
  );
  return calls;
}

const notFound = () =>
  Response.json(
    { errors: [{ code: "NOT_FOUND", category: "INVALID_REQUEST_ERROR" }] },
    { status: 404 },
  );

describe("retrieves that read a 404 as none", () => {
  it("returns null for a timecard or team member Square doesn't have", async () => {
    square(notFound);
    expect(await retrieveTimecard(config, "tc_1")).toBeNull();
    expect(await retrieveTeamMember(config, "tm_1")).toBeNull();
  });

  it("still throws on any other failure", async () => {
    square(() => Response.json({ errors: [{ code: "UNAUTHORIZED" }] }, { status: 401 }));
    await expect(retrieveTimecard(config, "tc_1")).rejects.toMatchObject({ status: 401 });
  });
});

describe("an empty 2xx body", () => {
  it("reads as an empty object, not a TypeError", async () => {
    square(() => new Response(null, { status: 204 }));
    expect(await deletePaymentLink(config, "pl_1")).toEqual({ id: "pl_1", cancelledOrderId: null });
  });
});

describe("batchUpsertCatalogObjects limits", () => {
  const item = (i: number, variations: number) => ({
    clientId: `#i${i}`,
    name: `Item ${i}`,
    variations: Array.from({ length: variations }, (_, j) => ({
      name: `V${j}`,
      priceCents: 100,
    })),
  });

  it("sends nothing for an empty list", async () => {
    const calls = square(() => Response.json({}));
    expect(await batchUpsertCatalogObjects(config, [])).toEqual({ idMappings: {}, objects: [] });
    expect(calls).toHaveLength(0);
  });

  it("packs items so no batch holds more than 1,000 objects, variations included", async () => {
    const calls = square(() => Response.json({ objects: [], id_mappings: [] }));
    // 30 items with 49 variations each: 50 objects apiece, 1,500 in all.
    await batchUpsertCatalogObjects(
      config,
      Array.from({ length: 30 }, (_, i) => item(i, 49)),
    );
    const batches = (
      calls[0]?.body as { batches: { objects: { item_data: { variations: unknown[] } }[] }[] }
    ).batches;
    const weights = batches.map((b) =>
      b.objects.reduce((n, o) => n + 1 + o.item_data.variations.length, 0),
    );
    expect(weights).toEqual([1000, 500]);
  });

  it("refuses a write over 10,000 objects before sending anything", async () => {
    const calls = square(() => Response.json({}));
    const items = Array.from({ length: 201 }, (_, i) => item(i, 49));
    await expect(batchUpsertCatalogObjects(config, items)).rejects.toThrow(
      "10050 objects (items and variations) is over Square's limit of 10000 per request",
    );
    expect(calls).toHaveLength(0);
  });
});
