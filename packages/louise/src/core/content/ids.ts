// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Branded row IDs for the versioned Local API (#535). A page ID and a version ID
// are both plain integers in D1, so without a brand the compiler accepts one
// where the other belongs, and `publish(context, id)` quietly publishes whichever
// version happens to share the page's number. The brand exists only in the type
// system: at runtime a `PageId` is the same `number` it always was.

import { LouiseContentError } from "../errors.js";

declare const pageIdBrand: unique symbol;
declare const versionIdBrand: unique symbol;

/**
 * The ID of a row in a versioned collection's main table: a page, in most sites.
 *
 * A `PageId` goes anywhere a `number` does, but a plain `number` or a
 * {@link VersionId} doesn't go where a `PageId` belongs. Make one with
 * {@link toPageId} (a number you trust) or {@link parsePageId} (input you
 * don't, such as a route parameter or a tool argument).
 */
export type PageId = number & { readonly [pageIdBrand]: true };

/**
 * The ID of a row in a versioned collection's `${slug}_versions` table: one
 * saved draft or published snapshot.
 *
 * Make one with {@link toVersionId} or {@link parseVersionId}. A version row's
 * `id` comes back from `findVersions` as a plain `number`, so wrap it before you
 * pass it to `publish`, `discardVersion`, or `diffVersions`.
 */
export type VersionId = number & { readonly [versionIdBrand]: true };

const DECIMAL_ID = /^[1-9]\d*$/;

/** A row ID is a positive, safe integer: SQLite's rowids start at 1. */
function isRowId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseRowId(value: unknown): number | undefined {
  if (isRowId(value)) return value;
  if (typeof value === "string" && DECIMAL_ID.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Brand a number you already trust as a {@link PageId}, such as a row's `id`
 * from a query. Throws `LouiseContentError` when `value` isn't a positive
 * integer, so a bad ID fails where it enters rather than as a missing row later.
 */
export function toPageId(value: number): PageId {
  if (!isRowId(value)) {
    throw new LouiseContentError(`Invalid page ID ${String(value)}: expected a positive integer`);
  }
  return value as PageId;
}

/**
 * Brand a number you already trust as a {@link VersionId}, such as a version
 * row's `id` from `findVersions`. Throws `LouiseContentError` when `value`
 * isn't a positive integer.
 */
export function toVersionId(value: number): VersionId {
  if (!isRowId(value)) {
    throw new LouiseContentError(
      `Invalid version ID ${String(value)}: expected a positive integer`,
    );
  }
  return value as VersionId;
}

/**
 * Parse untrusted input into a {@link PageId}: a route parameter, a request
 * body field, or an agent's tool argument. Accepts a positive integer or its
 * decimal string (`7` or `"7"`, not `"07"`, `"7.0"`, or `" 7"`), and returns
 * `undefined` for anything else, so the caller picks the error response.
 */
export function parsePageId(value: unknown): PageId | undefined {
  return parseRowId(value) as PageId | undefined;
}

/**
 * Parse untrusted input into a {@link VersionId}, with the same rules as
 * {@link parsePageId}.
 */
export function parseVersionId(value: unknown): VersionId | undefined {
  return parseRowId(value) as VersionId | undefined;
}
