---
"louise-toolkit": patch
---

Two editor badges and the Done action now clear 4.5:1, the WCAG AA line for text, following the rule from the theme contrast fix: a ring color never carries text.

- **The soft-lock badge**, which names the editor who holds a field, fills with `--louise-orange-strong` (`#b45309`) instead of `--louise-orange` (`#ea7317`). White on it goes from 3.02:1 to 5.02:1. The locked field also stops fading the badge with it: the 60% opacity now applies to the field's content, not the field, because the faded badge rendered at 2.49:1 even on the darker orange. The field looks as dimmed as before, unless it holds bare text outside any element, which no longer dims.
- **The "Could be faster" performance badge** keeps its yellow `--louise-yellow` (`#ca8a04`) fill and takes dark ink, `#231903`, instead of white. That's 5.90:1, up from 2.94:1.
- **The Done action** on the edit bar uses `--louise-orange-strong` for its text, 5.02:1 on the bar's white, up from 3.02:1. Its hover tint is lighter, so the text keeps 4.62:1 on hover.
- **The Settings action's hover tint** is lighter too, 8% blue instead of 10%, so its text is 4.61:1 on hover, up from 4.49:1.

**What to do:** nothing. If you override `--louise-orange` to restyle the chrome, set `--louise-orange-strong` too, because the soft-lock badge and Done now read the stronger token.
