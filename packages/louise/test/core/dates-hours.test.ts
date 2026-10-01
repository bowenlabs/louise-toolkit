// core/dates/hours—opening hours and pickup times on the shop's clock, with
// every policy value as a parameter (#714).
import { describe, expect, it } from "vitest";
import {
  openingHoursJsonLd,
  type OpeningHoursRow,
  openingState,
  parseOpeningHours,
  parseWeekday,
  type PickupOptions,
  pickupProblem,
  pickupSlots,
} from "../../src/core/dates/index.js";
import { localBusinessJsonLd } from "../../src/core/seo/index.js";

const TZ = "America/Chicago";

// 2026-03-08 is a Sunday and the spring-forward day in US-Central: before it
// the zone is UTC-6, from 2 AM on it's UTC-5.
const WEEK: OpeningHoursRow[] = [
  { day: "Monday", hours: "7a — 7p" },
  { day: "Tuesday", hours: "7a — 7p" },
  { day: "Wednesday", hours: "7a — 7p" },
  { day: "Thursday", hours: "7a — 7p" },
  { day: "Friday", hours: "7a — 7p" },
  { day: "Saturday", hours: "8 AM – 2 PM" },
  { day: "Sunday", hours: "8a-2p" },
];

const at = (iso: string) => new Date(iso);

describe("parseOpeningHours", () => {
  it.each([
    ["7a — 7p", { open: 420, close: 1140 }],
    ["7a – 7p", { open: 420, close: 1140 }],
    ["7a-7p", { open: 420, close: 1140 }],
    ["7a to 7p", { open: 420, close: 1140 }],
    ["7 AM - 7 PM", { open: 420, close: 1140 }],
    ["7:30 a.m. to 4:45 p.m.", { open: 450, close: 1005 }],
    ["7am—noon", { open: 420, close: 720 }],
    ["noon — midnight", { open: 720, close: 1440 }],
    ["midnight — 6a", { open: 0, close: 360 }],
    ["12a — 12p", { open: 0, close: 720 }],
    ["07:00 - 19:30", { open: 420, close: 1170 }],
    ["9:00 – 24:00", { open: 540, close: 1440 }],
  ])("reads %j", (text, range) => {
    expect(parseOpeningHours(text)).toEqual(range);
  });

  it.each(["Closed", "closed", "  CLOSED "])("reads %j as closed", (text) => {
    expect(parseOpeningHours(text)).toBe("closed");
  });

  it.each([
    "8p — 2a", // overnight: not supported, so the caller decides
    "7p — 7a",
    "7a — 7a",
    "By appointment",
    "",
    "7a",
    "7a — 7p — 9p",
    "13p — 2p",
    "7:75a — 7p",
    "25:00 - 26:00",
    "9:00 - 24:30",
    "7 — 9",
  ])("can't read %j", (text) => {
    expect(parseOpeningHours(text)).toBeNull();
  });
});

describe("parseWeekday", () => {
  it.each([
    ["Sunday", 0],
    ["monday", 1],
    ["TUESDAY", 2],
    [" Wednesday ", 3],
    ["thu", 4],
    ["FRI", 5],
    ["Sat", 6],
    [0, 0],
    [6, 6],
  ] as const)("reads %j as %i", (day, index) => {
    expect(parseWeekday(day)).toBe(index);
  });

  it.each([
    "",
    "Mo",
    "Mond",
    "Tues",
    "Thurs",
    "Mondays",
    "Lunes",
    "domingo",
    -1,
    7,
    1.5,
    Number.NaN,
  ])("can't read %j", (day) => {
    expect(parseWeekday(day)).toBeNull();
  });

  it("finds the row openingState reads for today", () => {
    // 2026-03-09 is a Monday. Only the row parseWeekday reads as 1 counts.
    const rows: OpeningHoursRow[] = [
      { day: "Mond", hours: "Closed" },
      { day: " mon ", hours: "7a-7p" },
    ];
    const monday = at("2026-03-09T15:00:00Z");
    expect(rows.findIndex((r) => parseWeekday(r.day) === 1)).toBe(1);
    expect(openingState(rows, { timeZone: TZ, now: monday }).kind).toBe("open");
  });
});

