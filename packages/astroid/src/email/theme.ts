// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Deriving a `MailTheme` from the project's brand.
//
// The toolkit's email shell takes a fully-specified theme — ten palette slots, a
// colour band, three font stacks. Every site hand-picked all of it, which is
// exactly the kind of work a config should absorb: an Astroid project already
// declares `theme.colors`, and that is enough to produce a mail theme that looks
// deliberate rather than defaulted.
//
// Two decisions here are load-bearing:
//
//   1. **Neutrals are fixed, brand colours are derived.** Page background, ink,
//      rules — those are typography choices, not brand ones, and a site that
//      wants different ones passes an override. What varies per brand is the
//      accent and the colour band, and both come from `theme.colors`.
//   2. **The accent is contrast-corrected.** A pale brand colour used verbatim
//      as the eyebrow + link colour is unreadable on a near-white card. Rather
//      than hope nobody picks yellow, the accent is darkened until it clears
//      WCAG AA against the card background.

import type { MailPalette, MailTheme } from "louise-toolkit/email";
import type { AstroidConfig } from "../config.js";

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

const rgbToHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Linear blend from `a` to `b`; `t` of 0 is all `a`, 1 is all `b`. */
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const tint = (c: Rgb, t: number) => mix(c, WHITE, t);
const shade = (c: Rgb, t: number) => mix(c, BLACK, t);

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours (1–21). */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Darken `color` until it clears `minRatio` against `bg`. A brand colour is
 * chosen to look good on a website, and plenty of good ones (yellows, pale
 * teals) are illegible as 11px uppercase text on a near-white email card — mail
 * clients offer no dark-mode escape hatch, so this is corrected up front.
 */
function readableOn(color: Rgb, bg: Rgb, minRatio = 4.5): Rgb {
  let out = color;
  // 20 steps of 5% each bottoms out at black, which always passes on a light bg.
  for (let i = 0; i < 20 && contrast(out, bg) < minRatio; i++) out = shade(out, 0.05);
  return out;
}

/**
 * The five-cell colour band across the top of the card. Always five cells,
 * whatever the brand supplies, so the masthead reads as a designed element
 * rather than "however many colours happened to be configured":
 *
 *   one colour   → a light-to-dark ramp through it
 *   two colours  → a ramp bridging the two
 *   three        → the three, with a light lead and a dark tail
 */
function buildBand(colors: Rgb[]): string[] {
  const [a, b, c] = colors;
  if (!b) return [tint(a, 0.4), tint(a, 0.18), a, shade(a, 0.18), shade(a, 0.34)].map(rgbToHex);
  if (!c) return [tint(a, 0.35), a, mix(a, b, 0.5), b, shade(b, 0.25)].map(rgbToHex);
  return [tint(a, 0.3), a, b, c, shade(c, 0.25)].map(rgbToHex);
}

/** Warm-neutral defaults. Brand-agnostic typography choices, not brand ones. */
const NEUTRALS = {
  pageBg: "#EDEBE4",
  bg: "#FFFDF7",
  bgSoft: "#FAF7EF",
  ink: "#1A1A1A",
  inkSoft: "#4A4A4A",
  inkMute: "#6D6D6D",
  rule: "#E1DED4",
  ruleSoft: "#EDEBE4",
  onDark: "#FAF7EF",
} satisfies Omit<MailPalette, "accent">;

/** Web-safe stacks. Email clients can't be relied on to load a webfont, so the
 *  project's `theme.font` leads and a real fallback follows. */
function buildFonts(font?: string) {
  const lead = font?.trim() ? `'${font.trim()}', ` : "";
  return {
    serif: `${lead}Georgia, 'Times New Roman', serif`,
    sans: `${lead}-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
    mono: "ui-monospace, Menlo, Consolas, 'Courier New', monospace",
  };
}

/** Deep-mergeable overrides for the parts a site wants to own. */
export interface MailThemeOverrides {
  palette?: Partial<MailPalette>;
  band?: string[];
  fonts?: Partial<MailTheme["fonts"]>;
  brand?: Partial<MailTheme["brand"]>;
  radius?: number;
  bandHeight?: number;
  buttonShape?: MailTheme["buttonShape"];
}

/**
 * Build the project's transactional-mail theme from its `defineAstroid` config.
 *
 * ```ts
 * const theme = astroidMailTheme(config);
 * const mail = magicLinkEmail(theme, { url, toEmail });
 * ```
 *
 * An invalid or missing brand colour falls back to the ink neutral rather than
 * throwing — a malformed hex in settings should not take out password reset.
 */
export function astroidMailTheme(
  config: AstroidConfig,
  overrides: MailThemeOverrides = {},
): MailTheme {
  const cardBg = hexToRgb(NEUTRALS.bg) ?? WHITE;
  const brandColors = [
    config.theme.colors.brand,
    config.theme.colors.secondary,
    config.theme.colors.tertiary,
  ]
    .map((c) => (c ? hexToRgb(c) : null))
    .filter((c): c is Rgb => c !== null);
  const base = brandColors[0] ?? (hexToRgb(NEUTRALS.ink) as Rgb);

  return {
    palette: {
      ...NEUTRALS,
      accent: rgbToHex(readableOn(base, cardBg)),
      ...overrides.palette,
    },
    band: overrides.band ?? buildBand(brandColors.length ? brandColors : [base]),
    fonts: { ...buildFonts(config.theme.font), ...overrides.fonts },
    brand: {
      name: config.theme.name,
      footerLead: config.theme.name,
      ...overrides.brand,
    },
    radius: overrides.radius ?? 8,
    bandHeight: overrides.bandHeight ?? 110,
    buttonShape: overrides.buttonShape ?? "pill",
  };
}
