---
"louise-toolkit": minor
---

Loading, empty, and error states for the editor's panels (#468): `Skeleton`, `EmptyState`, `ErrorState`, and `InlineError`, exported from `louise-toolkit/client/settings`.

- `ErrorState` requires `onRetry`, so a failure with no way out can't be written. Its alert, and `InlineError`, are in the page before their message, so a screen reader announces it.
- The Pages panel, the Media panel, both media pickers, and the site health panel show a skeleton while loading and **Try again** when a load fails. A failed load used to read as an empty one: "No pages yet," "No uploads yet."
- The dashboard shows a skeleton while it checks the site, and says it couldn't check when the overview fails. It used to say "Your site is healthy" in both cases.
- The Settings footer's status region is in the page at rest, so the first status written into it is announced.

What to know when you upgrade: a test that looked for the footer's status pill to be absent at idle now finds it present and empty. A test that read the dashboard summary right after mount should wait for the overview to load.
