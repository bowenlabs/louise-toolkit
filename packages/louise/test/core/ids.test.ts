import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type PageId,
  parsePageId,
  parseVersionId,
  toPageId,
  toVersionId,
  type VersionId,
} from "../../src/core/content/index.js";
import { LouiseContentError } from "../../src/core/errors.js";

describe("toPageId and toVersionId", () => {
  it("brand a positive integer without changing its value", () => {
    expect(toPageId(7)).toBe(7);
    expect(toVersionId(12)).toBe(12);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "throw LouiseContentError for %s",
    (value) => {
      expect(() => toPageId(value)).toThrow(LouiseContentError);
      expect(() => toVersionId(value)).toThrow(LouiseContentError);
    },
  );
});

describe("parsePageId and parseVersionId", () => {
  it.each([
    [7, 7],
    ["7", 7],
    ["120", 120],
  ])("accept %j", (input, expected) => {
    expect(parsePageId(input)).toBe(expected);
    expect(parseVersionId(input)).toBe(expected);
  });

  it.each([0, -1, 1.5, "0", "07", "-1", "1.5", "7.0", " 7", "7 ", "", "1e3", "9007199254740993"])(
    "reject %j",
    (input) => {
      expect(parsePageId(input)).toBeUndefined();
      expect(parseVersionId(input)).toBeUndefined();
    },
  );

  it.each([null, undefined, true, {}, [7]])("reject a non-ID value: %j", (input) => {
    expect(parsePageId(input)).toBeUndefined();
  });
});

describe("the brands", () => {
  it("keep a page ID and a version ID apart at compile time", () => {
    expectTypeOf<PageId>().toExtend<number>();
    expectTypeOf<VersionId>().toExtend<number>();
    expectTypeOf<number>().not.toExtend<PageId>();
    expectTypeOf<VersionId>().not.toExtend<PageId>();
    expectTypeOf<PageId>().not.toExtend<VersionId>();
  });
});
