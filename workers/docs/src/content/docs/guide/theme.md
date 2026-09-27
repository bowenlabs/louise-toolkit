---
title: Theme
description: The daisyUI "louise" editor theme.
sidebar:
  order: 12
---

Louise's editor chrome—Louise Settings, inline-edit affordances, panels—is styled
by the **louise** [daisyUI](https://daisyui.com) theme, built from the BowenLabs
brand system with its blue as primary. It styles _editor surfaces only_;
your public site keeps its own theme.

## Two themes

Two daisyUI 5 themes (Tailwind v4 `@plugin` syntax):

| Theme         | Scheme               | Notes                             |
| ------------- | -------------------- | --------------------------------- |
| `louise`      | light (default)      | Dark green `#4f6933` as secondary |
| `louise-dark` | dark (`prefersdark`) | Light green `#8ebe59` secondary   |

Shared semantics: primary/info blue, accent/warning yellow `#f3ae29`, success
light-green `#8ebe59`, and error orange (the palette has no red).

## Contrast

Text on every fill clears 4.5:1, the WCAG AA line for body text, and so do
primary and error used as text on the page. White on the brand blue `#1481ef`
is only 3.88:1, and on the brand orange `#db6327` 3.60:1, so each theme gets
there its own way:

| Theme         | Primary/info                       | Error                              |
| ------------- | ---------------------------------- | ---------------------------------- |
| `louise`      | `#0f6ecd` under white (5.08:1)     | `#b8501f` under white (4.99:1)     |
| `louise-dark` | `#1481ef` under `#0e141b` (4.77:1) | `#db6327` under `#0e141b` (5.14:1) |

No single blue clears 4.5:1 both under white text and as text on a dark base,
so the dark theme keeps the brand fills and puts dark ink on them.

### The editor chrome's tokens

The editor chrome (the edit bar, the node toolbar, the drawer) injects its own
stylesheet, and every rule in it reads a **role** token rather than a color:
`--louise-surface`, `--louise-text`, `--louise-text-muted`, `--louise-border`,
`--louise-accent`, `--louise-ring`, `--louise-success`, `--louise-warning`,
`--louise-danger`, and the node ring and toolbar, `--louise-node-ring` and
`--louise-node-bar`. The roles point at a small palette, and a site can override
either layer on `:root`.

The chrome follows the theme's contrast rule. `--louise-ring` is the brand blue
`#1481ef`, for rings, borders, and focus outlines, where 3:1 is enough; text and
fills use `--louise-accent`, the one-stop-darker `#0f6ecd` (5.08:1). Danger is the
theme's error orange `#b8501f` (4.99:1), and orange means danger and nothing else
in the chrome. Warning is amber `#a16207` (4.92:1 under white text). Every
editable node rings in the one brand blue, and the toolbar's tag says what the
node is.

Text sizes come from a five-step scale in `rem`, `--louise-text-2xs` (11 px at the
default size) through `--louise-text-lg` (16 px).

The chrome goes dark with the system setting. In dark mode only the roles change:
the surface is `#0e141b`, and the brand fills keep their hue and take dark ink on
top, as the `louise-dark` theme does (`#1481ef` under `#0e141b`, 4.77:1). To pin
a scheme regardless of the system, set it on the root element:

```html
<html data-louise-scheme="light"></html>
```

The chrome doesn't read the site's daisyUI theme, so a site that shows
`louise-dark` in a dark system setting and `louise` otherwise matches the chrome
without doing anything. A site with its own theme switch sets
`data-louise-scheme` to match it.

## Usage

Import the theme into the stylesheet that Tailwind v4 processes for your editor
chrome:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes:
    louise --default,
    louise-dark --prefersdark;
}
@import "louise-toolkit/theme/louise.css";
@import "louise-toolkit/theme/fonts.css";
```

Apply `data-theme="louise"` (or `louise-dark`) to the root of any editor surface
so the chrome never inherits the site theme. Chrome-specific variables
(`--louise-accent`, `--louise-accent-soft`, `--louise-ring`) are defined per
theme in `louise.css`; the font tokens are in `fonts.css`.

## Typography

The editor uses **Roboto Flex** throughout. Headings are the same family, just
heavier: weight 800 for titles and 600 for subheadings. The face is inlined in
`fonts.css`, so there's no font request: the client's style injector puts
`fonts.css` ahead of the chrome's CSS, in edit mode only, so the public site
ships no editor fonts.

`fonts.css` also defines the two font tokens, `--louise-font-head` and
`--louise-font-body`, once. The chrome reads them, and so does the `.louise-type`
class for markup that opts in, so an override on `:root` changes both.
