---
"louisecms": patch
---

Make concurrent versioned surfaces on one page draft-safe. `POST /:id/versions`
now merges a partial draft save over the newest *pending* draft's snapshot
(falling back to the live row) instead of always over the live row, so a second
editing surface (e.g. a sections dock alongside an inline body) no longer reverts
the other's pending work; publishing with no explicit `versionId` targets the
newest pending draft, so a superseded draft can't silently go live. The edit bar
no longer shows duplicate Save-draft/Publish actions when both surfaces mount.
