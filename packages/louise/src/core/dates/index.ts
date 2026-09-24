// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/dates — calendar dates in a business's own time zone.
//
// A Worker runs in UTC, and so does `new Date().toISOString().slice(0, 10)`.
// For a shop in US-Central that "today" is already tomorrow from about 7pm:
// follow-ups go overdue a day early, an evening sale is recorded on the next
// day's date, a date picker refuses the real today. Every site built on this
// toolkit hit it, and each fixed it (or didn't) on its own.
//
// Two kinds of value, kept apart on purpose:
//
//   - an INSTANT (`Date`, epoch ms) — a moment. Which calendar day it falls on
//     depends on the zone, so every function taking one also takes the zone.
//   - a CALENDAR DAY (`YYYY-MM-DD`) — a day, not a moment. Arithmetic and
//     formatting on it never consult a zone, so nothing can shift it by one.
//
// The zone is always a parameter (an IANA name, e.g. "America/Chicago"). It is
// a fact about the business, not the device or the request, so it should come
// from config — never guessed from the Worker's clock or a browser's locale.
// Pure `Intl` throughout: no dependencies, and it runs the same on workerd,
// Node and in a browser.

/** A calendar day as `YYYY-MM-DD`. A plain string, documented by name. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Split and validate a calendar day. Throws on anything that is not a real
 *  `YYYY-MM-DD` date — "2026-02-30" included — so arithmetic can't run on garbage. */
function parseIsoDate(iso: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(iso);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(year, month - 1, day));
    if (t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day) {
      return { year, month, day };
    }
  }
  throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${JSON.stringify(iso)}`);
}

/** True when `value` is a real calendar day in `YYYY-MM-DD` form. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

// ── Instants → calendar days ─────────────────────────────────────────────────

/**
 * The calendar day an instant falls on in `timeZone`, as `YYYY-MM-DD`.
 * The `en-CA` locale is the one whose numeric short date IS ISO order.
 */
export function isoDateIn(when: Date | number, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

/** Today in `timeZone`, as `YYYY-MM-DD`. `now` is injectable for tests. */
export function todayIn(timeZone: string, now: Date | number = Date.now()): IsoDate {
  return isoDateIn(now, timeZone);
}

// ── Calendar-day arithmetic (zone-free) ──────────────────────────────────────

/** `iso` plus `days` (negative to go back). Crosses months, years and leap days;
 *  never consults a zone, so DST cannot make a day 23 or 25 hours long here. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` — positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** Day of the week of a calendar day: 0 = Sunday … 6 = Saturday, like `Date#getDay`. */
export function weekdayOf(iso: IsoDate): number {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// ── Calendar day + wall-clock time → instant ─────────────────────────────────

/** Milliseconds `timeZone` is ahead of UTC at instant `t` (negative west of Greenwich). */
function offsetAt(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(t);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - (t - (((t % 1000) + 1000) % 1000));
}

/**
 * The instant at which the wall clock in `timeZone` reads `time` on `iso` —
 * "9am Tulsa time next Tuesday" as a `Date`, for a scheduled pickup or a
 * booking slot. `time` is `HH:MM` (24-hour).
 *
 * The two DST edge cases resolve the way `Temporal`'s "compatible" mode does:
 *
 *   - a time that does not exist (2:30am on the spring-forward day) moves
 *     forward by the gap — 3:30am;
 *   - a time that happens twice (1:30am on the fall-back day) is the FIRST
 *     occurrence, the one still on daylight time.
 */
export function zonedTimeToUtc(iso: IsoDate, time: string, timeZone: string): Date {
  const { year, month, day } = parseIsoDate(iso);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(time);
  const hour = Number(hm?.[1]);
  const minute = Number(hm?.[2]);
  if (!hm || hour > 23 || minute > 59) {
    throw new RangeError(`Not a wall-clock time (HH:MM): ${JSON.stringify(time)}`);
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  // Offsets a day either side are clear of any transition near `wall`, so the
  // answer is one of the two candidates they imply — or neither, in a gap.
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const valid = [wall - before, wall - after].filter((t) => t + offsetAt(t, timeZone) === wall);
  if (valid.length) return new Date(Math.min(...valid));
  // A gap: read the missing wall time on the pre-transition offset, which
  // lands the same distance past the jump.
  return new Date(wall - before);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export interface FormatDateOptions extends Omit<Intl.DateTimeFormatOptions, "timeZone"> {
  /** BCP 47 locale. Default `"en-US"`. */
  locale?: string;
}

const LONG_DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };

function formatOptions(options: FormatDateOptions): [string, Intl.DateTimeFormatOptions] {
  const { locale = "en-US", ...rest } = options;
  const hasFields = Object.values(rest).some((v) => v !== undefined);
  return [locale, hasFields ? rest : LONG_DATE];
}

/**
 * An instant as the customer lived it, in `timeZone` — "July 4, 2026" by
 * default; pass `Intl.DateTimeFormat` fields to change that. Empty string for
 * `null`/`undefined`/an unparseable value, so a template can render it blind.
 */
export function formatInstant(
  when: Date | number | string | null | undefined,
  timeZone: string,
  options: FormatDateOptions = {},
): string {
  if (when == null) return "";
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return "";
  const [locale, fields] = formatOptions(options);
  return new Intl.DateTimeFormat(locale, { ...fields, timeZone }).format(date);
}

/**
 * A stored calendar day spelled out — "July 1, 2026" by default. Takes no zone:
 * it IS a day, not a moment, so it is read at UTC noon and formatted in UTC and
 * nothing can move it. Empty string for `null`/`undefined`; anything that is
 * not a calendar date is returned as it came.
 */
export function formatCalendarDate(
  iso: IsoDate | null | undefined,
  options: FormatDateOptions = {},
): string {
  if (!iso) return "";
  if (!isIsoDate(iso)) return iso;
  const [locale, fields] = formatOptions(options);
  return new Intl.DateTimeFormat(locale, { ...fields, timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}
