// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce—catalog-mirror helpers shared by every provider.

export interface VanishedRowsOptions<T> {
  /** The provider's id for a stored row, or `null` for a row the provider doesn't own. */
  externalId: (row: T) => string | null;
  /**
   * Whether the row is already marked as gone. Such rows are skipped, so the
   * mark is idempotent—a product gone for a month is not re-stamped (and, if
   * marking also unpublishes, not re-unpublished) on every sync.
   */
  alreadyMarked?: (row: T) => boolean;
}

/**
 * Stored rows a completed catalog read did NOT contain: the products the
 * provider dropped. Pure, so the decision of what gets taken off a shop is
 * testable without a live catalog.
 *
 * Diffed in memory rather than as a SQL `NOT IN (…)`: SQLite (D1 included) caps
 * bound parameters, so a large enough catalog would turn that clause into an
 * error—at exactly the size where nobody can check by hand.
 *
 * What to DO with the result is policy, and the dangerous part: call this only
 * after a read you know is complete, and never act on an empty `seen`. A revoked
 * token or an endpoint answering `[]` reads as "the provider has nothing", and
 * would retire the whole shop on a schedule.
 */
export function vanishedRows<T>(
  stored: readonly T[],
  seen: ReadonlySet<string>,
  options: VanishedRowsOptions<T>,
): T[] {
  return stored.filter((row) => {
    const id = options.externalId(row);
    return id !== null && !seen.has(id) && !options.alreadyMarked?.(row);
  });
}
