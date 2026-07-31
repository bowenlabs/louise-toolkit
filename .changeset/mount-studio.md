---
"louise-toolkit": minor
---

**`mountStudio` — the Louise editor as a full-page admin app.**

The drawer shell was drawer-shaped: summoned over a live page, dismissed, gone.
Right for editing in place, wrong for the back-office half of the job — a session
spent in Media and Pages, deep-linked and bookmarked. A site wanting that had to
rebuild the shell even though every panel it needed already existed.

```ts
import { mountStudio } from "louise-toolkit/client/studio";
mountStudio({ title: "Acme Studio", users: true });
```

**A second presentation, not a second implementation.** Both render the same
panels through a shared `surface` module, so they cannot drift about which panels
exist or how a dashboard card deep-links to one. The drawer adds a scrim, a dialog
role, a focus trap and a close button; the studio adds none of them because it is
always open. Its own subpath (`louise-toolkit/client/studio`) keeps each out of
the other's bundle.

**Two constraints are built in rather than left to the caller:**

- **The shell renders no data and no session-specific markup**, so it stays
  precacheable by a service worker — pair with `PwaConfig.offlineFallback`. Every
  panel fetches through `/api/*` on mount, and `title` is a site name rather than
  an editor name for exactly this reason.
- **A 401 becomes a navigation.** A full-page app can't degrade to "render the
  public page" — there is no page underneath — so an expired session sends the
  browser to `signInPath` (default `/signin`). Handled centrally, because the one
  panel that forgot would render an empty list that reads as "no data" rather than
  "signed out".

Two supporting changes fall out of that:

- `apiGet` / `apiSend` now throw a **`LouiseApiError` carrying `status`**, with an
  `isApiStatus(error, 401)` helper. Callers genuinely branch on status, and
  matching it by parsing an error string would break the first time the message
  was reworded.
- **401s are no longer retried** (both presentations). An expired session fails
  again a second later by definition, so the retry only delayed the response to it
  by the length of the backoff. A 403 — a permissions answer, not an expired
  session — is still retried once.