describe("openingState", () => {
  it("is open, with the closing instant on the shop's clock", () => {
    // Monday 2026-03-09, 10:00 AM CDT.
    expect(openingState(WEEK, { timeZone: TZ, now: at("2026-03-09T15:00:00Z") })).toEqual({
      kind: "open",
      closesAt: at("2026-03-10T00:00:00Z"), // 7 PM CDT
    });
  });

  it("uses the new offset on a daylight saving change day", () => {
    // Sunday 2026-03-08, 10:00 AM CDT. Closing at 2 PM is 19:00Z, not the
    // 20:00Z the pre-change offset would give.
    expect(openingState(WEEK, { timeZone: TZ, now: at("2026-03-08T15:00:00Z") })).toEqual({
      kind: "open",
      closesAt: at("2026-03-08T19:00:00Z"),
    });
    // Saturday 8 PM CST: next opening is Sunday 8 AM CDT.
    expect(openingState(WEEK, { timeZone: TZ, now: at("2026-03-08T02:00:00Z") })).toEqual({
      kind: "closed",
      opensAt: at("2026-03-08T13:00:00Z"),
    });
  });

  it("opens later today when it's before opening", () => {
    // Monday 6:00 AM CDT.
    expect(openingState(WEEK, { timeZone: TZ, now: at("2026-03-09T11:00:00Z") })).toEqual({
      kind: "closed",
      opensAt: at("2026-03-09T12:00:00Z"),
    });
  });

  it("is closed at the closing minute", () => {
    expect(openingState(WEEK, { timeZone: TZ, now: at("2026-03-10T00:00:00Z") }).kind).toBe(
      "closed",
    );
  });

  it("finds the next opening past a closed day", () => {
    const rows = WEEK.map((r) => (r.day === "Sunday" ? { ...r, hours: "Closed" } : r));
    // Sunday noon CDT, closed all day: opens Monday 7 AM CDT.
    expect(openingState(rows, { timeZone: TZ, now: at("2026-03-08T17:00:00Z") })).toEqual({
      kind: "closed",
      opensAt: at("2026-03-09T12:00:00Z"),
    });
  });

  it("skips an unreadable day while it looks ahead", () => {
    const rows: OpeningHoursRow[] = [
      { day: "Sunday", hours: "Closed" },
      { day: "Monday", hours: "By appointment" },
      { day: "Tuesday", hours: "9a-5p" },
    ];
    expect(openingState(rows, { timeZone: TZ, now: at("2026-03-08T17:00:00Z") })).toEqual({
      kind: "closed",
      opensAt: at("2026-03-10T14:00:00Z"),
    });
  });

  it("has no next opening when every day is closed", () => {
    const rows = WEEK.map((r) => ({ ...r, hours: "Closed" }));
    expect(openingState(rows, { timeZone: TZ, now: at("2026-03-09T15:00:00Z") })).toEqual({
      kind: "closed",
      opensAt: null,
    });
  });

  it("is unknown when today's row is missing or can't be read", () => {
    const monday = at("2026-03-09T15:00:00Z");
    expect(openingState([], { timeZone: TZ, now: monday })).toEqual({ kind: "unknown" });
    const rows = [{ day: "Monday", hours: "By appointment" }];
    expect(openingState(rows, { timeZone: TZ, now: monday })).toEqual({ kind: "unknown" });
  });

  it("matches a day by name, three letters, or number, in any case", () => {
    const monday = at("2026-03-09T15:00:00Z");
    for (const day of ["monday", "MON", "Mon", 1]) {
      expect(openingState([{ day, hours: "7a-7p" }], { timeZone: TZ, now: monday }).kind).toBe(
        "open",
      );
    }
    for (const day of ["Mo", "Mond", "Tuesday", 8, 1.5]) {
      expect(openingState([{ day, hours: "7a-7p" }], { timeZone: TZ, now: monday }).kind).toBe(
        "unknown",
      );
    }
  });

  it("closes at midnight on the next day's date", () => {
    const rows = [{ day: "Monday", hours: "noon — midnight" }];
    expect(openingState(rows, { timeZone: TZ, now: at("2026-03-09T23:00:00Z") })).toEqual({
      kind: "open",
      closesAt: at("2026-03-10T05:00:00Z"),
    });
  });

  it("reads the time zone it's given, not the runtime's", () => {
    // 10:00Z on a Monday is 7:00 PM in Tokyo: closed there, open in London.
    const now = at("2026-03-09T10:00:00Z");
    expect(openingState(WEEK, { timeZone: "Asia/Tokyo", now }).kind).toBe("closed");
    expect(openingState(WEEK, { timeZone: "Europe/London", now }).kind).toBe("open");
  });
});

