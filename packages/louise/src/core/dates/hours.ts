// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/dates—opening hours and pickup times on a shop's clock.
//
// A shop's hours live as text an editor writes, one row per weekday
// ("Monday" and "7a—7p", "Sunday" and "Closed"). These functions read that
// text and answer on the shop's clock, never the customer's device or the
// Worker's UTC: is the shop open, when does it next open, which pickup times to
// offer, and whether to refuse one. A page and its server call the same
// functions, so the times a page offers are the times the server accepts.
//
// Every number in here is the shop's policy, so every one is a parameter: the
// time zone, the slot step, how far ahead to offer, the lead time, and the
// grace past closing. So is what an unreadable row means.

import type { JsonLdDay, JsonLdOpeningHours } from "../seo/json-ld.js";
import { wallMinutes } from "./clock.js";
import {
  addDays,
  formatInstant,
  type IsoDate,
  todayIn,
  weekdayOf,
  zonedTimeToUtc,
} from "./index.js";

/**
 * One weekday's hours, as an editor wrote them. `day` is an English weekday
 * name or its first three letters, in any case (`"Monday"`, `"mon"`), or a
 * number from 0 for Sunday to 6 for Saturday, like `Date#getDay`.
 */
export interface OpeningHoursRow {
  day: string | number;
  hours: string;
}

/** A day's opening, in minutes after local midnight: 7 AM to 7 PM is `{ open: 420, close: 1140 }`. */
export interface OpeningRange {
  open: number;
  /** Up to 1440, for a shop that closes at midnight. */
  close: number;
}

const DAY_NAMES: readonly JsonLdDay[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MINUTE_MS = 60_000;
const MIDNIGHT = 24 * 60;

/** One clock time in minutes after midnight, or null. `midnight` is 0 as an opening and 1440 as a close. */
function parseTime(token: string, role: "open" | "close"): number | null {
  const t = token.trim().toLowerCase().replace(/\./g, "");
  if (t === "noon") return 12 * 60;
  if (t === "midnight") return role === "open" ? 0 : MIDNIGHT;
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m?$/.exec(t);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return ((hour % 12) + (twelve[3] === "p" ? 12 : 0)) * 60 + minute;
  }
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null;
    return hour * 60 + minute;
  }
  return null;
}

/**
 * One row's hours text as minutes after local midnight, `"closed"`, or `null`
 * when it can't be read.
 *
 * It reads a range split on an em dash, an en dash, a hyphen, or "to", with
 * each end in any of these spellings, with or without periods in the AM or PM:
 * `7a`, `7 AM`, `7:30 PM`, `19:30`, `noon`, and `midnight`. "Closed" in any
 * case is `"closed"`.
 *
 * An overnight range such as `8p—2a` is `null`, as is one that closes before
 * it opens. So is anything else, such as "By appointment". What `null` means is
 * the caller's decision: {@link openingState} reports it as `unknown`, and the
 * pickup functions take a `whenUnknown` policy.
 */
export function parseOpeningHours(text: string): OpeningRange | "closed" | null {
  const t = text.trim();
  if (/^closed$/i.test(t)) return "closed";
  const parts = t.split(/\s*(?:—|–|-|\bto\b)\s*/i);
  if (parts.length !== 2) return null;
  const open = parseTime(parts[0] ?? "", "open");
  const close = parseTime(parts[1] ?? "", "close");
  if (open === null || close === null || close <= open) return null;
  return { open, close };
}

function dayIndex(day: string | number): number {
  if (typeof day === "number") return Number.isInteger(day) && day >= 0 && day <= 6 ? day : -1;
  const name = day.trim().toLowerCase();
  if (name.length < 3) return -1;
  return DAY_NAMES.findIndex(
    (d) => d.toLowerCase().startsWith(name) && (name.length === 3 || d.toLowerCase() === name),
  );
}

/** The first row for `weekday`, parsed, or null when there's none or it can't be read. */
function rangeOn(
  rows: readonly OpeningHoursRow[],
  weekday: number,
): OpeningRange | "closed" | null {
  const row = rows.find((r) => dayIndex(r.day) === weekday);
  return row ? parseOpeningHours(row.hours) : null;
}

/** The instant `minutes` after midnight on `iso`, on the shop's clock. */
function instantAt(iso: IsoDate, minutes: number, timeZone: string): Date {
  const day = minutes >= MIDNIGHT ? addDays(iso, 1) : iso;
  const m = minutes % MIDNIGHT;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return zonedTimeToUtc(day, hhmm, timeZone);
}

