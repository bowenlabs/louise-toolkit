// Regenerates `src/theme/fonts.css` by base64-inlining the brand woff2 into an
// @font-face rule. Run from the package root: `node assets/fonts/build.mjs`.
//
// Why inline (rather than ship the woff2 as a referenced asset)? So the brand
// font is baked into the package exactly like the Phosphor icons (see
// src/client/icons.tsx) — self-contained, no runtime fetch, no Google Fonts, and
// consumable both as a plain CSS import and, via `?raw`, from the runtime style
// injector (src/client/styles.ts). The woff2 here is the *source*; it is not in
// package.json `files`, so only the generated CSS ships.
//
// The woff2 is Roboto Flex (OFL, see ./OFL.txt) instanced to the single `wght`
// axis and subset to latin — matching what the editor chrome actually uses.
// Regenerate the woff2 itself from the OFL original (fonttools + brotli):
//   LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
//   python -m fontTools.varLib.instancer "RobotoFlex[…all axes].ttf" \
//     opsz=14 wdth=100 GRAD=0 slnt=0 XOPQ=96 YOPQ=79 XTRA=468 YTUC=712 YTLC=514 \
//     YTAS=750 YTDE=-203 YTFI=738 -o rf-wght.ttf
//   python -m fontTools.subset rf-wght.ttf --unicodes="$LATIN" --layout-features='*' \
//     --flavor=woff2 --output-file=RobotoFlex-wght-latin.woff2

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const woff2 = readFileSync(here("./RobotoFlex-wght-latin.woff2"));
const dataUrl = `data:font/woff2;base64,${woff2.toString("base64")}`;

const css = `/*
 * BowenLabs brand type for Louise surfaces: Roboto Flex (variable weight axis).
 * There's no separate display face — headings are the same family, just heavier.
 *
 * GENERATED — do not edit by hand. Run \`node assets/fonts/build.mjs\` to
 * regenerate after changing the source woff2 (assets/fonts/, not published).
 *
 * The font is base64-inlined below (Roboto Flex, OFL — see THIRD_PARTY_NOTICES.md),
 * so it's bundled with the package like the Phosphor icons: self-contained, no
 * runtime fetch, no Google Fonts, CSP-safe. Loaded on Louise surfaces via the
 * client style injector (src/client/styles.ts imports this file with \`?raw\`) and
 * by any markup that imports \`louise-toolkit/theme/fonts.css\` + opts in with the
 * \`.louise-type\` class. A \`data:\` font needs \`font-src data:\` under a strict CSP.
 */
@font-face {
  font-family: "Roboto Flex";
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: url("${dataUrl}")
    format("woff2");
}

.louise-type {
  font-family:
    "Roboto Flex",
    ui-sans-serif,
    system-ui,
    -apple-system,
    sans-serif;
}
/* Titles a little thicker than body; subheadings medium. */
.louise-type :is(h1, h2, h3, .louise-heading) {
  font-weight: 800;
}
.louise-type :is(h4, h5, h6, .louise-subheading) {
  font-weight: 600;
}
`;

const out = here("../../src/theme/fonts.css");
writeFileSync(out, css);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `wrote src/theme/fonts.css (${kb(css.length)}; woff2 ${kb(woff2.length)} → base64 inlined)`,
);
