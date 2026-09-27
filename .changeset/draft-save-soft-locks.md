---
"louise-toolkit": minor
---

A draft save can now respect the realtime session's soft-lock (#572). The session enforced its lock on a rich-text field only on its own socket, so an editor whose socket dropped, or a second tab without one, could save over a body someone else was still editing through the draft route's fetch fallback.

`versionsRoute` takes an optional `softLocks`, and `applySaveDraft` takes it in its options next to `base`. `realtimeSoftLocks({ namespace, fields })` from `louise-toolkit/realtime` builds one from the same Durable Object namespace `realtimeRoute` uses. A save that changes a field another editor holds answers `423` with `locked: ["body"]`, and nothing is written. The holder's own saves go through, and so does a save that sends a held field unchanged. The edit bar shows "Someone else is editing this right now." and keeps the edits for the next save, and its pre-publish snapshot leaves out a field someone else holds.

What to know when you upgrade:

- It's opt-in. Without `softLocks`, a save behaves as before.
- Leave `softLocks` out of the deps your session's own `persist` passes to `applySaveDraft`. The session already checks its locks.
- A save that changes a lockable field makes one request to that page's Durable Object. When it can't be answered, the save goes ahead and reports `editor.softLocks` through `reportDegraded`.
- The session now answers a plain `GET` for its locks. Your `DurableObject` subclass already forwards `fetch`, so there's nothing to change there.
