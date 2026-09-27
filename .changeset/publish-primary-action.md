---
"louise-toolkit": minor
---

Publish is the edit bar's one primary action, stays reachable while there's nothing to publish, and says when the page is live (#597).

- **One filled button:** Publish is the one action that changes the live site, so it's now filled (white on the blue text stop, 5.08:1). Save draft, Settings, and Sign out stay text buttons.
- **Reachable when unavailable:** Publish, Save, and Save draft use `aria-disabled` instead of `disabled` while they have nothing to do, so Tab and the toolbar's arrow keys still reach them, and a click does nothing. Beside Publish, "Nothing to publish yet" says why, tied to it with `aria-describedby`. This applies to the inline edit bar and the sections bar alike.
- **Says it's live:** a publish still ends in a reload, but it now leaves a one-shot flag in `sessionStorage`, and the reloaded bar says "Published. Your page is live." in its status region. A private window without storage skips the message. The sections bar gains a status region that's always in the page, so the message is announced.
- **Says who holds a lock:** a field a realtime peer holds shows its badge as a real text element, "Alex is editing this field," instead of CSS generated content. The editable surface points `aria-describedby` at it and is `aria-readonly`, in place of `aria-disabled` on its container, so a screen reader user who tabs in hears that it's locked and who has it.

What to know when you upgrade: a test that expected an unavailable Publish, Save, or Save draft to be `disabled` now finds `aria-disabled="true"`. Site CSS that targeted `.louise-editable.louise-locked::before` or `data-louise-locked-by` should target `.louise-lock-note` instead.