const PICKUP: PickupOptions = {
  timeZone: TZ,
  prepMinutes: 10,
  minLeadMinutes: 20,
  stepMinutes: 15,
  horizonMinutes: 120,
  maxSlots: 6,
  closeGraceMinutes: 2,
  locale: "en-US",
  whenUnknown: "open",
};

const timed = (slots: ReturnType<typeof pickupSlots>) =>
  slots.flatMap((s) => (s.kind === "timed" ? [s.label] : []));

describe("pickupSlots", () => {
  it("offers ASAP after the prep time, then timed slots on the shop's quarter hours", () => {
    // Monday 9:02 AM CDT: timed slots start 20 minutes out, rounded up to 9:30.
    const now = at("2026-03-09T14:02:00Z");
    const slots = pickupSlots(WEEK, { ...PICKUP, now });
    expect(slots[0]).toEqual({ kind: "asap", readyAt: at("2026-03-09T14:12:00Z") });
    expect(slots[1]).toEqual({
      kind: "timed",
      readyAt: at("2026-03-09T14:30:00Z"),
      label: "9:30 AM",
    });
    expect(timed(slots)).toEqual([
      "9:30 AM",
      "9:45 AM",
      "10:00 AM",
      "10:15 AM",
      "10:30 AM",
      "10:45 AM",
    ]);
  });

  it("stops at the horizon when more slots are allowed", () => {
    const now = at("2026-03-09T14:02:00Z");
    expect(timed(pickupSlots(WEEK, { ...PICKUP, maxSlots: 20, now })).at(-1)).toBe("11:00 AM");
  });

  it("stops a run that crosses closing time, keeping a slot exactly at close", () => {
    // Monday 6:10 PM CDT, closing at 7.
    const slots = pickupSlots(WEEK, { ...PICKUP, now: at("2026-03-09T23:10:00Z") });
    expect(timed(slots)).toEqual(["6:30 PM", "6:45 PM", "7:00 PM"]);
  });

  it("starts the timed slots at the prep time when it's longer than the lead", () => {
    const slots = pickupSlots(WEEK, {
      ...PICKUP,
      prepMinutes: 40,
      now: at("2026-03-09T14:02:00Z"),
    });
    expect(timed(slots)[0]).toBe("9:45 AM");
  });

  it("aligns to the shop's wall clock in a zone with a half-hour offset", () => {
    // 04:02Z is 9:32 AM in Kolkata (UTC+5:30): the next quarter hour there is 10:00.
    const slots = pickupSlots([{ day: 1, hours: "7a-7p" }], {
      ...PICKUP,
      timeZone: "Asia/Kolkata",
      now: at("2026-03-09T04:02:00Z"),
    });
    expect(timed(slots)[0]).toBe("10:00 AM");
  });

  it("labels slots on the shop's clock on a daylight saving change day", () => {
    // Sunday 2026-03-08, 10:00 AM CDT.
    const slots = pickupSlots(WEEK, { ...PICKUP, maxSlots: 2, now: at("2026-03-08T15:00:00Z") });
    expect(slots.slice(1)).toEqual([
      { kind: "timed", readyAt: at("2026-03-08T15:30:00Z"), label: "10:30 AM" },
      { kind: "timed", readyAt: at("2026-03-08T15:45:00Z"), label: "10:45 AM" },
    ]);
  });

  it("labels in the locale it's given", () => {
    const slots = pickupSlots(WEEK, {
      ...PICKUP,
      locale: "de-DE",
      now: at("2026-03-09T23:10:00Z"),
    });
    expect(timed(slots)).toEqual(["18:30", "18:45", "19:00"]);
  });

  it("offers nothing while the shop is closed", () => {
    expect(pickupSlots(WEEK, { ...PICKUP, now: at("2026-03-09T11:00:00Z") })).toEqual([]);
  });

  it("offers nothing when an order started now can't be ready by closing", () => {
    // Monday 6:55 PM CDT with 10 minutes of prep.
    expect(pickupSlots(WEEK, { ...PICKUP, now: at("2026-03-09T23:55:00Z") })).toEqual([]);
  });

  it("follows whenUnknown when today's hours can't be read", () => {
    const now = at("2026-03-09T23:10:00Z");
    const open = pickupSlots([], { ...PICKUP, now });
    expect(timed(open)).toEqual(["6:30 PM", "6:45 PM", "7:00 PM", "7:15 PM", "7:30 PM", "7:45 PM"]);
    expect(pickupSlots([], { ...PICKUP, whenUnknown: "closed", now })).toEqual([]);
  });

  it("throws for a step that isn't positive", () => {
    expect(() => pickupSlots(WEEK, { ...PICKUP, stepMinutes: 0 })).toThrow(RangeError);
  });
});

