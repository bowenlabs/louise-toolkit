// WCAG 2.x contrast for the `louise` themes and the editor chrome (#545).
//
// Text needs 4.5:1 (WCAG 1.4.3); a ring, border, or focus outline needs only 3:1
// (1.4.11). The brand blue #1481ef sits between the two at 3.88:1 against white,
// so it's a ring color, never a text color: text on the blue, or in it, uses the
// one-stop-darker text stop. The chrome's orange and yellow work the same way.
// These tests compute the ratios from the source hex values with the
// relative-luminance formula, so a palette edit that drops a pair under the line
// fails here instead of on someone's screen.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read from disk rather than with `?raw`: Vitest doesn't process CSS, so a
// `.css?raw` import comes back as an empty string.
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const themeCss = read("../../src/theme/louise.css");
const stylesSource = read("../../src/client/styles.ts");

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** `#fff` as `#ffffff`, so every hex parses the same way. */
const longHex = (hex: string): string =>
  hex.length === 4 ? `#${hex.slice(1).replaceAll(/./g, "$&$&")}` : hex;

function luminance(hex: string): number {
  const n = Number.parseInt(longHex(hex).slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `r`, `g`, `b` at `alpha` composited over white in sRGB, as a hex. */
function overWhite(rgb: number[], alpha: number): string {
  return `#${rgb
    .map((c) =>
      Math.round(c * alpha + 255 * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** A translucent tint composited over white, as a hex: an `rgba(…)`, or a
 *  `color-mix(in oklch, <color> N%, transparent)`, which is that color at N%
 *  alpha. `resolve` turns the mixed color into a hex. */
function tintOnWhite(value: string | undefined, resolve: (v: string) => string = (v) => v): string {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value ?? "");
  if (rgba) return overWhite([rgba[1], rgba[2], rgba[3]].map(Number), Number(rgba[4]));
  const mix = /^color-mix\(in oklch,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(value ?? "");
  expect(mix, `${value} isn't a tint`).not.toBeNull();
  const n = Number.parseInt(longHex(resolve(mix![1])).slice(1), 16);
  return overWhite([(n >> 16) & 255, (n >> 8) & 255, n & 255], Number(mix![2]) / 100);
}

/** The `--color-*` tokens of one `@plugin "daisyui/theme"` block, keyed without the prefix. */
function themeTokens(name: string, css = themeCss): Record<string, string> {
  const start = css.indexOf(`name: "${name}";`);
  expect(start, `theme ${name} not found`).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)) tokens[m[1]] = m[2];
  return tokens;
}

const THEMES = [
  ["louise", "package", themeCss],
  ["louise-dark", "package", themeCss],
] as const;

