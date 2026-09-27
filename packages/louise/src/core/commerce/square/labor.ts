// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: labor: timecards and time tracking.

import type { SquareConfig } from "./client.js";
import { sqGet, sqPost, sqPut } from "./request.js";

export interface SquareTimecard {
  id: string;
  locationId: string;
  teamMemberId: string;
  startAt: string;
  endAt: string | null;
  status: string;
  /** Optimistic-concurrency version—pass it back to update/close the card. */
  version: number;
  /** Wage on the card (Square defaults it from the team member). An update is a
   *  full replace and Square requires a wage, so pass this back when closing. */
  wage: { title: string | null; hourlyRateCents: number; currency: string } | null;
}

interface RawTimecard {
  id?: string;
  location_id?: string;
  team_member_id?: string;
  start_at?: string;
  end_at?: string;
  status?: string;
  version?: number;
  wage?: { title?: string; hourly_rate?: { amount?: number; currency?: string } };
}

function mapTimecard(t: RawTimecard): SquareTimecard {
  return {
    id: t.id ?? "",
    locationId: t.location_id ?? "",
    teamMemberId: t.team_member_id ?? "",
    startAt: t.start_at ?? "",
    endAt: t.end_at ?? null,
    status: t.status ?? "",
    version: t.version ?? 0,
    wage: t.wage
      ? {
          title: t.wage.title ?? null,
          hourlyRateCents: t.wage.hourly_rate?.amount ?? 0,
          currency: t.wage.hourly_rate?.currency ?? "USD",
        }
      : null,
  };
}

export interface TimecardWage {
  title?: string;
  hourlyRateCents: number;
  currency?: string;
}

function wageBody(wage?: TimecardWage) {
  return wage
    ? {
        wage: {
          title: wage.title,
          hourly_rate: { amount: wage.hourlyRateCents, currency: wage.currency ?? "USD" },
        },
      }
    : {};
}

/**
 * Open a timecard (clock in). POST /v2/labor/timecards. A team member can hold
 * only ONE open timecard at a time. `startAt` is an RFC 3339 timestamp; pass a
 * `wage` (hourly rate) for Square to compute labor cost. Returns the timecard
 * incl. its `version`, which you need to close it later. Requires Square-Version
 * ≥ 2025-05-21 (the default pinned {@link SQUARE_VERSION} satisfies this).
 */
export async function createTimecard(
  config: SquareConfig,
  input: {
    locationId: string;
    teamMemberId: string;
    startAt: string;
    wage?: TimecardWage;
    idempotencyKey?: string;
  },
): Promise<SquareTimecard> {
  const res = await sqPost<{ timecard?: RawTimecard }>(config, "/v2/labor/timecards", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    timecard: {
      location_id: input.locationId,
      team_member_id: input.teamMemberId,
      start_at: input.startAt,
      ...wageBody(input.wage),
    },
  });
  if (!res.timecard) throw new Error("Square timecard creation returned no timecard");
  return mapTimecard(res.timecard);
}

/**
 * Update a timecard—typically to close it (clock out) by setting `endAt`.
 * PUT /v2/labor/timecards/{id} REPLACES the record, so pass its full state
 * (location, team member, start) plus the current `version` from the prior
 * create/retrieve (Square rejects a stale version).
 */
export async function updateTimecard(
  config: SquareConfig,
  timecardId: string,
  input: {
    locationId: string;
    teamMemberId: string;
    startAt: string;
    endAt?: string;
    version: number;
    wage?: TimecardWage;
  },
): Promise<SquareTimecard> {
  const res = await sqPut<{ timecard?: RawTimecard }>(
    config,
    `/v2/labor/timecards/${encodeURIComponent(timecardId)}`,
    {
      timecard: {
        location_id: input.locationId,
        team_member_id: input.teamMemberId,
        start_at: input.startAt,
        end_at: input.endAt,
        version: input.version,
        ...wageBody(input.wage),
      },
    },
  );
  if (!res.timecard) throw new Error(`Square timecard ${timecardId} update returned none`);
  return mapTimecard(res.timecard);
}

/** Retrieve one timecard (for example, to read its current version before closing).
 *  GET /v2/labor/timecards/{id}. */
export async function retrieveTimecard(
  config: SquareConfig,
  timecardId: string,
): Promise<SquareTimecard | null> {
  const res = await sqGet<{ timecard?: RawTimecard }>(
    config,
    `/v2/labor/timecards/${encodeURIComponent(timecardId)}`,
  );
  return res.timecard ? mapTimecard(res.timecard) : null;
}

/**
 * Search timecards (labor reporting). POST /v2/labor/timecards/search. Filter
 * by team members, locations, and/or a start-time window (RFC 3339).
 * Returns the first page newest-first (up to `limit`, default 200).
 */
export async function searchTimecards(
  config: SquareConfig,
  input: {
    teamMemberIds?: string[];
    locationIds?: string[];
    startAtMin?: string;
    startAtMax?: string;
    limit?: number;
  } = {},
): Promise<SquareTimecard[]> {
  const filter: Record<string, unknown> = {};
  if (input.teamMemberIds) filter.team_member_ids = input.teamMemberIds;
  if (input.locationIds) filter.location_ids = input.locationIds;
  if (input.startAtMin || input.startAtMax) {
    filter.start = { start_at: input.startAtMin, end_at: input.startAtMax };
  }
  const res = await sqPost<{ timecards?: RawTimecard[] }>(config, "/v2/labor/timecards/search", {
    query: { filter, sort: { field: "START_AT", order: "DESC" } },
    limit: input.limit ?? 200,
  });
  return (res.timecards ?? []).map(mapTimecard);
}
