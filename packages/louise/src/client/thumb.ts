// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Derivative URLs for the editor and settings chrome.
//
// Published pages render through <MediaSlot>, which is what it exists for. The
// chrome had no equivalent: every <img> in this directory pointed at the raw
// media-library URL, so a 6 MB camera original was fetched at full resolution to
// fill a 120 px thumbnail. The media picker is the worst of it — open it against
// a library of 200 assets and the browser is asked for 200 full-size masters.
// `loading="lazy"` bounds how many arrive at once; it does not make any of them
// smaller.
//
// This is edit-mode-only, so it never touched published-page metrics, which is
// most likely why it went unnoticed. It was still the slowest surface in the
// product, and slow for the people using it most.

import { cfImage } from "../core/media/transform.js";

/**
 * A CDN derivative sized for a box of `px` CSS pixels.
 *
 * Every chrome call site renders at a known display size, which is what makes
 * this cheap: the caller passes the box, not a guess. Requests 2× for retina —
 * a 120 px tile asks for 240 px, which is still ~1% of a camera master.
 *
 * **Zone dependency.** `/cdn-cgi/image/` requires Image Resizing on the zone
 * serving the asset. A site whose `MEDIA_URL` points at a plain R2 bucket domain
 * gets the original back — correct, just not smaller. Worth knowing before
 * debugging why a thumbnail is still 6 MB.
 *
 * Non-http(s) inputs (relative paths, `data:` URLs, an empty string) pass
 * through untouched — `cfImage` guards that, so no call site needs its own
 * check.
 */
export function thumb(url: string, px: number): string {
  return cfImage(url, { width: px * 2, fit: "cover", format: "auto", quality: 75 });
}
