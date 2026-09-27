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

| Export                            | Contents                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `louise-toolkit/theme/louise.css` | The `louise` / `louise-dark` daisyUI themes + chrome variables (`--louise-accent`, `--louise-accent-soft`, `--louise-ring`).                          |
| `louise-toolkit/theme/fonts.css`  | Roboto Flex, inlined; the font tokens `--louise-font-head` and `--louise-font-body`; and the `.louise-type` typography contract. See [Fonts](#fonts). |

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
for the palette and typography.

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
`wdth`, which is still far smaller than an all-axis file. The docs site's
[`public/fonts/README.md`](https://github.com/bowenlabs/louise-toolkit/blob/main/workers/docs/public/fonts/README.md)
has the `fontTools` commands. Whatever tool fetches the font, check that the
file it returns keeps `wdth`: without the axis, `font-stretch` has no effect and
the text renders at normal width.

### Loading a self-hosted face without layout shift

With `font-display: swap`, text first renders in the fallback face and reflows
when the brand face arrives. That reflow counts toward Cumulative Layout Shift,
which the [vitals beacon](/reference/analytics/) reports. Give the fallback the
brand face's metrics, so the swap moves nothing:

```css
@font-face {
  font-family: "Roboto Flex Fallback";
  src: local("Arial");
  size-adjust: 100%; /* compute each value from your font file */
  ascent-override: 93%;
  descent-override: 24%;
  line-gap-override: 0%;
}

body {
  font-family: "Roboto Flex", "Roboto Flex Fallback", sans-serif;
}
```

The values above are placeholders: compute them from the brand font's own
metrics, and the fallback's, for example with a font-metrics tool, and check CLS
in the Health panel before and after. A display face set at an unusual width has
no metric match, so the gain is in body text.

### Covering more than Latin-1

The inlined face, and a subset built the same way, stops at `U+0000-00FF` plus a
few symbols. A letter outside it, such as `Ł`, `č`, or `ő` from Latin
Extended-A (`U+0100-017F`), drops to the fallback face mid-word. On a public
page, build a second file for the extended range, and give each face a
`unicode-range`: a browser downloads the extended file only for a page that uses
one of its letters.

```css
@font-face {
  font-family: "Roboto Flex";
  src: url("/fonts/RobotoFlex-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+2000-206F, U+20AC, U+2122;
}
@font-face {
  font-family: "Roboto Flex";
  src: url("/fonts/RobotoFlex-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-017F;
}
```

A `data:` font, like the editor's inlined face, downloads with its stylesheet
whatever `unicode-range` says, so the split saves nothing there.

## Palette

Primary/info blue, accent/warning yellow `#f3ae29`, success green `#8ebe59`,
error orange. The `louise` theme uses dark green `#4f6933` as secondary;
`louise-dark` uses light green `#8ebe59`. The palette has no red.

Every fill and its `-content` color clear 4.5:1 (WCAG AA), and so do primary
and error as text on `base-100`:

| Token                             | `louise`  | `louise-dark` |
| --------------------------------- | --------- | ------------- |
| `primary`, `info`                 | `#0f6ecd` | `#1481ef`     |
| `primary-content`, `info-content` | `#ffffff` | `#0e141b`     |
| `error`                           | `#b8501f` | `#db6327`     |
| `error-content`                   | `#ffffff` | `#0e141b`     |

The brand blue `#1481ef` stays for rings, borders, and focus outlines. See
[Contrast](/guide/theme/#contrast) for the ratios and why the two themes differ.