/** Where a shop stands at one instant, from {@link openingState}. */
export type OpeningState =
  /** Open now, until `closesAt`. */
  | { kind: "open"; closesAt: Date }
  /** Closed now. `opensAt` is the next opening in the coming week, or null when the rows name none. */
  | { kind: "closed"; opensAt: Date | null }
  /** Today's row is missing or can't be read. */
  | { kind: "unknown" };

/** Options for {@link openingState}. */
export interface OpeningStateOptions {
  /** The shop's IANA time zone, for example, `"America/Chicago"`. A site fact, so no default. */
  timeZone: string;
  /** The instant to answer for. Defaults to the current time. */
  now?: Date | number;
}

/**
 * Whether the shop is open at `now`, on its own clock.
 *
 * `open` carries the closing instant. `closed` carries the next opening within
 * the coming week, skipping any day whose row is missing or can't be read, or
 * `null` when there's none. `unknown` means today's row is missing or can't
 * be read, so the rows can't say.
 *
 * Both instants come from `zonedTimeToUtc`, so they're right on a daylight
 * saving change day.
 */
export function openingState(
  rows: readonly OpeningHoursRow[],
  options: OpeningStateOptions,
): OpeningState {
  const { timeZone, now = Date.now() } = options;
  const t = typeof now === "number" ? now : now.getTime();
  const today = todayIn(timeZone, t);
  const weekday = weekdayOf(today);
  const range = rangeOn(rows, weekday);
  if (range === null) return { kind: "unknown" };
  const minutes = wallMinutes(t, timeZone);
  if (range !== "closed" && minutes >= range.open && minutes < range.close) {
    return { kind: "open", closesAt: instantAt(today, range.close, timeZone) };
  }
  if (range !== "closed" && minutes < range.open) {
    return { kind: "closed", opensAt: instantAt(today, range.open, timeZone) };
  }
  for (let ahead = 1; ahead <= 7; ahead++) {
    const next = rangeOn(rows, (weekday + ahead) % 7);
    if (next && next !== "closed") {
      return { kind: "closed", opensAt: instantAt(addDays(today, ahead), next.open, timeZone) };
    }
  }
  return { kind: "closed", opensAt: null };
}

/** Options for {@link pickupSlots} and {@link pickupProblem}. Every one is the shop's policy. */
export interface PickupOptions {
  /** The shop's IANA time zone, for example, `"America/Chicago"`. */
  timeZone: string;
  /** How long an order takes to make, in minutes. The ASAP slot is ready this long from now. */
  prepMinutes: number;
  /** The earliest timed slot is at least this many minutes out, or `prepMinutes` if that's longer. */
  minLeadMinutes: number;
  /** Minutes between timed slots, aligned to the shop's clock: 15 gives :00, :15, :30, :45. */
  stepMinutes: number;
  /** How far ahead a pickup can be, in minutes from now. */
  horizonMinutes: number;
  /** The most timed slots to list, after the ASAP slot. */
  maxSlots: number;
  /** Minutes past closing that {@link pickupProblem} still accepts, for a slot chosen at the edge. */
  closeGraceMinutes: number;
  /** BCP 47 locale for a timed slot's label, for example, `"en-US"`. */
  locale: string;
  /**
   * What today's hours mean when its row is missing or can't be read.
   * `"open"` fails open, so a typo in the hours can't stop every sale, with no
   * closing time to bound the slots. `"closed"` offers and accepts nothing.
   */
  whenUnknown: "open" | "closed";
  /** The instant to answer for. Defaults to the current time. */
  now?: Date | number;
}

/** A pickup time to offer, from {@link pickupSlots}. */
export type PickupSlot =
  /** As soon as the order is made: `prepMinutes` from now. The site words its label. */
  | { kind: "asap"; readyAt: Date }
  /** A set time, with its label in `locale` on the shop's clock, such as "6:45 PM". */
  | { kind: "timed"; readyAt: Date; label: string };

/** Now as ms, and whether the shop takes pickups, with the close (or null for no close). */
function pickupWindow(
  rows: readonly OpeningHoursRow[],
  options: PickupOptions,
): { now: number; closesAt: number | null } | null {
  const { timeZone, whenUnknown, now = Date.now() } = options;
  const t = typeof now === "number" ? now : now.getTime();
  const state = openingState(rows, { timeZone, now: t });
  if (state.kind === "closed") return null;
  if (state.kind === "unknown") return whenUnknown === "open" ? { now: t, closesAt: null } : null;
  return { now: t, closesAt: state.closesAt.getTime() };
}

