---
"louise-toolkit": patch
---

**The editor and settings chrome stopped loading full-size originals.**

Published pages render through `<MediaSlot>`, which is what it exists for. The
chrome had no equivalent: every `<img>` in `src/client` pointed at the raw
media-library URL, so a 6 MB camera original was fetched at full resolution to
fill a 120 px thumbnail. The media picker was the worst case — open it against a
library of 200 assets and the browser is asked for 200 full-size masters.
`loading="lazy"` bounds how many arrive at once; it doesn't make any of them
smaller.

Edit-mode-only, so it never touched published-page metrics — most likely why it
went unnoticed. It was still the slowest surface in the product, and slow for the
people using it most.

A new internal `thumb(url, px)` wraps `cfImage` at 2× the display box, applied at
all six chrome call sites: both picker grids, the media-library tile, the image
field's selected-value preview, the sections image preview, and the ProseKit
image node view. Each renders at a known size, which is what makes this cheap —
the caller passes the box rather than guessing.

`ImageField`'s `transform` prop had been designed and left unwired — its own doc
comment named `cfImage` as the intended use and no caller ever passed one. It now
**defaults** to a sized derivative and remains available as an override.

Two things preserved deliberately:

- **The ProseKit node view transforms for display only.** `attrs().src` is what
  serializes into stored content and what the site renders via `set:html`, so
  rewriting it would bake a fixed width and crop into the document and defeat
  re-cropping later. A test asserts both halves — the rendered `<img>` carries a
  `/cdn-cgi/image/` URL, the serialized HTML does not — because asserting only
  the stored side would still pass if the node view stopped transforming at all.
- **The zone dependency.** `/cdn-cgi/image/` requires Image Resizing on the
  serving zone; a site whose `MEDIA_URL` is a plain R2 bucket domain gets the
  original back — correct, just not smaller. Documented on the helper so nobody
  debugs it twice.
