// core/commerce/tip—preset percentages, the cap, and reading a tip from a
// request, with the shop's policy as parameters (#716).
import { describe, expect, it } from "vitest";
import {
  clampTip,
  parseTipCents,
  percentTip,
  tipCap,
  type TipCapOptions,
} from "../../src/core/commerce/index.js";

const CAP: TipCapOptions = { floorCents: 2000, ceilingCents: 10000 };

describe("percentTip", () => {
  it.each([
    [1000, 15, 150],
    [1005, 15, 151], // 150.75 rounds up
    [1010, 15, 152], // 151.5 rounds half away from zero
    [1003, 15, 150], // 150.45 rounds down
    [999, 10, 100], // 99.9
    [1000, 0, 0],
    [0, 20, 0],
  ])("%i cents at %d percent is %i", (subtotal, percent, tip) => {
    expect(percentTip(subtotal, percent)).toBe(tip);
  });

  it("is exact for a fractional percentage, with no binary drift", () => {
    // 12.3 * 1000 is 12300.000000000002 in floating point.
    expect(percentTip(1000, 12.3)).toBe(123);
    expect(percentTip(1000, 17.5)).toBe(175);
    // 0.5 exactly: 12.5 percent of 1,004 is 125.5.
    expect(percentTip(1004, 12.5)).toBe(126);
    // 1.15 percent of 1,000 is 11.5; 1.15 * 1000 is 1149.9999999999998.
    expect(percentTip(1000, 1.15)).toBe(12);
  });

  it("falls back to plain arithmetic past the safe-integer range", () => {
    expect(percentTip(Number.MAX_SAFE_INTEGER - 1, 50)).toBe(
      Math.round((Number.MAX_SAFE_INTEGER - 1) / 2),
    );
  });

  it.each([
    [-100, 15],
    [10.5, 15],
    [Number.NaN, 15],
    [1000, -5],
    [1000, Number.POSITIVE_INFINITY],
    [1000, Number.NaN],
  ])("throws for subtotal %d and percentage %d", (subtotal, percent) => {
    expect(() => percentTip(subtotal, percent)).toThrow(RangeError);
  });
});

describe("tipCap", () => {
  it("raises a small order's cap to the floor", () => {
    expect(tipCap(900, CAP)).toBe(2000);
    expect(tipCap(0, CAP)).toBe(2000);
  });

  it("is the subtotal between the floor and the ceiling", () => {
    expect(tipCap(2000, CAP)).toBe(2000);
    expect(tipCap(4500, CAP)).toBe(4500);
    expect(tipCap(10000, CAP)).toBe(10000);
  });

  it("lowers a large order's cap to the ceiling", () => {
    expect(tipCap(25000, CAP)).toBe(10000);
  });

  it("takes the cap as a share of the subtotal when told to", () => {
    const half = { ...CAP, subtotalPercent: 50 };
    expect(tipCap(9000, half)).toBe(4500);
    expect(tipCap(3000, half)).toBe(2000);
    expect(tipCap(30000, half)).toBe(10000);
  });

  it("is the floor when the floor and ceiling meet", () => {
    expect(tipCap(4500, { floorCents: 500, ceilingCents: 500 })).toBe(500);
  });

  it.each([
    [{ floorCents: 5000, ceilingCents: 1000 }],
    [{ floorCents: -1, ceilingCents: 1000 }],
    [{ floorCents: 0, ceilingCents: 10.5 }],
    [{ ...CAP, subtotalPercent: -10 }],
  ])("throws for %o", (options) => {
    expect(() => tipCap(1000, options)).toThrow(RangeError);
  });
});

describe("parseTipCents", () => {
  it.each([
    [150, 150],
    [0, 0],
    ["150", 150],
    [" 150 ", 150],
    ["0", 0],
    [150.4, 150],
    [150.75, 151], // unrounded percentage math from a page
    [0.4, 0],
    [-0.4, 0], // Math.round gives -0; a tip reads as a plain 0
  ])("reads %o as %i", (value, cents) => {
    expect(parseTipCents(value)).toBe(cents);
  });

  it.each([
    -150,
    -1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "-150",
    "1.50",
    "$2",
    "1e3",
    "",
    "abc",
    "9".repeat(20),
    null,
    undefined,
    true,
    {},
    [150],
  ])("reads %o as 0", (value) => {
    expect(parseTipCents(value)).toBe(0);
  });
});

describe("clampTip", () => {
  it("passes a tip under the cap through unchanged", () => {
    expect(clampTip(700, 4500, CAP)).toBe(700);
    expect(clampTip(4500, 4500, CAP)).toBe(4500);
    expect(clampTip(0, 4500, CAP)).toBe(0);
  });

  it("lowers a tip over the cap to the cap", () => {
    expect(clampTip(4501, 4500, CAP)).toBe(4500);
    expect(clampTip(3000, 900, CAP)).toBe(2000);
    expect(clampTip(50000, 25000, CAP)).toBe(10000);
  });

  it("agrees with the preset a page offered on the same subtotal", () => {
    const subtotal = 12345;
    for (const percent of [10, 15, 20]) {
      const offered = percentTip(subtotal, percent);
      expect(clampTip(offered, subtotal, CAP)).toBe(offered);
    }
  });

  it("throws for a tip that isn't whole cents", () => {
    expect(() => clampTip(-1, 4500, CAP)).toThrow(RangeError);
    expect(() => clampTip(1.5, 4500, CAP)).toThrow(RangeError);
  });
});
