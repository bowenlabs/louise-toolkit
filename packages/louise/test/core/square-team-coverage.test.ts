// core/commerce/square—team members and labor timecards against a stubbed
// fetch: the bodies Square receives and the records mapped back (#695).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTeamMember,
  createTimecard,
  retrieveTeamMember,
  retrieveTimecard,
  searchTeamMembers,
  searchTimecards,
  updateTeamMember,
  updateTimecard,
} from "../../src/core/commerce/square.js";

const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Stub fetch to answer every request with `body`, capturing each call. */
function answer(body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        path: new URL(input).pathname,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("team members", () => {
  it("creates an ACTIVE member with no location assignment unless asked", async () => {
    const calls = answer({ team_member: { id: "TM1", given_name: "Alex" } });
    const member = await createTeamMember(CONFIG, { givenName: "Alex" });
    const body = calls[0]?.body as { idempotency_key: string; team_member: object };
    expect(body.idempotency_key).toMatch(UUID);
    // No `assigned_locations` key: Square then assigns none.
    expect(body.team_member).toEqual({ given_name: "Alex", status: "ACTIVE" });
    expect(member).toEqual({
      id: "TM1",
      referenceId: null,
      givenName: "Alex",
      familyName: null,
      emailAddress: null,
      phoneNumber: null,
      status: "",
      isOwner: false,
    });
  });

  it("updates with a PUT to the encoded id, carrying the status it's given", async () => {
    const calls = answer({
      team_member: {
        id: "TM/1",
        reference_id: "portal-7",
        given_name: "Kai",
        family_name: "Doe",
        email_address: "kai@example.com",
        phone_number: "+18005550102",
        status: "INACTIVE",
        is_owner: true,
      },
    });
    const member = await updateTeamMember(CONFIG, "TM/1", {
      status: "INACTIVE",
      referenceId: "portal-7",
      assignAllLocations: true,
    });
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/v2/team-members/TM%2F1" });
    expect(calls[0]?.body).toEqual({
      team_member: {
        reference_id: "portal-7",
        status: "INACTIVE",
        assigned_locations: { assignment_type: "ALL_CURRENT_AND_FUTURE_LOCATIONS" },
      },
    });
    expect(member).toMatchObject({ id: "TM/1", status: "INACTIVE", isOwner: true });
  });

  it("retrieves one member, or null when Square's body has none", async () => {
    let calls = answer({ team_member: { id: "TM1", family_name: "Doe" } });
    expect(await retrieveTeamMember(CONFIG, "TM1")).toMatchObject({ id: "TM1", familyName: "Doe" });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/team-members/TM1" });

    calls = answer({});
    expect(await retrieveTeamMember(CONFIG, "TM2")).toBeNull();
  });

  it("searches ACTIVE members, first page of 200, by default", async () => {
    const calls = answer({});
    expect(await searchTeamMembers(CONFIG)).toEqual([]);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/team-members/search" });
    expect(calls[0]?.body).toEqual({ query: { filter: { status: "ACTIVE" } }, limit: 200 });
  });

  it("filters by status and locations when given", async () => {
    const calls = answer({ team_members: [{ id: "TM1" }, { id: "TM2" }] });
    const members = await searchTeamMembers(CONFIG, {
      status: "INACTIVE",
      locationIds: ["L1", "L2"],
      limit: 5,
    });
    expect(calls[0]?.body).toEqual({
      query: { filter: { status: "INACTIVE", location_ids: ["L1", "L2"] } },
      limit: 5,
    });
    expect(members.map((m) => m.id)).toEqual(["TM1", "TM2"]);
  });

  it.each([
    ["createTeamMember", () => createTeamMember(CONFIG, {}), /returned no member/],
    [
      "updateTeamMember",
      () => updateTeamMember(CONFIG, "TM1", {}),
      /Square team member TM1 update returned none/,
    ],
  ])("%s throws when Square answers without a member", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });
});

