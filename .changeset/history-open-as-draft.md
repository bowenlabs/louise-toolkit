---
"louise-toolkit": minor
---

Version history no longer puts an old version live in one click, and a deleted draft can come back (#540).

- **Open as draft:** a published row's **Restore** is now **Open as draft**. It loads that version onto the page as a new draft, the way **Edit** resumes a draft, and the owner goes live through the usual **Publish**. Nothing in the drawer publishes anymore.
- **Undo a draft delete:** the trash icon removes the row at once and shows **Draft deleted · Undo** in the drawer for 8 seconds, with focus on **Undo**. The discard request is sent when that window ends, the drawer closes, or a publish starts, with `keepalive` so a reload right after doesn't cancel it. One delete waits at a time; a second delete sends the first.
- **Row summaries:** each row names how many sections the version holds and the labels of the first two, such as "3 sections · Hero, Feature grid, …".

No site change is needed. If your own tests click **Restore** in the history drawer, they now look for **Open as draft**.
