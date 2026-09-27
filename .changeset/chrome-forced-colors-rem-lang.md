---
"louise-toolkit": minor
---

The editor chrome works under a Windows contrast theme, follows the browser's text size, and tells a screen reader its strings are English (#598).

- **Forced colors:** focus on an editable field, an input, or the rich-text frame was drawn only as a box shadow after `outline: none`, and forced colors remove box shadows, so focus disappeared. Those rules now set a transparent outline, which is invisible in normal colors and painted in the system color under forced colors. A `forced-colors` block gives the active section or block, the active chip, tab, and toolbar button, and the node toolbar a `Highlight` outline or a border, since their normal cue is a shadow or a background.
- **Focus rings:** the input and rich-text focus ring was a 12 percent tint; it's now a solid 2 px ring in the brand blue, 3.88:1 against white.
- **Text size:** every font size in the chrome's styles is in `rem` instead of `px`, so an owner who raises their browser's default text size gets larger editor text.
- **Language:** every root the chrome adds to the page (the edit bar, the node toolbar, the sections dock and its pickers, inspector, and history drawer, the Settings drawer, the studio, the grammar popover, and the rich-text alt-text control) carries `lang="en"`, so a screen reader on a page in another language reads the chrome's strings with English rules. The value describes the chrome's strings, not the site.
- **New-tab link:** the Pages panel's "View published page" link says "(opens in a new tab)" and shows an icon instead of a `→` a screen reader read aloud.

What to know when you upgrade: `rem` follows the site's root font size as well as the browser's. A site that shrinks the root, such as `html { font-size: 62.5% }`, now shrinks the editor chrome with it. Set the root back to `100%` on edit-mode pages, or size the site's own text another way.
