---
"louise-toolkit": minor
---

Guard the clipboard against stega leaking out of edit mode. In edit/preview mode
rendered text carries an invisible stega source pointer; copying it would paste
zero-width characters into other apps. The edit client now installs a `copy`
handler that strips the payload (via the dependency-free `stegaClean`) — but only
when one is present, so ordinary copies are untouched.

New from `louise-toolkit/content`: `mountStegaClipboardGuard(target?)` (idempotent,
browser-only; auto-mounted by the edit client, call it yourself only if you wire
visual editing by hand) and the pure `cleanCopiedStega(text, html)` it uses.
