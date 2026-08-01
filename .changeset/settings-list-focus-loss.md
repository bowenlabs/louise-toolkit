---
"louise-toolkit": patch
---

fix(settings): the drawer's link lists lost focus after every keystroke

`LinkListEditor` rendered its rows with `<For>`, which is keyed by REFERENCE.
Its `update` helper replaces the edited row with a new object
(`rows.map((r, j) => (j === i ? { ...r, ...patch } : r))`), so every keystroke
made that row a new item — `<For>` tore the row's DOM down and rebuilt it, the
`<input>` being typed into was destroyed mid-edit, and focus fell to `<body>`.

The visible symptom is that typing a nav label or URL in the Settings drawer
accepts one character and then deselects, so the owner has to click back in for
every letter.

Now `<Index>`, which keys by POSITION: the row's elements are created once and
only the values update, so the focused input survives. The rows are positional
anyway — reorder moves values between fixed slots rather than moving DOM.

Field editors that iterate a STABLE list (a constant, or `Object.keys()`
captured once) were never affected: nothing re-keys them, so their inputs are
never recreated.
