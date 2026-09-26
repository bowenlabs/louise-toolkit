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
so the dark theme keeps the brand fills and puts dark ink on them. The editor
chrome follows the same rule: `#1481ef` draws rings, borders, and focus
outlines, where 3:1 is enough, and any text on or in the blue uses the
one-stop-darker `--louise-blue-strong` (`#0f6ecd`). The orange works the same
way: `--louise-orange` (`#ea7317`) draws rings, and text on or in it uses
`--louise-orange-strong` (`#b45309`, 5.02:1). The yellow `--louise-yellow`
(`#ca8a04`) is too light for white text, so the one badge that fills with it
uses dark ink (`#231903`, 5.90:1).

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
(`--louise-accent`, `--louise-ring`, `--louise-font`) are defined per theme in
`louise.css`.

## Typography

**Hepta Slab** for headers (weight 900 headings, 500 subheadings) and **Roboto
Flex** for body, per the brand system. The client loads them via a `<link>`
injected in edit mode only—so the public site ships no editor fonts—and
applies them through the `--louise-font-head` / `--louise-font-body` tokens.
`fonts.css` mirrors the same split as a `.louise-type` contract for markup that
opts in.

## Preview

The package ships a standalone `preview/index.html`—a CDN mirror of both themes
that needs no build. Open it directly to see the palette and type scale.
