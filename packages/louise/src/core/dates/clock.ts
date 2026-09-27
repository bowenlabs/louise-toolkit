// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/dates—reading a wall clock in a time zone. Internal: the
// public functions in `index.ts` and `hours.ts` share it, so there's one
// definition of "the shop's clock".

function wallParts(t: number, timeZone: string) {
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
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Milliseconds `timeZone` is ahead of UTC at instant `t` (negative west of Greenwich). */
export function offsetAt(t: number, timeZone: string): number {
  const p = wallParts(t, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - (t - (((t % 1000) + 1000) % 1000));
}

/** Minutes after midnight on the wall clock in `timeZone` at instant `t`: 7:30 PM is 1170. */
export function wallMinutes(t: number, timeZone: string): number {
  const p = wallParts(t, timeZone);
  return p.hour * 60 + p.minute;
}