describe("timecards", () => {
  it("opens a card with no wage key when none is given", async () => {
    const calls = answer({
      timecard: { id: "TC1", wage: { title: "Barista" } },
    });
    const card = await createTimecard(CONFIG, {
      locationId: "L1",
      teamMemberId: "TM1",
      startAt: "2026-09-27T08:00:00-05:00",
      idempotencyKey: "clock-in-TM1",
    });
    expect(calls[0]?.body).toEqual({
      idempotency_key: "clock-in-TM1",
      timecard: {
        location_id: "L1",
        team_member_id: "TM1",
        start_at: "2026-09-27T08:00:00-05:00",
      },
    });
    // A wage without a rate still maps, to zero in USD.
    expect(card).toEqual({
      id: "TC1",
      locationId: "",
      teamMemberId: "",
      startAt: "",
      endAt: null,
      status: "",
      version: 0,
      wage: { title: "Barista", hourlyRateCents: 0, currency: "USD" },
    });
  });

  it("sends a wage in the caller's currency on update", async () => {
    const calls = answer({ timecard: { id: "TC1", status: "CLOSED", version: 2 } });
    await updateTimecard(CONFIG, "TC1", {
      locationId: "L1",
      teamMemberId: "TM1",
      startAt: "2026-09-27T08:00:00-05:00",
      endAt: "2026-09-27T16:00:00-05:00",
      version: 1,
      wage: { hourlyRateCents: 2000, currency: "CAD" },
    });
    expect(calls[0]?.body).toMatchObject({
      timecard: { wage: { hourly_rate: { amount: 2000, currency: "CAD" } } },
    });
  });

  it("retrieves one card, or null when Square's body has none", async () => {
    let calls = answer({
      timecard: {
        id: "TC1",
        end_at: "2026-09-27T16:00:00Z",
        wage: { title: "Lead", hourly_rate: { amount: 2400, currency: "USD" } },
      },
    });
    const card = await retrieveTimecard(CONFIG, "TC1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/labor/timecards/TC1" });
    expect(card).toMatchObject({
      endAt: "2026-09-27T16:00:00Z",
      wage: { title: "Lead", hourlyRateCents: 2400, currency: "USD" },
    });

    calls = answer({});
    expect(await retrieveTimecard(CONFIG, "TC2")).toBeNull();
  });

  it("searches newest first with an empty filter and 200 per page by default", async () => {
    const calls = answer({});
    expect(await searchTimecards(CONFIG)).toEqual([]);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/labor/timecards/search" });
    expect(calls[0]?.body).toEqual({
      query: { filter: {}, sort: { field: "START_AT", order: "DESC" } },
      limit: 200,
    });
  });

  it("filters by team members, locations, and a start window", async () => {
    const calls = answer({ timecards: [{ id: "TC1" }] });
    const cards = await searchTimecards(CONFIG, {
      teamMemberIds: ["TM1"],
      locationIds: ["L1"],
      startAtMin: "2026-09-01T00:00:00Z",
      startAtMax: "2026-09-30T00:00:00Z",
      limit: 50,
    });
    expect(calls[0]?.body).toEqual({
      query: {
        filter: {
          team_member_ids: ["TM1"],
          location_ids: ["L1"],
          start: { start_at: "2026-09-01T00:00:00Z", end_at: "2026-09-30T00:00:00Z" },
        },
        sort: { field: "START_AT", order: "DESC" },
      },
      limit: 50,
    });
    expect(cards.map((c) => c.id)).toEqual(["TC1"]);
  });

  it("sends an open-ended window when only its end is given", async () => {
    const calls = answer({});
    await searchTimecards(CONFIG, { startAtMax: "2026-09-30T00:00:00Z" });
    // `start_at` is undefined, so JSON leaves it out.
    expect(calls[0]?.body).toMatchObject({
      query: { filter: { start: { end_at: "2026-09-30T00:00:00Z" } } },
    });
  });

  it.each([
    [
      "createTimecard",
      () => createTimecard(CONFIG, { locationId: "L1", teamMemberId: "TM1", startAt: "x" }),
      /returned no timecard/,
    ],
    [
      "updateTimecard",
      () =>
        updateTimecard(CONFIG, "TC1", {
          locationId: "L1",
          teamMemberId: "TM1",
          startAt: "x",
          version: 1,
        }),
      /Square timecard TC1 update returned none/,
    ],
  ])("%s throws when Square answers without a timecard", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });
});
