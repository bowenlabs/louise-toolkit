// WCAG 2.x contrast for the `louise` themes and the editor chrome (#545).
//
// Text needs 4.5:1 (WCAG 1.4.3); a ring, border, or focus outline needs only 3:1
// (1.4.11). The brand blue #1481ef sits between the two at 3.88:1 against white,
// so it's a ring color, never a text color: text on the blue, or in it, uses the
// one-stop-darker text stop. These tests compute the ratios from the source hex
// values with the relative-luminance formula, so a palette edit that drops a pair
// under the line fails here instead of on someone's screen.

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

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `--color-*` tokens of one `@plugin "daisyui/theme"` block, keyed without the prefix. */
function themeTokens(name: string): Record<string, string> {
  const start = themeCss.indexOf(`name: "${name}";`);
  expect(start, `theme ${name} not found`).toBeGreaterThan(-1);
  const block = themeCss.slice(start, themeCss.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)) tokens[m[1]] = m[2];
  return tokens;
}

describe.each(["louise", "louise-dark"])("the %s theme", (name) => {
  const tokens = themeTokens(name);

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
  const css = stylesSource.slice(stylesSource.indexOf("const CSS = `"));
  const ringBlue = /const LOUISE_BLUE = "(#[0-9a-f]{6})";/i.exec(stylesSource)?.[1];
  const textBlue = /--louise-blue-strong:\s*(#[0-9a-f]{6});/i.exec(css)?.[1];

  it("keeps the ring blue for 3:1 and the text stop for 4.5:1", () => {
    expect(ringBlue).toBeDefined();
    expect(textBlue).toBeDefined();
    expect(contrast(ringBlue!, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(textBlue!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("never sets text on, or in, the ring blue", () => {
    const onRingBlue = /background:\s*(?:var\(--louise-blue\)|\$\{LOUISE_BLUE\})/;
    const whiteText = /(?<![-\w])color:\s*#fff(?:fff)?\b/i;
    const inRingBlue = /(?<![-\w])color:\s*(?:var\(--louise-blue\)|\$\{LOUISE_BLUE\})/;
    const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => (onRingBlue.test(body) && whiteText.test(body)) || inRingBlue.test(body))
      .map(([, selector]) => selector.trim());
    expect(offenders).toEqual([]);
  });

  it("fills white-text controls with a blue that clears 4.5:1", () => {
    // The primary button carried its own literal blue before #545; pin it to the stop.
    expect(css).toMatch(/\.louise-btn-primary \{ background: var\(--louise-blue-strong\);/);
  });
});
