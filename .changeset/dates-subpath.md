---
"louise-toolkit": patch
---

dates: new `louise-toolkit/dates` — calendar days in a business's own time zone (#454)

A Worker runs in UTC, and so does `new Date().toISOString().slice(0, 10)`: for a shop
in US-Central that "today" is tomorrow from about 7pm. Every site built on the toolkit
hit it — one fixed it with a hard-coded zone, one hand-rolled offset maths for its
pickup times (and once had them an hour off), one still has the bug in seven places.
The toolkit had no time-zone code at all.

```ts
import { todayIn, addDays, zonedTimeToUtc, formatInstant } from "louise-toolkit/dates";

todayIn("America/Chicago");                         // "2026-09-23", even at 8pm
addDays(todayIn(TZ), 7);                            // a due date, zone-free arithmetic
zonedTimeToUtc("2026-09-29", "09:00", TZ);          // 9am local, as a Date
formatInstant(sale.createdAt, TZ);                  // "July 4, 2026" on the receipt
```

Also `isoDateIn`, `daysBetween`, `weekdayOf`, `isIsoDate` and `formatCalendarDate`.
The zone is always a parameter — read it from config, never the Worker or the
browser. Calendar-day functions take no zone and throw a `RangeError` on anything
that isn't a real `YYYY-MM-DD` day. DST gaps and repeats in `zonedTimeToUtc` resolve
like `Temporal`'s "compatible" mode. No dependencies; pure `Intl`.

**If you're replacing a hand-rolled version:** `x.toISOString().slice(0, 10)` →
`isoDateIn(x, TZ)`, and "today plus N days" via `setDate` → `addDays(todayIn(TZ), N)`.
