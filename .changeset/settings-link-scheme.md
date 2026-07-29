---
"louise-toolkit": patch
---

**Security.** Settings link rows are now scheme-validated on write.

`navLinks` and `socialLinks` are stored as `{ label, href }` arrays and rendered
straight into `<a href={…}>` in a site's chrome — on every page. Nothing checked
the scheme, so an authenticated editor could store `javascript:alert(1)` as a nav
destination and it would persist and render as a working link for every visitor.

Sections closed exactly this hole with the `link` field type, whose comment spells
out the vector: a destination is rendered by the site's own component and never
passes through the HTML sanitizer, which only ever sees rich-text markup. Settings
never got the same treatment.

`PATCH /api/louise/settings` now rejects an unsafe `href` with `422`, against the
same allowlist sections use — http(s), `mailto:`, or a site-relative path.

The check is shape-driven rather than key-driven: any patched value that is an
array of objects carrying an `href` is treated as a link list. An `imageKeys`-style
opt-in would mean every site has to remember to configure it, and the site that
forgets is the one that gets hit.

No action needed on upgrade unless a site has already stored a non-conforming
destination, in which case the next settings save of that field returns `422` with
the offending row's path.
