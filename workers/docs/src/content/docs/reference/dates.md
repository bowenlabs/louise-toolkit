---
title: dates
description: "louise-toolkit/dates—calendar days in a business's own time zone, for code that runs in a UTC Worker."
sidebar:
  order: 15.75
---

```ts
import { todayIn, addDays, zonedTimeToUtc, formatInstant } from "louise-toolkit/dates";
```

A Worker runs in UTC, and so does `new Date().toISOString().slice(0, 10)`. For a
shop in US-Central, that "today" is already tomorrow from about 7 PM. Follow-ups go
overdue a day early, an evening sale is recorded on the next day's date, and a
date picker refuses the real today. This module answers date questions on the
**business's** clock instead.

The time zone is always a parameter—an IANA name such as `"America/Chicago"`. It
is a fact about the business, so read it from config. Don't guess it from the
Worker's clock or the visitor's browser. The module has no dependencies and uses
only `Intl`, so it behaves the same on workerd, Node, and in a browser.

## Two kinds of value

|                  | Example                    | What it means                                                |
| ---------------- | -------------------------- | ------------------------------------------------------------ |
| **Instant**      | `Date`, epoch ms           | A moment. The day it falls on depends on the zone.           |
| **Calendar day** | `"2026-07-04"` (`IsoDate`) | A day. Arithmetic and formatting on it never consult a zone. |

Every function that takes an instant also takes the zone. Every function that
takes a calendar day takes no zone, so nothing can shift it by one.

## Instants to days

|                                  |                                                    |
| -------------------------------- | -------------------------------------------------- |
| `todayIn(timeZone, now?)`        | → today in the zone, as `YYYY-MM-DD`               |
| `isoDateIn(when, timeZone)`      | → the day an instant falls on in the zone          |
| `formatInstant(when, tz, opts?)` | → "July 4, 2026", in the zone—for receipts, emails |

`formatInstant` returns an empty string for `null`, `undefined`, or an
unparseable value, so a template can render it without a guard. Pass `locale` and
any `Intl.DateTimeFormat` fields to change the format.

## Day arithmetic

|                           |                                                |
| ------------------------- | ---------------------------------------------- |
| `addDays(day, n)`         | → the day `n` days later (negative to go back) |
| `daysBetween(from, to)`   | → whole days, positive when `to` is later      |
| `weekdayOf(day)`          | → 0 (Sunday) through 6, like `Date#getDay`     |
| `isIsoDate(value)`        | → whether `value` is a real `YYYY-MM-DD` day   |
| `formatCalendarDate(day)` | → "July 1, 2026", with no zone involved        |

These throw a `RangeError` on anything that isn't a real calendar day—`2026-02-30`
included—rather than doing arithmetic on garbage. DST can't make a day 23 or 25
hours long here, because nothing here counts hours.

A "due in 7 days" date, the usual source of the bug, becomes:

```ts
const eta = addDays(todayIn(SHOP_TZ), 7);
```

not `new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)`, which is
wrong in two ways at once.

## Days to instants

`zonedTimeToUtc(day, "HH:MM", timeZone)` → the instant the wall clock in that
zone reads that time on that day. Use it for "9 AM Tulsa time next Tuesday"—a
scheduled pickup, a booking slot, a publish time.

```ts
const today = todayIn(SHOP_TZ);
const ahead = (2 - weekdayOf(today) + 7) % 7; // next Tuesday, or today
const pickupAt = zonedTimeToUtc(addDays(today, ahead), "09:00", SHOP_TZ);
```

The two DST edge cases resolve as `Temporal`'s "compatible" mode does. A time
that doesn't exist (2:30 AM on the spring-forward day) moves forward by the gap,
to 3:30 AM. A time that happens twice (1:30 AM on the fall-back day) is the first
occurrence, still on daylight time.

## Opening hours and pickup times

A shop's hours usually live as text an editor writes, one row per weekday. These
functions read that text and answer on the shop's clock. A page and its server
call the same ones, so the pickup times a page offers are the times the server
accepts.

```ts
import {
  openingHoursJsonLd,
  openingState,
  pickupProblem,
  pickupSlots,
  type PickupOptions,
} from "louise-toolkit/dates";

const rows = [
  { day: "Monday", hours: "7a — 7p" },
  { day: "Sunday", hours: "Closed" },
];

// The shop's policy, from its settings: no toolkit default.
const pickup: PickupOptions = {
  timeZone: SHOP_TZ,
  prepMinutes: 10,
  minLeadMinutes: 20,
  stepMinutes: 15,
  horizonMinutes: 120,
  maxSlots: 6,
  closeGraceMinutes: 2,
  locale: SITE_LOCALE,
  whenUnknown: "open",
};

openingState(rows, { timeZone: SHOP_TZ }); // { kind: "open", closesAt } …
pickupSlots(rows, pickup); // [{ kind: "asap", readyAt }, { kind: "timed", readyAt, label: "6:30 PM" }, …]
pickupProblem(rows, readyAt, pickup); // null, or "closed" | "after-close" | "too-far"
```

|                                      |                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `parseOpeningHours(text)`            | → `{ open, close }` in minutes after midnight, `"closed"`, or `null`            |
| `openingState(rows, { timeZone })`   | → `open` with `closesAt`, `closed` with the next `opensAt`, or `unknown`        |
| `pickupSlots(rows, options)`         | → an ASAP slot, then timed slots on the shop's clock, each with a UTC `readyAt` |
| `pickupProblem(rows, readyAt, opts)` | → why to refuse a pickup, as a code, or `null`                                  |
| `openingHoursJsonLd(rows)`           | → `openingHours` for `localBusinessJsonLd`, from the same parser                |

**What it reads.** A row's `day` is an English weekday name, its first three
letters, or a number from 0 (Sunday) to 6. The hours are a range split on an em
dash, an en dash, a hyphen, or "to", with ends such as `7a`, `7 AM`,
`7:30 p.m.`, `19:30`, `noon`, and `midnight`. "Closed" closes the day.

**What it doesn't.** An overnight range such as `8p — 2a` is `null`, like any
text it can't read. `openingState` reports a `null` day as `unknown`, and the
pickup functions follow `whenUnknown`. Pass `"open"` so a typo in the hours can't
stop every sale, or `"closed"` to take no pickups until the hours read cleanly.

**Pickup slots.** Timed slots start `minLeadMinutes` out, or `prepMinutes` if
that's longer. They land on the next `stepMinutes` mark of the shop's wall clock
and stop at closing or `horizonMinutes`, whichever is sooner. A shop that's
closed now, or that can't finish an order before closing, offers none. A timed
slot's label is the time in `locale`. The ASAP slot has none, so the site words
it. `pickupProblem` returns a code, not a message, for the same reason.
