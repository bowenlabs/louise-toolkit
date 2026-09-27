---
"@louise-toolkit/astro": minor
---

`louiseSaveDraftAction` takes an optional `softLocks`, as `versionsRoute` does (#572). A save that changes a field another editor holds in the realtime session returns `{ locked }` as data rather than throwing, the same way a conflict returns `{ conflicts }`, and the editor shows it. Pass `realtimeSoftLocks` from `louise-toolkit/realtime`.
