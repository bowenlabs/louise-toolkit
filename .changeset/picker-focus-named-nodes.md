---
"louise-toolkit": minor
---

The add-section and add-block pickers now work from the keyboard, and every section and block says what it is when it has focus (#596).

- **Pickers:** opening one moves focus to its first item. Escape, from inside it or from the button that opened it, closes it and returns focus to that button. After a pick, focus lands on the new section or block rather than falling to the top of the page.
- **The trailing Add section button** no longer announces a menu. It sets `aria-expanded` and `aria-controls` for the picker it opens.
- **Named nodes:** a section or block rendered as a `div`, `span`, or `section` gets `role="group"` and a name such as "Section · Hero" when the editor makes it a tab stop, from a new `nodeName` helper the toolbar can share. An element with its own role (a link, a heading, an image), or an author's own `role` or `aria-label`, is left alone.
- **Sections added or re-rendered during the session** stay in the keyboard path. `mountNodeChrome` now returns its disposer with a `prepare(el)` method, which the sections editor calls after it inserts or replaces a section, so the new markup's sections and blocks become named tab stops without a reload.

What to know when you upgrade: `mountNodeChrome`'s return value is still callable as the disposer, so existing callers work unchanged.
