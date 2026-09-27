// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce—tip math. A checkout that offers preset percentages
// or a custom amount runs the same math twice: on the client to show the
// choices, and on the server to re-check the cap before it charges. These are
// the one copy both sides call. The presets and the cap are the shop's policy,
// so every one of them is a parameter.
//
// Every amount is an integer in the currency's minor unit (cents), and so is
// every result.

/** The cap on a tip, from {@link tipCap}'s options. Both bounds are shop policy. */
export interface TipCapOptions {
  /** The cap never falls below this, however small the order: a $3 coffee can still take a $5 tip. */
  floorCents: number;
  /** The cap never rises above this, however large the order. */
  ceilingCents: number;
  /**
   * The cap as a percentage of the subtotal, before the floor and ceiling
   * apply. Defaults to 100: a tip up to the order's own size.
   */
  subtotalPercent?: number;
}

function assertCents(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative whole number of cents, got ${value}`);
  }
}

// A percentage as an exact integer in millionths of a percent, read from the
// number's decimal string: 12.3 is 12300000, with no binary drift from `12.3 * x`.
const PERCENT_SCALE = 1_000_000;
function scaledPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) {
    throw new RangeError(`A tip percentage must be a finite, non-negative number, got ${percent}`);
  }
  const scaled = Number(`${percent}e6`);
  return Math.round(Number.isFinite(scaled) ? scaled : percent * PERCENT_SCALE);
}

/**
 * `percent` of `subtotalCents`, in cents, rounded half away from zero at the
 * cent: 15 percent of 1,005 cents is 151, not 150.
 *
 * Computed in integers, so a fractional percentage such as 12.5 or 17.3 is
 * exact up to six decimals. Throws a `RangeError` for a negative or fractional
 * subtotal, or a negative percentage.
 */
export function percentTip(subtotalCents: number, percent: number): number {
  assertCents("subtotalCents", subtotalCents);
  const numerator = subtotalCents * scaledPercent(percent);
  const denominator = 100 * PERCENT_SCALE;
  if (!Number.isSafeInteger(numerator)) return Math.round((subtotalCents * percent) / 100);
  const whole = Math.floor(numerator / denominator);
  return numerator - whole * denominator >= denominator / 2 ? whole + 1 : whole;
}

/**
 * The largest tip a shop accepts on `subtotalCents`: `subtotalPercent` of the
 * subtotal (100 by default), raised to `floorCents` and lowered to
 * `ceilingCents`. With a floor of 2,000 and a ceiling of 10,000, a 900-cent
 * order caps at 2,000, a 4,500-cent order at 4,500, and a 25,000-cent order at
 * 10,000.
 *
 * Take the subtotal from the payment provider's calculated order, on the
 * client and the server both. Two sides that each add up their own subtotal
 * disagree near the cap, and then a tip the page offered is one the server
 * refuses. With Square, that's `orderSubtotal` from
 * `louise-toolkit/commerce/square`.
 *
 * Throws a `RangeError` when a bound isn't whole cents or the floor is above
 * the ceiling.
 */
export function tipCap(subtotalCents: number, options: TipCapOptions): number {
  const { floorCents, ceilingCents, subtotalPercent = 100 } = options;
  assertCents("floorCents", floorCents);
  assertCents("ceilingCents", ceilingCents);
  if (floorCents > ceilingCents) {
    throw new RangeError(`floorCents (${floorCents}) is above ceilingCents (${ceilingCents})`);
  }
  return Math.min(ceilingCents, Math.max(floorCents, percentTip(subtotalCents, subtotalPercent)));
}

/**
 * A tip from a request body as whole cents, or 0.
 *
 * A non-negative number is rounded to the nearest cent, so a page that sends
 * `150.75` from unrounded percentage math charges 151, not nothing. A string
 * of digits alone (`"150"`, surrounding whitespace allowed) reads the same
 * way, for a form-encoded body. Everything else is 0: a negative number,
 * `NaN`, `Infinity`, `"1.50"`, `"$2"`, `null`, and a missing field. A tip the
 * server can't read charges nothing, rather than a guess at what the customer
 * meant. To read a tip a person typed in dollars, use `parseMoneyInput`
 * instead.
 */
export function parseTipCents(value: unknown): number {
  const cents =
    typeof value === "number"
      ? Math.round(value)
      : typeof value === "string" && /^\s*\d+\s*$/.test(value)
        ? Number(value)
        : Number.NaN;
  // `> 0`, not `>= 0`: `Math.round(-0.4)` is -0, which should read as a plain 0.
  return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
}

/**
 * `tipCents` limited to {@link tipCap} on `subtotalCents`: what the server
 * charges. A tip under the cap passes through unchanged. Run a tip from a
 * request through {@link parseTipCents} first, which turns anything that isn't
 * whole cents into 0.
 *
 * To refuse an over-cap tip rather than lower it, compare against
 * {@link tipCap} yourself: whether to charge less than the customer chose, or
 * ask them again, is the shop's call.
 */
export function clampTip(tipCents: number, subtotalCents: number, cap: TipCapOptions): number {
  assertCents("tipCents", tipCents);
  return Math.min(tipCents, tipCap(subtotalCents, cap));
}
