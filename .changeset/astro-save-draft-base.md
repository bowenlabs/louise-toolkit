---
"@louise-toolkit/astro": minor
---

`louiseSaveDraftAction` takes an optional `base`, the field revisions a draft save started from (#572), and returns the saved fields' `revs`. A save whose `base` is stale for a field someone else changed returns `{ conflicts }` rather than throwing, because a rejected Action reaches the client only as an error, which can't carry the current values the owner chooses between. If your site wraps the Action for `mountLouise({ actions })`, resolve with its result as before and the editor shows the conflict.
