---
title: Theme
description: The daisyUI "louise" editor theme.
sidebar:
  order: 11
---

Louise's editor chrome — the drawer, inline-edit affordances, panels — is styled
by the **louise** [daisyUI](https://daisyui.com) theme, built from the BowenLabs
brand system with blue `#1481ef` as primary. It styles _editor surfaces only_;
your public site keeps its own theme.

## Two themes

Two daisyUI 5 themes (Tailwind v4 `@plugin` syntax):

| Theme         | Scheme               | Notes                             |
| ------------- | -------------------- | --------------------------------- |
| `louise`      | light (default)      | Dark green `#4f6933` as secondary |
| `louise-dark` | dark (`prefersdark`) | Light green `#8ebe59` secondary   |

Shared semantics: primary/info blue `#1481ef`, accent/warning yellow `#f3ae29`,
success light-green `#8ebe59`, error orange `#db6327` (the palette has no red).

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
@import "louisecms/theme/louise.css";
@import "louisecms/theme/fonts.css";
```

Apply `data-theme="louise"` (or `louise-dark`) to the root of any editor surface
so the chrome never inherits the site theme. Chrome-specific variables
(`--louise-accent`, `--louise-ring`, `--louise-font`) are defined per theme in
`louise.css`.

## Typography

**Hepta Slab** for headers (weight 900 headings, 500 subheadings) and **Roboto
Flex** for body, per the brand system. The client loads them via a `<link>`
injected in edit mode only — so the public site ships no editor fonts — and
applies them through the `--louise-font-head` / `--louise-font-body` tokens.
`fonts.css` mirrors the same split as a `.louise-type` contract for markup that
opts in.

## Preview

The package ships a standalone `preview/index.html` — a CDN mirror of both themes
that needs no build. Open it directly to see the palette and type scale.
