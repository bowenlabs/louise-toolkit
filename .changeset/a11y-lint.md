---
"louise-toolkit": patch
---

Two accessibility fixes the new client lint and name checks found (#600):

- **An unset link is named:** the editor's canvas chrome names a link field that has no URL yet. An `<a>` without `href` has no role of its own, so it was a tab stop a screen reader announced as nothing; it now gets the same `group` role and name as any other generic node.
- **No invalid ARIA on the picker:** the settings image picker's button no longer carries `aria-invalid`, which a button doesn't support. The error stays linked through `aria-describedby`.
