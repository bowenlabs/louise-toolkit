---
"louise-toolkit": minor
---

The sections bar says what it's doing and what failed, and the editor announces what changed without a screen reader user having to look (#468).

- **Save status:** a sections page shows "Saving…" and then "Draft saved" for about 3 seconds. It used to show nothing unless a save failed.
- **Failures in words for their action,** with **Try again**: "Couldn't save your draft. Your edits are still here.," "Couldn't publish. The live page hasn't changed.," and "Couldn't delete the draft." A 4xx's reason follows; a 5xx's text doesn't, since it can carry internals. Both messages sit in regions that are in the page at rest, so they're announced.
- **Slow changes say so:** adding a section, or changing one that re-renders through the fragment route, shows "Adding section…" or "Updating section…" once the wait passes 400 ms, and marks the section `aria-busy`.
- **Announcements:** the Pages search reads "3 pages match" or "No pages match" as the owner types. Moving a section or block with Alt+Up or Alt+Down reads where it landed, such as "Hero moved to position 2 of 5". The presence strip is in the page at rest and reads each editor's name, not their initials.

ADR 0005 is amended: its status line, where History opens, and that duplicate and drag-to-reorder never shipped.
