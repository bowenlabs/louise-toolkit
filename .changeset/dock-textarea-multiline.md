---
"louisecms": minor
---

feat(client): multi-line textarea for `textarea`-typed dock fields

Section fields declared `type: "textarea"` but edited in the dock (i.e.
`inline: false` — card bodies, FAQ answers, packaging step/tier bodies) were
rendered with a single-line `<input>`, so they couldn't hold line breaks. They
now render a resizable `<textarea>`, and the entered newlines are saved as `\n`
(the site renders them with `white-space: pre-line`). Inline (in-place) text
fields are unchanged.
