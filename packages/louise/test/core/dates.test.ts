import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  formatCalendarDate,
  formatInstant,
  isIsoDate,
  isoDateIn,
  todayIn,
  weekdayOf,
  zonedTimeToUtc,
} from "../../src/core/dates/index.js";

const CHICAGO = "America/Chicago";

describe("isoDateIn / todayIn", () => {
  it("is still today in Chicago at 8pm, when UTC has rolled over", () => {
    // The bug every site hit: 8pm CDT on Sep 23 is 01:00Z on Sep 24.
    const evening = Date.parse("2026-09-24T01:00:00Z");
    expect(new Date(evening).toISOString().slice(0, 10)).toBe("2026-09-24");
    expect(isoDateIn(evening, CHICAGO)).toBe("2026-09-23");
    expect(todayIn(CHICAGO, evening)).toBe("2026-09-23");
  });

  it("rolls over at local midnight, on standard time too", () => {
    // CST (UTC-6): 23:59 local is 05:59Z, 00:00 local is 06:00Z.
    expect(isoDateIn(Date.parse("2026-12-01T05:59:00Z"), CHICAGO)).toBe("2026-11-30");
    expect(isoDateIn(Date.parse("2026-12-01T06:00:00Z"), CHICAGO)).toBe("2026-12-01");
  });

  it("works east of Greenwich, where local runs ahead", () => {
    expect(isoDateIn(Date.parse("2026-09-23T15:30:00Z"), "Pacific/Auckland")).toBe("2026-09-24");
  });

  it("accepts a Date as well as epoch ms", () => {
    expect(isoDateIn(new Date("2026-07-04T16:00:00Z"), CHICAGO)).toBe("2026-07-04");
  });
});

describe("addDays / daysBetween / weekdayOf", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is unaffected by DST — the spring-forward day is still one day", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2);
  });

  it("reports the weekday like Date#getDay (0 = Sunday)", () => {
    expect(weekdayOf("2026-09-20")).toBe(0);
    expect(weekdayOf("2026-09-23")).toBe(3);
  });

  it("refuses anything that is not a real calendar day", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("9/23/2026", 1)).toThrow(RangeError);
    expect(() => weekdayOf("2026-9-3")).toThrow(RangeError);
  });
});

describe("isIsoDate", () => {
  it("accepts real days and rejects everything else", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(20260923)).toBe(false);
  });
});

describe("zonedTimeToUtc", () => {
  it("puts 9am Chicago on daylight time at 14:00Z", () => {
    expect(zonedTimeToUtc("2026-09-29", "09:00", CHICAGO).toISOString()).toBe(
      "2026-09-29T14:00:00.000Z",
    );
  });

  it("puts 9am Chicago on standard time at 15:00Z", () => {
    // The hour coracle once got wrong: its pickups were 9am Eastern.
    expect(zonedTimeToUtc("2026-12-01", "09:00", CHICAGO).toISOString()).toBe(
      "2026-12-01T15:00:00.000Z",
    );
  });

  it("moves a nonexistent spring-forward time forward by the gap", () => {
    // 2026-03-08: Chicago jumps 02:00 CST → 03:00 CDT. 02:30 never happens;
    // "compatible" resolution gives 03:30 CDT = 08:30Z.
    expect(zonedTimeToUtc("2026-03-08", "02:30", CHICAGO).toISOString()).toBe(
      "2026-03-08T08:30:00.000Z",
    );
  });

  it("takes the first occurrence of a repeated fall-back time", () => {
    // 2026-11-01: 01:30 happens at 06:30Z (CDT) and again at 07:30Z (CST).
    expect(zonedTimeToUtc("2026-11-01", "01:30", CHICAGO).toISOString()).toBe(
      "2026-11-01T06:30:00.000Z",
    );
  });

  it("round-trips: the instant falls on the day it was asked for", () => {
    for (const day of ["2026-01-15", "2026-03-08", "2026-07-04", "2026-11-01"]) {
      for (const time of ["00:00", "09:00", "23:59"]) {
        expect(isoDateIn(zonedTimeToUtc(day, time, CHICAGO), CHICAGO)).toBe(day);
      }
    }
  });

  it("works for a zone with a half-hour offset", () => {
    expect(zonedTimeToUtc("2026-09-23", "09:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-09-23T03:30:00.000Z",
    );
  });

  it("refuses a malformed time", () => {
    expect(() => zonedTimeToUtc("2026-09-23", "9am", CHICAGO)).toThrow(RangeError);
    expect(() => zonedTimeToUtc("2026-09-23", "24:00", CHICAGO)).toThrow(RangeError);
  });
});

describe("formatInstant", () => {
  it("spells out the day as it was in the zone, not in UTC", () => {
    // An 8pm Independence Day sale is a July 4 receipt, not July 5.
    expect(formatInstant("2026-07-05T01:00:00Z", CHICAGO)).toBe("July 4, 2026");
  });

  it("takes a locale and Intl fields", () => {
    expect(
      formatInstant(Date.parse("2026-07-05T01:00:00Z"), CHICAGO, {
        locale: "en-GB",
        dateStyle: "medium",
      }),
    ).toBe("4 Jul 2026");
  });

  it("renders nothing for a missing or unparseable value", () => {
    expect(formatInstant(null, CHICAGO)).toBe("");
    expect(formatInstant(undefined, CHICAGO)).toBe("");
    expect(formatInstant("not a date", CHICAGO)).toBe("");
  });
});

describe("formatCalendarDate", () => {
  it("never shifts a stored day, whatever the runtime's zone", () => {
    expect(formatCalendarDate("2026-07-01")).toBe("July 1, 2026");
    expect(formatCalendarDate("2026-01-01", { locale: "en-GB" })).toBe("1 January 2026");
  });

  it("returns non-dates as they came, and nothing for null", () => {
    expect(formatCalendarDate("TBD")).toBe("TBD");
    expect(formatCalendarDate(null)).toBe("");
  });
});
