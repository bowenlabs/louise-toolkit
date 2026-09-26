---
"louise-toolkit": patch
---

An `inline` rich-text field (`richText: { inline: true }`) no longer runs words together when someone pastes more than one line into it. Inline mode already blocked the Enter keys, but a paste still split the field into paragraphs, and saving joined those with nothing between them: pasting `one` and `two` on separate lines stored `onetwo`.

- **A paste or a drop flattens to one line.** Each line break, whether a newline in pasted text or a `<br>` in pasted HTML, becomes a space, and pasted blocks such as paragraphs and headings join with a space. Inline formatting, such as bold, italic, and links, survives. A pasted image block is dropped, as it already was when the field saved.
- **Saving joins blocks with a space.** A field whose document already holds several blocks, for example one seeded with them, serializes with one space between each pair. No space is added where a block already ends or starts with whitespace, and empty blocks add nothing.

Fields that aren't `inline` are unchanged: a paste into a prose body still keeps its paragraphs.

**What to do:** nothing for new edits. This doesn't repair values that are already stored run-together, since the lost word boundaries can't be recovered from the stored HTML. Find those by eye, for example a heading or tagline that someone filled by pasting, and fix them in the editor. For a field that needs real line breaks, use a `textarea` field and render it with `white-space: pre-line`.
