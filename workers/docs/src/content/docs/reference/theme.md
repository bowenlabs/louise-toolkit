---
title: theme
description: "louisecms/theme — the daisyUI louise editor theme stylesheets."
sidebar:
  order: 8
---

```css
@import "louisecms/theme/louise.css";
@import "louisecms/theme/fonts.css";
```

Two CSS assets — not JS — that style Louise's editor chrome. They ship as plain
stylesheets (no build step, no peers); the package marks them as the only
side-effectful files, so importing JS never accidentally pulls in CSS.

| Export                       | Contents                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `louisecms/theme/louise.css` | The `louise` / `louise-dark` daisyUI themes + chrome variables (`--louise-accent`, `--louise-ring`, `--louise-font-head`, `--louise-font-body`). |
| `louisecms/theme/fonts.css`  | The `.louise-type` typography contract (Hepta Slab headers, Roboto Flex body).                                                                   |

## Wiring

Import both into the Tailwind v4 stylesheet that styles your editor surfaces, and
declare the daisyUI themes:

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

Apply `data-theme="louise"` (or `louise-dark`) to any editor surface's root so it
never inherits the public site theme. See the [Theme guide](/guide/theme/)
for the palette, typography, and the standalone `preview/index.html`.

## Palette

Primary/info blue `#1481ef`, accent/warning yellow `#f3ae29`, success green
`#8ebe59`, error orange `#db6327`. The `louise` theme uses dark green `#4f6933`
as secondary; `louise-dark` uses light green `#8ebe59`. The palette has no red.
