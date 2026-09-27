// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: inventory counts.

import type { SquareConfig } from "./client.js";
import { sqPost } from "./request.js";

export interface SquareInventoryCount {
  catalogObjectId: string;
  state: string;
  quantity: number;
  locationId: string;
}

/** POST /v2/inventory/counts/batch-retrieve. */
export async function retrieveInventoryCounts(
  config: SquareConfig,
  catalogObjectIds: string[],
  locationIds?: string[],
): Promise<SquareInventoryCount[]> {
  const res = await sqPost<{
    counts?: {
      catalog_object_id?: string;
      state?: string;
      quantity?: string;
      location_id?: string;
    }[];
  }>(config, "/v2/inventory/counts/batch-retrieve", {
    catalog_object_ids: catalogObjectIds,
    ...(locationIds ? { location_ids: locationIds } : {}),
  });
  return (res.counts ?? []).map((c) => ({
    catalogObjectId: c.catalog_object_id ?? "",
    state: c.state ?? "",
    quantity: Number(c.quantity ?? 0),
    locationId: c.location_id ?? "",
  }));
}

/**
 * One inventory change. `PHYSICAL_COUNT` sets an absolute quantity ("there are 4
 * here now"); `ADJUSTMENT` moves stock between states by a delta.
 *
 * Prefer PHYSICAL_COUNT when reconciling against a real-world count: it is
 * idempotent in effect, so a replayed message lands on the same number, whereas
 * a replayed ADJUSTMENT double-counts.
 */
export type SquareInventoryChange =
  | {
      type: "PHYSICAL_COUNT";
      catalogObjectId: string;
      locationId: string;
      quantity: number;
      /** Defaults to IN_STOCK. */
      state?: string;
      /** RFC 3339. Defaults to now. Square rejects timestamps in the future. */
      occurredAt?: string;
    }
  | {
      type: "ADJUSTMENT";
      catalogObjectId: string;
      locationId: string;
      quantity: number;
      fromState: string;
      toState: string;
      occurredAt?: string;
    };

/**
 * Apply inventory changes. POST /v2/inventory/changes/batch-create.
 *
 * Note the direction of truth: D1 owns price, presence and placement, but
 * **Square owns inventory counts**. This exists for the reconcile path—a
 * physical recount, or seeding a new merchant's opening stock—not for mirroring
 * a D1 number over Square's on every sync.
 */
export async function batchChangeInventory(
  config: SquareConfig,
  changes: SquareInventoryChange[],
  options?: { idempotencyKey?: string },
): Promise<SquareInventoryCount[]> {
  const now = new Date().toISOString();
  const res = await sqPost<{
    counts?: {
      catalog_object_id?: string;
      state?: string;
      quantity?: string;
      location_id?: string;
    }[];
  }>(config, "/v2/inventory/changes/batch-create", {
    idempotency_key: options?.idempotencyKey ?? crypto.randomUUID(),
    changes: changes.map((c) =>
      c.type === "PHYSICAL_COUNT"
        ? {
            type: "PHYSICAL_COUNT",
            physical_count: {
              catalog_object_id: c.catalogObjectId,
              location_id: c.locationId,
              state: c.state ?? "IN_STOCK",
              // Square wants the quantity as a string.
              quantity: String(c.quantity),
              occurred_at: c.occurredAt ?? now,
            },
          }
        : {
            type: "ADJUSTMENT",
            adjustment: {
              catalog_object_id: c.catalogObjectId,
              location_id: c.locationId,
              from_state: c.fromState,
              to_state: c.toState,
              quantity: String(c.quantity),
              occurred_at: c.occurredAt ?? now,
            },
          },
    ),
  });
  return (res.counts ?? []).map((c) => ({
    catalogObjectId: c.catalog_object_id ?? "",
    state: c.state ?? "",
    quantity: Number(c.quantity ?? 0),
    locationId: c.location_id ?? "",
  }));
}

/** Set one variation's absolute on-hand count at one location—the common case
 *  of {@link batchChangeInventory}, named for what it does. */
export function setPhysicalCount(
  config: SquareConfig,
  input: {
    catalogObjectId: string;
    locationId: string;
    quantity: number;
    state?: string;
    occurredAt?: string;
    idempotencyKey?: string;
  },
): Promise<SquareInventoryCount[]> {
  return batchChangeInventory(config, [{ type: "PHYSICAL_COUNT", ...input }], {
    idempotencyKey: input.idempotencyKey,
  });
}
