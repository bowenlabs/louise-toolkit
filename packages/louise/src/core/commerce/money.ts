// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce—money in and out of minor units without float drift.
// In is two jobs, deliberately two functions: converting a number you computed,
// and parsing a string someone typed. Out is a number (`centsToMajor`) or text
// for a person (`formatMoney`), and `parseMoney` reads that text back.
//
// A currency's minor-unit count is a fact about the currency (ISO 4217), so
// the helpers that take a `currency` read it from `Intl`. The locale is a fact
// about the site, so it's always a parameter.

import type { Money } from "./index.js";

/**
 * The number of minor-unit digits `currency` uses: 2 for USD, 0 for JPY, 3 for
 * BHD. Read from `Intl`, so it's right for every ISO 4217 code the runtime
 * knows. Throws a `RangeError` for a malformed code.
 */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;
}

/**
 * Minor units to major units: `2500` is `25`.
 *
 * `fractionDigits` is the currency's minor-unit count, as for
 * {@link majorToCents}. The default of 2 is right only for a two-decimal
 * currency such as USD. For a `Money`, pass `currencyDigits(money.currency)`,
 * or use {@link formatMoney} if the result is for a person to read.
 */
export function centsToMajor(cents: number, fractionDigits = 2): number {
  return cents / 10 ** fractionDigits;
}

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

/** Options for {@link formatMoney}: a locale plus any `Intl.NumberFormat` option. */
export interface FormatMoneyOptions extends Omit<Intl.NumberFormatOptions, "style" | "currency"> {
  /** BCP 47 locale the text is for, for example, `"en-US"`. A site fact, so no default. */
  locale: string;
}

/**
 * A `Money` as text for a person: `{ amount: 125000, currency: "USD" }` is
 * `"$1,250.00"` in `en-US`, and `{ amount: 1250, currency: "JPY" }` is
 * `"¥1,250"`. The minor-unit count comes from the currency, never an assumed 2.
 *
 * Any other `Intl.NumberFormat` option passes through. For a dashboard total
 * in whole units, pass `maximumFractionDigits: 0`. By default a price keeps
 * the currency's full minor unit (`"$12.50"`, never `"$12.5"`).
 */
export function formatMoney(money: Money, options: FormatMoneyOptions): string {
  const { locale, ...rest } = options;
  const major = centsToMajor(money.amount, currencyDigits(money.currency));
  return new Intl.NumberFormat(locale, {
    ...rest,
    style: "currency",
    currency: money.currency,
  }).format(major);
}

/** Options for {@link parseMoney}. Both are site facts, so neither has a default. */
export interface ParseMoneyOptions {
  /** BCP 47 locale the text was typed in. It decides which of `.` and `,` is the decimal point. */
  locale: string;
  /** ISO 4217 code, for example, `"USD"`. It decides the symbol and the minor-unit count. */
  currency: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Money a person typed the way {@link formatMoney} displays it, as minor units,
 * or `null`. What one prints, the other reads: in `en-US` with USD,
 * `"$1,200.50"`, `"1,200.50"`, and `"1200.5"` are all `120050`, and in `de-DE`
 * with EUR, `"1.200,50 €"` is too.
 *
 * It removes the currency's symbol and code and any whitespace, checks that
 * group separators sit where the locale puts them, turns the locale's decimal
 * separator into a point, and hands the rest to {@link parseMoneyInput} with
 * the currency's minor-unit count. So it's forgiving about format and still
 * strict about the amount: no sign, no exponent, no more decimals than the
 * currency has. `"12.5"` in `de-DE` is `null`, not 125 euros, because `.`
 * there groups thousands and a group holds three digits.
 */
export function parseMoney(input: string, options: ParseMoneyOptions): number | null {
  const { locale, currency } = options;
  const parts = (display: "symbol" | "narrowSymbol") =>
    new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: display })
      // Seven integer digits, so every grouping level shows (en-IN groups 12,34,567).
      .formatToParts(1234567.5);
  const sample = parts("symbol");
  const group = sample.find((p) => p.type === "group")?.value;
  const decimal = sample.find((p) => p.type === "decimal")?.value ?? ".";
  const sizes = sample.filter((p) => p.type === "integer").map((p) => p.value.length);
  const primary = sizes.at(-1) ?? 3;
  const secondary = sizes.length > 2 ? (sizes.at(-2) ?? primary) : primary;

  const symbols = new Set([
    currency,
    ...[sample, parts("narrowSymbol")].flatMap((ps) =>
      ps.filter((p) => p.type === "currency").map((p) => p.value),
    ),
  ]);
  let text = input;
  // Longest first, so "US$" goes before "$" can leave a stray "US".
  for (const symbol of [...symbols].sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(escapeRegExp(symbol), "gi"), "");
  }
  text = text.replace(/\s/g, "");

  const [integer = "", ...fraction] = text.split(decimal);
  if (fraction.length > 1) return null;
  let digits = integer;
  // A group separator that is itself whitespace (fr-FR's narrow no-break space)
  // is already gone; a visible one must sit where the locale puts it.
  if (group && !/\s/.test(group) && integer.includes(group)) {
    const groups = integer.split(group);
    const [first = "", ...rest] = groups;
    const last = rest.at(-1) ?? "";
    const middle = rest.slice(0, -1);
    if (first.length < 1 || first.length > secondary) return null;
    if (last.length !== primary || middle.some((g) => g.length !== secondary)) return null;
    digits = groups.join("");
  }
  return parseMoneyInput(
    fraction.length ? `${digits}.${fraction[0]}` : digits,
    currencyDigits(currency),
  );
}
