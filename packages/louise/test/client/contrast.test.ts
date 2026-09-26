// WCAG 2.x contrast for the `louise` themes, the editor chrome, and the reference
// site's copy of the theme (#545).
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
// The reference site keeps its own copy of the theme, with its own bases, and its
// own sign-in page. Both live in this repository, so a drift from the package
// fails here rather than on the live site.
const siteThemeCss = read("../../../../workers/site/src/styles/louise.css");
const siteSignInSource = read("../../../../workers/site/src/pages/louise.astro");
const siteEditDemoSource = read("../../../../workers/site/src/sections/EditDemo.astro");

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

/** A translucent `rgba(…)` tint composited over white in sRGB, as a hex. */
function tintOnWhite(rgba: string | undefined): string {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgba ?? "");
  expect(m, `${rgba} isn't an rgba() tint`).not.toBeNull();
  const alpha = Number(m![4]);
  return `#${[m![1], m![2], m![3]]
    .map((c) =>
      Math.round(Number(c) * alpha + 255 * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
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
  ["louise", "reference site", siteThemeCss],
  ["louise-dark", "reference site", siteThemeCss],
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

describe("the reference site", () => {
  it("copies the package theme's text-bearing brand tokens", () => {
    // The site's bases and radii are its own; the colors that carry text aren't.
    const keys = ["primary", "info", "error"].flatMap((k) => [k, `${k}-content`]);
    for (const name of ["louise", "louise-dark"]) {
      const site = themeTokens(name, siteThemeCss);
      const pkg = themeTokens(name);
      for (const key of keys) expect(site[key], `${name} ${key}`).toBe(pkg[key]);
    }
  });

  it("gives the sign-in button 4.5:1 at rest and on hover", () => {
    const style = siteSignInSource.slice(siteSignInSource.indexOf("<style>"));
    const rest = /\bbutton \{([^}]*)\}/.exec(style)?.[1] ?? "";
    const hover = /\bbutton:hover \{([^}]*)\}/.exec(style)?.[1] ?? "";
    const hex = (body: string, prop: string): string | undefined =>
      new RegExp(`(?<![-\\w])${prop}:\\s*(#[0-9a-f]{3,6})\\b`, "i").exec(body)?.[1];
    const text = hex(rest, "color");
    expect(text).toBeDefined();
    for (const body of [rest, hover]) {
      const fill = hex(body, "background");
      expect(fill).toBeDefined();
      expect(contrast(text!, fill!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the sign-in button a 3:1 edge against its card", () => {
    // WCAG 1.4.11: the text-stop fill is only 2.88:1 on the dark card, so the
    // button's boundary is its border, which has to hold at rest and on hover.
    const style = siteSignInSource.slice(siteSignInSource.indexOf("<style>"));
    const card = /\.card \{([^}]*)\}/.exec(style)?.[1] ?? "";
    const rest = /\bbutton \{([^}]*)\}/.exec(style)?.[1] ?? "";
    const hover = /\bbutton:hover \{([^}]*)\}/.exec(style)?.[1] ?? "";
    const cardFill = /(?<![-\w])background:\s*(#[0-9a-f]{3,6})\b/i.exec(card)?.[1];
    const edge = /(?<![-\w])border:\s*\d+px solid (#[0-9a-f]{3,6})\b/i.exec(rest)?.[1];
    expect(cardFill).toBeDefined();
    expect(edge, "the button needs a solid border").toBeDefined();
    expect(hover, "hover mustn't drop the border").not.toMatch(/(?<![-\w])border(?:-color)?:/);
    expect(contrast(edge!, cardFill!)).toBeGreaterThanOrEqual(3);
  });

  it("gives the edit demo's status text 4.5:1 on its bar", () => {
    // The mock's address bar carries "Published" in view mode and "Editing" in
    // edit mode, both as small bold text.
    const barAt = siteEditDemoSource.indexOf("lt-demo-status-view");
    const bar = siteEditDemoSource.slice(siteEditDemoSource.lastIndexOf("<div", barAt), barAt);
    const barFill = /\bbg-\[(#[0-9a-f]{6})\]/i.exec(bar)?.[1];
    expect(barFill).toBeDefined();
    for (const status of ["lt-demo-status-view", "lt-demo-status-edit"]) {
      const text = new RegExp(`${status}[^"]*\\btext-\\[(#[0-9a-f]{6})\\]`, "i").exec(
        siteEditDemoSource,
      )?.[1];
      expect(text, status).toBeDefined();
      expect(contrast(text!, barFill!), status).toBeGreaterThanOrEqual(4.5);
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

  // The `:root` palette, so a rule's `var(--louise-*)` resolves to its hex.
  const palette: Record<string, string> = { "--louise-blue": ringBlue ?? "" };
  for (const m of css.slice(0, css.indexOf("}")).matchAll(/(--louise-[\w-]+):\s*(#[0-9a-f]{6});/gi))
    palette[m[1]] = m[2];
  // The color that leads a value, so a `background` shorthand with an image
  // after the color resolves too.
  const resolve = (value: string): string => {
    const [, token, hex] = /^(?:var\((--[\w-]+)\)|(#[0-9a-f]{3,6})\b)/i.exec(value) ?? [];
    return token ? palette[token] : (hex ?? value);
  };

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

  it("keeps the ring blue for 3:1 and the text stop for 4.5:1", () => {
    expect(ringBlue).toBeDefined();
    expect(textBlue).toBeDefined();
    expect(contrast(ringBlue!, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(textBlue!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("never sets white text on, or any text in, a ring-only color", () => {
    // Blue and orange are ring colors with a -strong text stop; the yellow is too
    // light for white text at all.
    const onRing = /background:\s*var\(--louise-(?:blue|orange|yellow)\)/;
    const whiteText = /(?<![-\w])color:\s*#fff(?:fff)?\b/i;
    const inRing = /(?<![-\w])color:\s*var\(--louise-(?:blue|orange|yellow)\)/;
    const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => (onRing.test(body) && whiteText.test(body)) || inRing.test(body))
      .map(([, selector]) => selector.trim());
    expect(offenders).toEqual([]);
  });

  it("fills white-text controls with a blue that clears 4.5:1", () => {
    // The primary button carried its own literal blue before #545; pin it to the stop.
    expect(css).toMatch(/\.louise-btn-primary \{ background: var\(--louise-blue-strong\);/);
  });

  // A badge's text and fill can come from two rules: the Core Web Vitals badge
  // sets white text once and a fill per rating, so each pair is checked whole.
  const badges: Array<[string, string[]]> = [
    ["the soft-lock badge", [".louise-editable.louise-locked::before"]],
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
      expect(contrast(resolve(color!), tintOnWhite(background))).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Active controls that put blue on a blue tint. The toolbar's buttons are
  // icon-only today, so 3:1 would do, but 4.5:1 holds for a text label later;
  // the drawer tabs carry text now. Toolbar and drawer are both white, so the
  // translucent tint composites over white.
  const activeOnTint = [".louise-tb-btn", ".louise-drawer-close", ".louise-tab"];

  it.each(activeOnTint)("keeps active %s over 4.5:1 on its tint", (control) => {
    const { color, background } = declarations(`${control}.is-active`);
    expect(contrast(resolve(color!), tintOnWhite(background))).toBeGreaterThanOrEqual(4.5);
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
      expect(tintOnWhite(active.background)).not.toBe(tintOnWhite(hover.background));
    }
    expect(tintOnWhite(active.background)).not.toBe("#ffffff");
    expect(resolve(active.color!)).not.toBe(resolve(rest.color!));
  });

  it("colors the Done action with a text stop", () => {
    // The action bar is white; Done is orange text on it.
    const { color } = declarations(".louise-exit");
    expect(contrast(resolve(color!), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
