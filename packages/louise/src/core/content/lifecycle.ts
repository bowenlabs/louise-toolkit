// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The page lifecycle (ADR 0021): the one place the rules for a page's state and
// a version's state live, so the Local API, the versions route, the edit-mode
// draft read, and the editor's history drawer can't each read the columns
// their own way. Three facts carry everything:
//
//   - the page row's `status`: visibility. `published` means a visitor sees it.
//   - the page row's `publishedVersionId`: provenance, the version whose
//     snapshot the row holds. Publish moves it; nothing clears it.
//   - the high-water mark: the highest version ID ever promoted onto the row.
//     A draft at or below it is superseded, whatever the pointer says now.

/** A page's place in its lifecycle, from its row alone (ADR 0021 §4). */
export type PageState = "new" | "live" | "hidden";

/**
 * A version's place relative to its page (ADR 0021 §3):
 *
 * - `pending`: a draft newer than anything ever promoted, and unscheduled.
 * - `scheduled`: the same, with a `scheduledAt` time.
 * - `superseded`: a draft at or below the high-water mark. A later publish
 *   moved past it, so it's never resumed or published as current work.
 * - `current`: the version whose snapshot the page row holds. Live or hidden
 *   depending on the page's {@link PageState}.
 * - `earlier`: promoted once, and not the current one.
 */
export type VersionState = "pending" | "scheduled" | "superseded" | "current" | "earlier";

/** The page row fields the lifecycle reads. */
export interface LifecyclePage {
  status?: unknown;
  publishedVersionId?: number | null;
}

/** The version row fields the lifecycle reads. */
export interface LifecycleVersion {
  id: number;
  /** The stored value: `published` records that the version was promoted at
   *  least once. It never means the version is live now. */
  status: unknown;
  scheduledAt?: unknown;
}

/** Whether a visitor can see the page. A table without a `status` column has
 *  no way to hide a row, so there a row is live once it's been published. */
export function isPageLive(page: LifecyclePage): boolean {
  if (page.status === undefined) return page.publishedVersionId != null;
  return page.status === "published";
}

/** A page's lifecycle state. A page that's never been published is `new`; one
 *  that has, and was then unpublished, is `hidden`. */
export function pageState(page: LifecyclePage): PageState {
  if (isPageLive(page)) return "live";
  return page.publishedVersionId == null ? "new" : "hidden";
}

/** The highest version ID ever promoted onto the page row, or `null` when no
 *  version of it has been published. */
export function promotedHighWater(versions: readonly LifecycleVersion[]): number | null {
  let high: number | null = null;
  for (const v of versions) {
    if (v.status === "published" && (high === null || v.id > high)) high = v.id;
  }
  return high;
}

/** A version's lifecycle state. Pass `highWater` from {@link promotedHighWater}
 *  over the same page's versions. */
export function versionState(
  version: LifecycleVersion,
  page: LifecyclePage,
  highWater: number | null,
): VersionState {
  if (page.publishedVersionId != null && version.id === page.publishedVersionId) return "current";
  if (version.status === "published") return "earlier";
  if (highWater !== null && version.id <= highWater) return "superseded";
  return version.scheduledAt == null ? "pending" : "scheduled";
}
