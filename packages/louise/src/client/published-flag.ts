// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// A one-shot "this page just went live" flag that survives the reload after a
// publish (#597). Both publish paths end in `location.reload()`, so without it
// the owner never saw that their page went live. Session storage, keyed to the
// page, read and cleared once on the next mount. A private window with no
// storage skips the message rather than failing the publish.

// The session-storage item's name. Not `KEY`: a secret-shaped constant name
// trips Snyk Code (louise-ops PROCESS.md § Snyk).
const FLAG_ITEM = "louise:published";

/** The confirmation the edit bar shows after a publish reloads the page. */
export const PUBLISHED_MESSAGE = "Published. Your page is live.";

/** Remember, across the coming reload, that page `id` was just published. */
export function markPublished(id: number): void {
  try {
    sessionStorage.setItem(FLAG_ITEM, String(id));
  } catch {
    /* no storage: the page still publishes, without the confirmation */
  }
}

/** Whether page `id` was just published, clearing the flag either way it matches. */
export function takePublished(id: number): boolean {
  try {
    if (sessionStorage.getItem(FLAG_ITEM) !== String(id)) return false;
    sessionStorage.removeItem(FLAG_ITEM);
    return true;
  } catch {
    return false;
  }
}
