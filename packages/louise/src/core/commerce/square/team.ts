// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: team members (employees).

import type { SquareConfig } from "./client.js";
import { orNotFound, sqGet, sqPost, sqPut } from "./request.js";

export interface SquareTeamMember {
  id: string;
  referenceId: string | null;
  givenName: string | null;
  familyName: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  status: string;
  isOwner: boolean;
}

interface RawTeamMember {
  id?: string;
  reference_id?: string;
  given_name?: string;
  family_name?: string;
  email_address?: string;
  phone_number?: string;
  status?: string;
  is_owner?: boolean;
}

function mapTeamMember(m: RawTeamMember): SquareTeamMember {
  return {
    id: m.id ?? "",
    referenceId: m.reference_id ?? null,
    givenName: m.given_name ?? null,
    familyName: m.family_name ?? null,
    emailAddress: m.email_address ?? null,
    phoneNumber: m.phone_number ?? null,
    status: m.status ?? "",
    isOwner: m.is_owner ?? false,
  };
}

export interface TeamMemberInput {
  givenName?: string;
  familyName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  /** Your own id for this person (for example, a portal_user id)—round-trips on the
   *  Square record so you can correlate without a separate lookup. */
  referenceId?: string;
  status?: "ACTIVE" | "INACTIVE";
  /** Assign to all current + future locations (the common default). Omit and
   *  Square assigns none; you manage locations yourself. */
  assignAllLocations?: boolean;
}

function teamMemberBody(input: TeamMemberInput) {
  return {
    given_name: input.givenName,
    family_name: input.familyName,
    email_address: input.emailAddress,
    phone_number: input.phoneNumber,
    reference_id: input.referenceId,
    status: input.status ?? "ACTIVE",
    ...(input.assignAllLocations
      ? { assigned_locations: { assignment_type: "ALL_CURRENT_AND_FUTURE_LOCATIONS" } }
      : {}),
  };
}

/** Create a team member (employee). POST /v2/team-members. */
export async function createTeamMember(
  config: SquareConfig,
  input: TeamMemberInput & { idempotencyKey?: string },
): Promise<SquareTeamMember> {
  const res = await sqPost<{ team_member?: RawTeamMember }>(config, "/v2/team-members", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    team_member: teamMemberBody(input),
  });
  if (!res.team_member) throw new Error("Square team member creation returned no member");
  return mapTeamMember(res.team_member);
}

/** Update a team member. PUT /v2/team-members/{id}. */
export async function updateTeamMember(
  config: SquareConfig,
  teamMemberId: string,
  input: TeamMemberInput,
): Promise<SquareTeamMember> {
  const res = await sqPut<{ team_member?: RawTeamMember }>(
    config,
    `/v2/team-members/${encodeURIComponent(teamMemberId)}`,
    { team_member: teamMemberBody(input) },
  );
  if (!res.team_member) throw new Error(`Square team member ${teamMemberId} update returned none`);
  return mapTeamMember(res.team_member);
}

/** Retrieve one team member. GET /v2/team-members/{id}. */
export async function retrieveTeamMember(
  config: SquareConfig,
  teamMemberId: string,
): Promise<SquareTeamMember | null> {
  // A 404 is an answer, not a failure (#700), like the other retrieves.
  const res = await orNotFound(() =>
    sqGet<{ team_member?: RawTeamMember }>(
      config,
      `/v2/team-members/${encodeURIComponent(teamMemberId)}`,
    ),
  );
  return res?.team_member ? mapTeamMember(res.team_member) : null;
}

/**
 * Search team members. POST /v2/team-members/search. The Team API has no email
 * filter, so pass `status`/`locationIds` and match the rest client-side (by
 * `referenceId` or `emailAddress`). Coffee teams are small—one page suffices,
 * so this returns the first page (up to `limit`, default 200).
 */
export async function searchTeamMembers(
  config: SquareConfig,
  input: { locationIds?: string[]; status?: "ACTIVE" | "INACTIVE"; limit?: number } = {},
): Promise<SquareTeamMember[]> {
  const filter: Record<string, unknown> = { status: input.status ?? "ACTIVE" };
  if (input.locationIds) filter.location_ids = input.locationIds;
  const res = await sqPost<{ team_members?: RawTeamMember[] }>(config, "/v2/team-members/search", {
    query: { filter },
    limit: input.limit ?? 200,
  });
  return (res.team_members ?? []).map(mapTeamMember);
}