describe("pickupProblem", () => {
  const now = at("2026-03-09T23:10:00Z"); // Monday 6:10 PM CDT, closing at 7

  it("accepts every slot pickupSlots offered", () => {
    for (const slot of pickupSlots(WEEK, { ...PICKUP, now })) {
      expect(pickupProblem(WEEK, slot.readyAt, { ...PICKUP, now })).toBeNull();
    }
  });

  it("allows the grace past closing, and no more", () => {
    expect(pickupProblem(WEEK, at("2026-03-10T00:02:00Z"), { ...PICKUP, now })).toBeNull();
    expect(pickupProblem(WEEK, at("2026-03-10T00:02:01Z").getTime(), { ...PICKUP, now })).toBe(
      "after-close",
    );
  });

  it("refuses a pickup while the shop is closed", () => {
    const early = at("2026-03-09T11:00:00Z");
    expect(pickupProblem(WEEK, at("2026-03-09T12:30:00Z"), { ...PICKUP, now: early })).toBe(
      "closed",
    );
  });

  it("refuses a pickup past the horizon", () => {
    const morning = at("2026-03-09T14:00:00Z");
    expect(pickupProblem(WEEK, at("2026-03-09T16:00:00Z"), { ...PICKUP, now: morning })).toBeNull();
    expect(pickupProblem(WEEK, at("2026-03-09T16:01:00Z"), { ...PICKUP, now: morning })).toBe(
      "too-far",
    );
  });

  it("follows whenUnknown when today's hours can't be read", () => {
    const later = at("2026-03-10T01:00:00Z"); // 8 PM, no close to bound it
    expect(pickupProblem([], later, { ...PICKUP, now })).toBeNull();
    expect(pickupProblem([], later, { ...PICKUP, whenUnknown: "closed", now })).toBe("closed");
  });
});

describe("openingHoursJsonLd", () => {
  it("groups days with the same hours, Monday first, and leaves out closed days", () => {
    const rows = [...WEEK.slice(0, 6), { day: "Sunday", hours: "Closed" }];
    expect(openingHoursJsonLd(rows)).toEqual([
      {
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "07:00",
        closes: "19:00",
      },
      { days: ["Saturday"], opens: "08:00", closes: "14:00" },
    ]);
  });

  it("writes a midnight close as 23:59 and skips a day it can't read", () => {
    const rows = [
      { day: "Friday", hours: "noon — midnight" },
      { day: "Saturday", hours: "By appointment" },
    ];
    expect(openingHoursJsonLd(rows)).toEqual([
      { days: ["Friday"], opens: "12:00", closes: "23:59" },
    ]);
  });

  it("feeds localBusinessJsonLd, so the hours shown and the structured data share one parser", () => {
    const ld = localBusinessJsonLd(
      { siteName: "Example Organization" },
      { type: "CafeOrCoffeeShop", openingHours: openingHoursJsonLd(WEEK) },
      { origin: "https://example.com" },
    );
    expect(JSON.stringify(ld)).toContain('"opens":"07:00"');
  });
});