/**
 * The pickup times to offer now: an ASAP slot, then up to `maxSlots` timed
 * slots on the shop's clock.
 *
 * Timed slots start `minLeadMinutes` out (or `prepMinutes`, if longer),
 * rounded up to the next `stepMinutes` mark on the shop's wall clock, and stop
 * at closing time or `horizonMinutes` from now, whichever comes first. A slot
 * exactly at closing time is offered.
 *
 * The list is empty when the shop is closed, when an order started now can't
 * be ready before closing, or when today's hours can't be read and
 * `whenUnknown` is `"closed"`. The slots don't reach into tomorrow: a shop
 * closed now takes no pickups.
 */
export function pickupSlots(
  rows: readonly OpeningHoursRow[],
  options: PickupOptions,
): PickupSlot[] {
  const { timeZone, prepMinutes, minLeadMinutes, stepMinutes, horizonMinutes, maxSlots, locale } =
    options;
  if (!(stepMinutes > 0)) throw new RangeError(`stepMinutes must be positive, got ${stepMinutes}`);
  const window = pickupWindow(rows, options);
  if (!window) return [];
  const { now, closesAt } = window;
  const asap = now + prepMinutes * MINUTE_MS;
  if (closesAt !== null && asap > closesAt) return [];

  const slots: PickupSlot[] = [{ kind: "asap", readyAt: new Date(asap) }];
  const earliest =
    Math.ceil((now + Math.max(minLeadMinutes, prepMinutes) * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const offMark = wallMinutes(earliest, timeZone) % stepMinutes;
  const first = earliest + ((stepMinutes - offMark) % stepMinutes) * MINUTE_MS;
  const last = Math.min(closesAt ?? Number.POSITIVE_INFINITY, now + horizonMinutes * MINUTE_MS);
  for (let i = 0; i < maxSlots; i++) {
    const at = first + i * stepMinutes * MINUTE_MS;
    if (at > last) break;
    slots.push({
      kind: "timed",
      readyAt: new Date(at),
      label: formatInstant(at, timeZone, { locale, hour: "numeric", minute: "2-digit" }),
    });
  }
  return slots;
}

/**
 * Why the server should refuse a pickup at `readyAt`, or `null` to accept it:
 *
 * - `"closed"`: the shop is closed now, or today's hours can't be read and
 *   `whenUnknown` is `"closed"`. {@link pickupSlots} offers nothing then, so
 *   the server accepts nothing.
 * - `"after-close"`: `readyAt` is more than `closeGraceMinutes` past today's
 *   closing time.
 * - `"too-far"`: `readyAt` is more than `horizonMinutes` from now.
 *
 * A code rather than a message, so a site words it and a native client can
 * localize it.
 */
export function pickupProblem(
  rows: readonly OpeningHoursRow[],
  readyAt: Date | number,
  options: PickupOptions,
): "closed" | "after-close" | "too-far" | null {
  const window = pickupWindow(rows, options);
  if (!window) return "closed";
  const at = typeof readyAt === "number" ? readyAt : readyAt.getTime();
  if (window.closesAt !== null && at > window.closesAt + options.closeGraceMinutes * MINUTE_MS) {
    return "after-close";
  }
  if (at > window.now + options.horizonMinutes * MINUTE_MS) return "too-far";
  return null;
}

function hhmm(minutes: number): string {
  // schema.org has no 24:00, and Google reads a midnight close as 23:59.
  const m = Math.min(minutes, MIDNIGHT - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The rows as structured-data opening hours, for `localBusinessJsonLd` in
 * `louise-toolkit/seo`: days with the same hours share one entry, Monday first.
 * A closed day, or one whose row can't be read, is left out. A midnight close
 * is `"23:59"`, the form search engines read.
 *
 * It parses with {@link parseOpeningHours}, so the hours a page shows and the
 * hours in its structured data can't disagree.
 */
export function openingHoursJsonLd(rows: readonly OpeningHoursRow[]): JsonLdOpeningHours[] {
  const runs: { days: JsonLdDay[]; opens: string; closes: string }[] = [];
  for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
    const range = rangeOn(rows, weekday);
    if (!range || range === "closed") continue;
    const opens = hhmm(range.open);
    const closes = hhmm(range.close);
    const run = runs.find((r) => r.opens === opens && r.closes === closes);
    const day = DAY_NAMES[weekday] as JsonLdDay;
    if (run) run.days.push(day);
    else runs.push({ days: [day], opens, closes });
  }
  return runs;
}
