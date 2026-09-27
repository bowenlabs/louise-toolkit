// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: locations.
//
// A Square Location is a place that sells. Multi-merchant sites map one merchant
// to one Location: that is what buys per-merchant pricing (`location_overrides`)
// and per-merchant stock off a single shared catalog, at no extra cost—Locations
// are free, and the cap is 300.

import { UpstreamError } from "../../security/upstream.js";
import type { SquareConfig } from "./client.js";
import { sqGet, sqPost, sqPut } from "./request.js";

export interface SquareLocation {
  id: string;
  name: string;
  /** ACTIVE | INACTIVE. Inactive locations still resolve but should not be sold at. */
  status: string;
  /** ISO 4217, for example, "USD". A location's currency is fixed at creation. */
  currency: string;
  timezone: string | null;
  /** Formatted single-line address, or null when the location has none. */
  address: string | null;
  businessName: string | null;
}

interface RawLocation {
  id?: string;
  name?: string;
  status?: string;
  currency?: string;
  timezone?: string;
  business_name?: string;
  address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    administrative_district_level_1?: string;
    postal_code?: string;
  };
}

function mapLocation(raw: RawLocation): SquareLocation {
  const a = raw.address;
  const line = [
    a?.address_line_1,
    a?.address_line_2,
    a?.locality,
    a?.administrative_district_level_1,
    a?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    status: raw.status ?? "",
    currency: raw.currency ?? "USD",
    timezone: raw.timezone ?? null,
    address: line || null,
    businessName: raw.business_name ?? null,
  };
}

/** Every location on the account. GET /v2/locations—unpaginated by design
 *  (Square caps an account at 300 locations and returns them all). */
export async function listLocations(config: SquareConfig): Promise<SquareLocation[]> {
  const res = await sqGet<{ locations?: RawLocation[] }>(config, "/v2/locations");
  return (res.locations ?? []).map(mapLocation);
}

/** One location by id, or null when it does not exist. GET /v2/locations/{id}. */
export async function retrieveLocation(
  config: SquareConfig,
  locationId: string,
): Promise<SquareLocation | null> {
  try {
    const res = await sqGet<{ location?: RawLocation }>(
      config,
      `/v2/locations/${encodeURIComponent(locationId)}`,
    );
    return res.location ? mapLocation(res.location) : null;
  } catch (err) {
    // A missing location is a 404 and a legitimate answer ("this merchant has no
    // Square location yet"), not an error the caller should have to catch.
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
}

/** A location's editable fields. Structured, not the formatted single line
 *  {@link SquareLocation} reads back; Square needs the parts. */
export interface SquareLocationInput {
  name: string;
  businessName?: string;
  timezone?: string;
  address?: {
    line1?: string;
    line2?: string;
    /** City. */
    locality?: string;
    /** State / province. */
    region?: string;
    postalCode?: string;
    /** ISO 3166-1 alpha-2, for example, "US". */
    country?: string;
  };
}

function locationBody(input: Partial<SquareLocationInput>) {
  const a = input.address;
  return {
    ...(input.name != null ? { name: input.name } : {}),
    ...(input.businessName != null ? { business_name: input.businessName } : {}),
    ...(input.timezone != null ? { timezone: input.timezone } : {}),
    ...(a
      ? {
          address: {
            ...(a.line1 != null ? { address_line_1: a.line1 } : {}),
            ...(a.line2 != null ? { address_line_2: a.line2 } : {}),
            ...(a.locality != null ? { locality: a.locality } : {}),
            ...(a.region != null ? { administrative_district_level_1: a.region } : {}),
            ...(a.postalCode != null ? { postal_code: a.postalCode } : {}),
            ...(a.country != null ? { country: a.country } : {}),
          },
        }
      : {}),
  };
}

/**
 * Create a location. POST /v2/locations. The onboarding call—a new merchant
 * joining a multi-location deploy needs one before anything can be sold there.
 *
 * **Currency is not settable and is not per-request.** Square derives it from
 * the seller account, so every location under one account shares it: an account
 * cannot mix USD and CAD. If a merchant needs a different currency they need a
 * different Square account, which is an onboarding constraint rather than a code
 * one—worth knowing before designing around it.
 *
 * The cap is 300 locations per account, including deactivated ones.
 */
export async function createLocation(
  config: SquareConfig,
  input: SquareLocationInput,
): Promise<SquareLocation> {
  const res = await sqPost<{ location?: RawLocation }>(config, "/v2/locations", {
    location: locationBody(input),
  });
  if (!res.location) throw new Error("Square location creation returned no location");
  return mapLocation(res.location);
}

/**
 * Update a location. PUT /v2/locations/{id}.
 *
 * Sparse: only the fields you pass are sent, so this never clears a field by
 * omission—which matters because `address` is a nested object Square replaces
 * wholesale. Passing a partial address replaces the whole address with that
 * partial, so read first if you mean to change one line of it.
 *
 * A location cannot be deleted, only deactivated—set `status` through the
 * Square dashboard; the API does not expose it here.
 */
export async function updateLocation(
  config: SquareConfig,
  locationId: string,
  input: Partial<SquareLocationInput>,
): Promise<SquareLocation> {
  const res = await sqPut<{ location?: RawLocation }>(
    config,
    `/v2/locations/${encodeURIComponent(locationId)}`,
    { location: locationBody(input) },
  );
  if (!res.location) throw new Error(`Square location ${locationId} update returned none`);
  return mapLocation(res.location);
}
