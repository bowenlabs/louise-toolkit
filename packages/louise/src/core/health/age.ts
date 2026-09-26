// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// One reading of "how old is this timestamp," shared by `isStale`
// (louise-toolkit/health) and `ageCheck` (louise-toolkit/editor), so the Health
// panel and the public status route can't disagree about whether a job's last success is too old (#557).
// Internal: not on any subpath, so it isn't part of the public API.

/**
 * How many milliseconds before `now` a timestamp is, or `undefined` when it's
 * missing or doesn't name a valid date. A string or a number reads the way
 * `new Date(value)` reads it, so a number outside the `Date` range is
 * unreadable rather than a time in the far past or future. A timestamp in the
 * future (clock skew) is age 0, never negative.
 */
export function timestampAge(
  timestamp: string | number | Date | null | undefined,
  now: number,
): number | undefined {
  let then: number;
  if (timestamp instanceof Date) then = timestamp.getTime();
  else if (typeof timestamp === "string" || typeof timestamp === "number") {
    then = new Date(timestamp).getTime();
  } else return undefined;
  if (!Number.isFinite(then)) return undefined;
  return Math.max(0, now - then);
}
