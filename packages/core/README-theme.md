# @louise/theme

Louise CMS editor theme, built from the BowenLabs brand system
(`bowenlabs/branding/Brand Guidelines`) with **blue `#1481ef` as primary**.
The site (prairie) theme is separate — this package styles Louise surfaces
only: the explorer drawer, inline-edit chrome, and panels.

## Themes

Two daisyUI 5 themes (Tailwind v4 `@plugin` syntax):

| Theme         | Scheme               | Notes                                                                  |
| ------------- | -------------------- | ---------------------------------------------------------------------- |
| `louise`      | light (default)      | Dark green `#4f6933` as secondary                                      |
| `louise-dark` | dark (`prefersdark`) | Light green `#8ebe59` as secondary, per the brand's dark-colorway rule |

Shared semantics: primary/info blue `#1481ef` · accent/warning yellow
`#f3ae29` · success light-green `#8ebe59` · error orange `#db6327` (the
palette has no red).

## Usage

In the Louise client stylesheet (processed by Tailwind v4):

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes:
    louise --default,
    louise-dark --prefersdark;
}
@import "@louise/theme/louise.css";
@import "@louise/theme/fonts.css";
```

Louise surfaces get `data-theme="louise"` (or `louise-dark`) on their root so
editor chrome never inherits the site theme. Chrome-specific variables
(`--louise-accent`, `--louise-ring`, `--louise-font`) are defined per theme in
`louise.css` for `@louise/client`.

Typography: **Hepta Slab** for headers (weight 900 headings, 500 subheadings)
and **Roboto Flex** for body copy, per the brand system. The client chrome
loads them via a `<link>` injected in `injectStyles` (edit mode only, so the
public site ships no editor fonts) and applies them through the
`--louise-font-head` / `--louise-font-body` tokens. `fonts.css` mirrors the same
split as a `.louise-type` contract for markup that opts in.

`tokens.ts` exports the raw palette for contexts CSS variables can't reach.

## Preview

`preview/index.html` is a standalone CDN mirror of both themes (no build
needed) — open it directly or serve the repo root. It duplicates the theme
values; if you change `src/louise.css`, update the preview block too.
