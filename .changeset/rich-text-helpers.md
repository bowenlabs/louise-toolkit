---
"louise-toolkit": patch
---

security: `plainText`, `metaDescription`, `hasRichText`, `stripEmptyHeadings` — rich text as text (#456)

Editor HTML leaks into places that print it rather than render it, and an emptied field
is still a truthy string. Every site hand-rolled regexes for both, and the regexes had
bugs. One site shipped `content="<div><p>Don't be a stranger.</p></div>"` in a meta tag.
Another rendered an emptied `<h3></h3>` hero heading, which a screen reader announces
as a nameless heading.

- **`plainText(html)`**: one line of text. Tags become spaces, entities are decoded,
  and double-encoded markup (`&lt;p&gt;`) is stripped too.
- **`metaDescription(html, { maxLength = 160 })`**: `plainText` clamped on a word
  boundary. Returns `undefined` for markup-only input, so you fall back to a default
  rather than emitting `content=""`.
- **`hasRichText(html)`**: whether a field has text or an embedded image, video, iframe
  or SVG. Use it instead of `field && …`.
- **`stripEmptyHeadings(html)`**: run on sanitized output,
  `stripEmptyHeadings(sanitizeRichHtml(html))`.

Replacing a hand-rolled version fixes three bugs along the way:

1. `/<[^>]*>/g` deletes real prose. It turns `5 < 6 and 7 > 2` into `5  2`, while
   these helpers remove only tag-shaped text.
2. An out-of-range numeric escape (`&#99999999;`) made `String.fromCodePoint` throw.
   One bad stored string could take the page down; it is now dropped.
3. An image-only field no longer counts as empty.

All four return text, not HTML, so escape the result on output as usual.
