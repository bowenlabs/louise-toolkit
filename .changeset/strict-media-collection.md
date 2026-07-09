---
"louisecms": minor
---

Strict media: every editor image comes from the media collection (#47).

Image controls no longer accept an external URL — an editor uploads to the media
library or picks from it, so images are stable R2 assets, never a hotlink that
breaks or vanishes. This is enforced in the UI **and** on write, and every knob
is optional + back-compatible.

- **Selector consistency** (`louisecms/client`): the section `image` control now
  offers **Choose from media** alongside **Upload** (via a new query-free
  `MediaPicker`, for surfaces mounted outside the drawer's TanStack Query
  provider). The drawer `ImageField` is now strict by default — the free-form URL
  input is gone unless you opt in with the new **`allowUrl`** prop — and settings
  image fields (logo, favicon, share image) gained the upload button so both
  paths are available everywhere.
- **`sanitizeRichHtml(html, { mediaBase })`** (`louisecms/security`): with
  `mediaBase` set, an `<img>` whose `src` isn't served from that base is dropped
  (a pasted remote hotlink is removed; media-hosted images are kept). Exposed as
  the new `SanitizeOptions`.
- **`validateSections(catalog, value, { mediaBase })`** /
  `assertValidSections` (`louisecms/cms`): an `image` field whose value is a
  non-empty, non-media URL is a `422` violation.
- **`settingsRoute({ imageKeys, mediaBase })`** (`louisecms/editor`): a patched
  image setting that isn't a media URL is rejected `422`. The check is the pure,
  exported `validateSettingsImages`.
- **`isMediaUrl(base, value)`** (`louisecms/media`): the one definition of
  "media-backed" all of the above enforce with.

Each `mediaBase` argument is optional — omit it and the prior behavior (any safe
`http(s)`/relative image) is unchanged. The dogfood site wires all of them to its
`MEDIA_URL`.