describe.each(THEMES)("the %s theme in the %s", (name, _where, css) => {
  const tokens = themeTokens(name, css);

  it("gives every -content color 4.5:1 against its fill", () => {
    const pairs: Array<[string, string]> = [];
    for (const key of Object.keys(tokens)) {
      if (!key.endsWith("-content")) continue;
      const fill = key.slice(0, -"-content".length);
      // base-content is the text on every base surface, not on a `base` token.
      const fills = fill === "base" ? ["base-100", "base-200", "base-300"] : [fill];
      for (const f of fills) pairs.push([key, f]);
    }
    expect(pairs.length).toBeGreaterThan(8);
    const failing = pairs
      .map(([text, fill]) => ({ text, fill, ratio: contrast(tokens[text], tokens[fill]) }))
      .filter((p) => p.ratio < 4.5);
    expect(failing).toEqual([]);
  });

  it("keeps primary and error readable as text on base-100", () => {
    // `text-primary`, `link-primary`, and an error message sit on the page itself.
    for (const key of ["primary", "error"]) {
      expect(contrast(tokens[key], tokens["base-100"]), key).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the editor chrome", () => {
  // Comments out, so a failure names the selector alone, the interpolated ring
  // blue spelled as its token, and any other interpolation, such as the
  // soft-lock badge's icon, as a placeholder, so their braces don't split a rule
  // in two.
  const css = stylesSource
    .slice(stylesSource.indexOf("const CSS = `"))
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll("${LOUISE_BLUE}", "var(--louise-blue)")
    .replaceAll(/\$\{[^}]*\}/g, "interpolated");
  const ringBlue = /const LOUISE_BLUE = "(#[0-9a-f]{6})";/i.exec(stylesSource)?.[1];
  const textBlue = /--louise-blue-strong:\s*(#[0-9a-f]{6});/i.exec(css)?.[1];

  // The `:root` tokens, palette and roles, so a rule's `var(--louise-*)`
  // resolves through any role to its hex.
  const palette: Record<string, string> = { "--louise-blue": ringBlue ?? "" };
  for (const m of css.slice(0, css.indexOf("}")).matchAll(/(--louise-[\w-]+):\s*([^;]+);/g))
    if (m[1] !== "--louise-blue") palette[m[1]] = m[2].trim();
  // The color that leads a value, so a `background` shorthand with an image
  // after the color resolves too.
  const resolve = (value: string): string => {
    const [, token, hex] =
      /^(?:var\((--[\w-]+)(?:,[^)]*)?\)|(#[0-9a-f]{3,6})\b)/i.exec(value) ?? [];
    if (token) return palette[token] ? resolve(palette[token]) : token;
    return hex ? longHex(hex).toLowerCase() : value;
  };
  const tint = (value: string | undefined) => tintOnWhite(value, resolve);

  /** `color` and `background` of every rule with exactly this selector, later rules winning. */
  function declarations(selector: string): { color?: string; background?: string } {
    const out: { color?: string; background?: string } = {};
    let found = false;
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (sel.trim() !== selector) continue;
      found = true;
      for (const [, prop, value] of body.matchAll(/(?<![-\w])(color|background):\s*([^;]+);/g))
        out[prop as "color" | "background"] = value.trim();
    }
    expect(found, `rule ${selector} not found`).toBe(true);
    return out;
  }

  // Both schemes' roles as hex: light from the `:root` block, dark from the
  // same with DARK_ROLES laid over it (#603).
  const darkRoles: Record<string, string> = {};
  const darkBlock = /const DARK_ROLES = `([\s\S]*?)`;/.exec(stylesSource)?.[1] ?? "";
  for (const m of darkBlock.matchAll(/(--louise-[\w-]+):\s*(#[0-9a-f]{6});/gi))
    darkRoles[m[1]] = m[2];
  const schemes: Array<[string, (role: string) => string]> = [
    ["light", (role) => resolve(`var(${role})`)],
    ["dark", (role) => darkRoles[role] ?? resolve(`var(${role})`)],
  ];
  /** `color` at `pct` percent over `base`, both hex. */
  const mixOver = (color: string, pct: number, base: string): string => {
    const [c, b] = [color, base].map((h) => Number.parseInt(longHex(h).slice(1), 16));
    const a = pct / 100;
    return `#${[16, 8, 0]
      .map((shift) =>
        Math.round(((c! >> shift) & 255) * a + ((b! >> shift) & 255) * (1 - a))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };

  it("defines a dark value for every role a rule reads for color", () => {
    for (const role of [
      "--louise-surface",
      "--louise-text",
      "--louise-text-muted",
      "--louise-accent",
      "--louise-on-accent",
      "--louise-ring",
      "--louise-danger",
      "--louise-warning",
      "--louise-success",
    ])
      expect(darkRoles[role], role).toMatch(/^#[0-9a-f]{6}$/i);
  });

  describe.each(schemes)("in the %s scheme", (_scheme, role) => {
    const text: Array<[string, string, string]> = [
      ["text", "--louise-text", "--louise-surface"],
      ["body text", "--louise-text-body", "--louise-surface"],
      ["secondary text", "--louise-text-secondary", "--louise-surface"],
      ["muted text", "--louise-text-muted", "--louise-surface"],
      ["secondary text on the muted surface", "--louise-text-secondary", "--louise-surface-muted"],
      ["accent text", "--louise-accent", "--louise-surface"],
      ["text on the accent", "--louise-on-accent", "--louise-accent"],
      ["success text", "--louise-success", "--louise-surface"],
      ["text on success", "--louise-on-accent", "--louise-success"],
      ["text on warning", "--louise-on-accent", "--louise-warning"],
      ["danger text", "--louise-danger", "--louise-surface"],
      ["text on danger", "--louise-on-accent", "--louise-danger"],
      ["text on the unrated badge", "--louise-on-accent", "--louise-text-muted"],
    ];
    it.each(text)("gives %s 4.5:1", (_label, fg, bg) => {
      expect(contrast(role(fg), role(bg))).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      ["--louise-accent-deep", "--louise-accent"],
      ["--louise-danger-deep", "--louise-danger"],
      ["--louise-warning-deep", "--louise-warning"],
    ])("keeps %s at 4.5:1 on a 10%% tint of its color", (deep, tinted) => {
      const tint = mixOver(role(tinted), 10, role("--louise-surface"));
      expect(contrast(role(deep), tint)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps the ring at 3:1 against the surface", () => {
      expect(contrast(role("--louise-ring"), role("--louise-surface"))).toBeGreaterThanOrEqual(3);
    });
  });

  it("keeps the ring blue for 3:1 and the text stop for 4.5:1", () => {
    expect(ringBlue).toBeDefined();
    expect(textBlue).toBeDefined();
    expect(contrast(ringBlue!, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(textBlue!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("never sets white text on, or any text in, a ring-only color", () => {
    // The ring roles are 3:1 colors for outlines; text and fills take the
    // accent stop.
    const onRing = /background:\s*var\(--louise-(?:ring|node-ring|blue)\)/;
    const whiteText = /(?<![-\w])color:\s*(?:#fff(?:fff)?\b|var\(--louise-on-accent)/i;
    const inRing = /(?<![-\w])color:\s*var\(--louise-(?:ring|node-ring|blue)\)/;
    const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => (onRing.test(body) && whiteText.test(body)) || inRing.test(body))
      .map(([, selector]) => selector.trim());
    expect(offenders).toEqual([]);
  });

  it("fills white-text controls with a blue that clears 4.5:1", () => {
    // The primary button carried its own literal blue before #545; pin it to the stop.
    expect(css).toMatch(/\.louise-btn-primary \{ background: var\(--louise-accent\);/);
    expect(resolve("var(--louise-accent)")).toBe(textBlue?.toLowerCase());
  });

  // A badge's text and fill can come from two rules: the Core Web Vitals badge
  // sets white text once and a fill per rating, so each pair is checked whole.
  const badges: Array<[string, string[]]> = [
    ["the soft-lock badge", [".louise-lock-note"]],
    ["the filled Publish button", [".louise-publish"]],
    ["the unrated performance badge", [".louise-cwv-badge"]],
    ...["good", "needs-improvement", "poor"].map((rating): [string, string[]] => [
      `the ${rating} performance badge`,
      [".louise-cwv-badge", `.louise-cwv-badge[data-rating="${rating}"]`],
    ]),
  ];

  it.each(badges)("gives %s 4.5:1", (_label, selectors) => {
    const { color, background } = Object.assign({}, ...selectors.map(declarations)) as {
      color?: string;
      background?: string;
    };
    expect(color).toBeDefined();
    expect(background).toBeDefined();
    expect(contrast(resolve(color!), resolve(background!))).toBeGreaterThanOrEqual(4.5);
  });

  it("dims a locked field's content, not its badge", () => {
    // Opacity on the field composites its ::before badge with it, so the badge's
    // 4.5:1 above would only hold on paper.
    const locked = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      ([, selector]) => selector.trim() === ".louise-editable.louise-locked",
    );
    expect(locked).toBeDefined();
    expect(locked![2]).not.toMatch(/(?<![-\w])(opacity|filter):/);
  });

  it.each([".louise-settings", ".louise-exit"])(
    "keeps %s over 4.5:1 on its hover tint",
    (selector) => {
      // The tint is translucent over the bar's white, so composite it first.
      const { color } = declarations(selector);
      const { background } = declarations(`${selector}:hover`);
      expect(contrast(resolve(color!), tint(background))).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Active controls that put blue on a blue tint. The toolbar's buttons are
  // icon-only today, so 3:1 would do, but 4.5:1 holds for a text label later;
  // the drawer tabs carry text now. Toolbar and drawer are both white, so the
  // translucent tint composites over white.
  const activeOnTint = [".louise-tb-btn", ".louise-drawer-close", ".louise-tab"];

  it.each(activeOnTint)("keeps active %s over 4.5:1 on its tint", (control) => {
    const { color, background } = declarations(`${control}.is-active`);
    expect(contrast(resolve(color!), tint(background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(activeOnTint)("keeps active %s apart from hover and rest", (control) => {
    // A blue tint and a blue foreground, where hover, if the control has one,
    // is a gray tint, and rest is a gray foreground with no fill.
    const active = declarations(`${control}.is-active`);
    const rest = declarations(control);
    const hoverRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(
      ([, selector]) => selector.trim() === `${control}:hover`,
    );
    if (hoverRule) {
      const hover = declarations(`${control}:hover`);
      expect(tint(active.background)).not.toBe(tint(hover.background));
    }
    expect(tint(active.background)).not.toBe("#ffffff");
    expect(resolve(active.color!)).not.toBe(resolve(rest.color!));
  });

  it("colors Sign out with a text stop", () => {
    // The action bar is white; Sign out is accent text on it.
    const { color } = declarations(".louise-exit");
    expect(contrast(resolve(color!), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
