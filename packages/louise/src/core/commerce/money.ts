// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce—getting money INTO minor units without float drift.
// (Out is `centsToMajor`.) Two different jobs, deliberately two functions:
// converting a number you computed, and parsing a string someone typed.

/**
 * A major-unit amount (dollars) as minor units (cents), rounded half away from
 * zero at the minor unit.
 *
 * `Math.round(amount * 100)` is the usual version, and it is wrong for amounts
 * whose binary form sits just under the half: `1.005 * 100` is
 * `100.49999999999999`, so it rounds to 100, not 101. This shifts the decimal
 * point in the number's decimal STRING instead, which is exact for every
 * amount that has one.
 *
 * `fractionDigits` is the currency's minor-unit count—2 for USD, 0 for JPY,
 * 3 for BHD.
 */
export function majorToCents(amount: number, fractionDigits = 2): number {
  if (!Number.isFinite(amount)) throw new RangeError(`Not a finite amount: ${amount}`);
  const shifted = Number(`${Math.abs(amount)}e${fractionDigits}`);
  // Exponent notation (1e21, 1e-7) can't take the string shift; those are far
  // outside any price, so plain arithmetic is fine there.
  const exact = Number.isFinite(shifted) ? shifted : Math.abs(amount) * 10 ** fractionDigits;
  return Math.sign(amount) * Math.round(exact);
}

/**
 * Money a person typed—"12", "12.5", "12.50"—as minor units, or `null` if it
 * isn't a plain non-negative amount with at most `fractionDigits` decimals.
 *
 * Parsed as text, never through `parseFloat`, so nothing drifts. Strict on
 * purpose: no sign, no thousands separators, no currency symbol, no exponent,
 * no locale decimal comma. Strip a symbol before calling if your field shows
 * one; a form that must accept "1.234,50" needs a locale-aware parser this is
 * not. Surrounding whitespace is allowed.
 */
export function parseMoneyInput(input: string, fractionDigits = 2): number | null {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(input.trim());
  if (!m) return null;
  const fraction = m[2] ?? "";
  if (fraction.length > fractionDigits) return null;
  const minor =
    Number(m[1]) * 10 ** fractionDigits + Number(fraction.padEnd(fractionDigits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}
