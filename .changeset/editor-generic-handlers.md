---
"louisecms": minor
---

Add `louisecms/editor` — framework-agnostic `api/louise/*` request→response
handlers, each shaped as a `composeWorker` `WorkerRoute` (#10 slice 3). Ships
`save`, `settings`, `pages`, `media`, `seed`, and `inquiries` routes built on
`louisecms/db`, `louisecms/media`, and a site-supplied `resolveEditor` +
`requireEditor` guard (same-origin enforced on mutations). Sites wrap them in
thin framework routes and pass their own Drizzle tables; bespoke resource routes
stay per-site. `settings` is extensible, not a closed set: it patches an
allowlisted structured base (the framework `siteSettingsColumns`, incl. the new
`custom` JSON column) and merges site-declared keys into `custom`, so a site adds
its own settings without forking the handler. Security-sensitive logic
(field allowlists, `sanitizeRichHtml`, the settings partition) is factored into
pure, unit-tested functions.
