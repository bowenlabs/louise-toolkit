---
"louise-toolkit": patch
---

The `"logo"` masthead in `renderEmailShell` now draws the logo's alt text so a reader can see it. The image's inline style set no color or font, so when a mail client blocked the image, or the image failed to load, the alt text took the inherited `ink` color on a band filled with `ink` by default, and the masthead showed nothing readable. Many clients block remote images until the reader allows them. The `<img>` style now carries the wordmark's type: `onDark`, the serif font, `brandSize` (default 22px), and a 1.2 line height. The masthead cell sets `onDark` too, for a client that takes the alt text's color from the cell.

**What to do:** nothing beyond raising your `louise-toolkit` range to include this release. No call site changes, and a loaded logo looks the same.
