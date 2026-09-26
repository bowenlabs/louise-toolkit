---
"louise-toolkit": minor
---

Text on the `louise` theme's brand colors now clears 4.5:1, the WCAG AA line for body text. White on the brand blue `#1481ef` was 3.88:1, and on the brand orange `#db6327` 3.60:1.

If your site uses the `louise` or `louise-dark` theme, you see a change:

- **`louise`:** primary and info are a darker blue, `#0f6ecd` (5.08:1 under white), and error is a darker orange, `#b8501f` (4.99:1). A `btn-primary`, a `badge-error`, or a `text-primary` link looks one stop darker.
- **`louise-dark`:** the fills stay `#1481ef` and `#db6327`, and the text on them (`primary-content`, `info-content`, `error-content`) turns from white to dark ink, `#0e141b` (4.77:1 and 5.14:1). The light theme's darker values would have fallen to 3.45:1 as text on the dark base, so no single blue works both ways.

The editor chrome follows the same rule. `#1481ef` stays for rings, borders, and focus outlines, where 3:1 is enough. Every rule that puts text on the blue, or colors text with it, now uses `--louise-blue-strong` (`#0f6ecd`): the presence avatar, the active chip, the active layout choice, the cover tag, the form submit button, the enter-edit button, and the active drawer tab. `.louise-btn-primary` drops its own `#0072e0` for the same token, and its hover moves to `#0b5cad`.

Nothing to change on upgrade, unless you override these tokens: if you set `--color-primary` or `--color-error` yourself, your values still win. If you override `--louise-blue` to restyle the chrome, set `--louise-blue-strong` too, because text in the chrome now reads the stronger token.
