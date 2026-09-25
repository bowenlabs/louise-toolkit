---
title: theme
description: "louise-toolkit/theme—the daisyUI louise editor theme stylesheets."
sidebar:
  order: 8
---

```css
@import "louise-toolkit/theme/louise.css";
@import "louise-toolkit/theme/fonts.css";
```

Two CSS assets—not JS—that style Louise's editor chrome. They ship as plain
stylesheets (no build step, no peers); the package marks them as the only
side-effectful files, so importing JS never accidentally pulls in CSS.

| Export                            | Contents                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `louise-toolkit/theme/louise.css` | The `louise` / `louise-dark` daisyUI themes + chrome variables (`--louise-accent`, `--louise-ring`, `--louise-font-head`, `--louise-font-body`). |
| `louise-toolkit/theme/fonts.css`  | The `.louise-type` typography contract (Roboto Flex for headings and body). See [Fonts](#fonts).                                                 |

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
@import "louise-toolkit/theme/louise.css";
@import "louise-toolkit/theme/fonts.css";
```

Apply `data-theme="louise"` (or `louise-dark`) to any editor surface's root so it
never inherits the public site theme. See the [Theme guide](/guide/theme/)
for the palette, typography, and the standalone `preview/index.html`.

## Fonts

`fonts.css` base64-inlines Roboto Flex (the `wght` axis, latin subset) as a
`data:` `@font-face`, so it makes no request to Google Fonts or any other host.
Under a strict CSP, the font needs `data:` in `font-src`; the
`@louise-toolkit/astro` middleware adds it for you. See
[`allowCspDataFonts`](/reference/security/#allowing-the-bundled-font-allowcspdatafontsresponse).

The inlined face makes `fonts.css` about 45 KB, and a stylesheet blocks
rendering. That's fine for editor surfaces, where the edit-mode client injects
it. On public pages, self-host a `.woff2` and declare the `@font-face` yourself,
so the font streams alongside the page instead of delaying first paint.

The inlined face carries only `wght`. If your design uses `font-stretch`, you
need the `wdth` axis too: self-host a variable woff2 instanced to `wght` and
`wdth`, which is still far smaller than an all-axis file. The reference site's
[`public/fonts/README.md`](https://github.com/bowenlabs/louise-toolkit/blob/main/workers/site/public/fonts/README.md)
has the `fontTools` commands. Whatever tool fetches the font, check that the
file it returns keeps `wdth`: without the axis, `font-stretch` has no effect and
the text renders at normal width.

## Palette

Primary/info blue `#1481ef`, accent/warning yellow `#f3ae29`, success green
`#8ebe59`, error orange `#db6327`. The `louise` theme uses dark green `#4f6933`
as secondary; `louise-dark` uses light green `#8ebe59`. The palette has no red.
