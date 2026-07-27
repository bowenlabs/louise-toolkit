---
"louise-toolkit": minor
---

Editor: History moves into the Settings drawer, and the bar's "Done" becomes a real "Sign out".

Phase 2 of the editor overhaul (coracle.coffee#36) — declutter the bar and stop
splitting account actions across two surfaces.

## History

The version-history **trigger** moved into the Settings drawer's top strip, next
to Pages/Media/Settings. The **drawer itself did not move** and is still not a
Settings panel: versions are per-**page**, Settings is global, and the sections
surface mounts independently of `mountSettings`. Making history a panel would have
meant threading a page context into a global shell and losing history entirely on
sections-only hosts.

So the two surfaces hand off through window events, and each degrades on its own:

- A mounted sections surface sets `data-louise-history` on `<html>`. Settings only
  renders the History icon when it's there, so the icon is never a dead button on
  a host that mounts Settings but no sections.
- Clicking History closes the Settings drawer before opening the history one —
  two stacked modals would fight over the focus trap.
- Sections keeps its own bar History button **only** when Settings isn't mounted.
  It detects `#louise-drawer-root` on mount and also listens for
  `SETTINGS_READY_EVENT`, so either mount order resolves correctly.

New exports from `louise-toolkit/editor` settings: `OPEN_HISTORY_EVENT`,
`SETTINGS_READY_EVENT`, `HISTORY_READY_ATTR`.

## Sign out

⚠️ **The bar's rightmost action now ends the session.** "Done" was an `<a>` to
`?louise=off`, which cleared the edit-mode cookie and left the session fully
open — so on a shared machine the control that *looks* like leaving didn't log
anyone out, and the only real sign-out was buried in the Settings drawer. It is
now a `<button>` labelled **Sign out** that POSTs `/api/auth/sign-out` and *then*
drops edit mode. The sign-out call is best-effort: if it fails, edit mode is still
dropped, so a user can't be stranded in an editor they asked to leave.

The duplicate **Session → Sign out** group is gone from the Settings panel.
`settingsExtras` is unaffected. No CSS change — `.louise-exit` already shared its
rule block with `.louise-settings`, which was already a button.
