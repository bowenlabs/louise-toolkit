// The editor chrome under a Windows contrast theme, a raised text size, and a
// page in another language (#598).
//
// Forced colors drop box shadows, so a focus ring drawn only as a shadow
// vanishes; a transparent outline survives, painted in the system color. Pixel
// font sizes ignore the browser's text-size setting, where `rem` follows it.
// And the chrome's English strings need `lang="en"` on a page that isn't in
// English. These tests read the style sources, so a later edit can't quietly
// bring `outline: none` or a pixel font size back.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { mountNodeChrome } from "../../src/client/node-chrome.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const styles = read("../../src/client/styles.ts");
const chrome = read("../../src/client/node-chrome.ts");

describe("the chrome's CSS under forced colors", () => {
  it("never removes the outline outright", () => {
    for (const source of [styles, chrome]) {
      expect(source).not.toMatch(/outline:\s*(none|0)\s*;/);
    }
  });

  it("gives the active node and the active states a system-color outline", () => {
    expect(chrome).toMatch(
      /@media \(forced-colors: active\)[\s\S]*louise-node-active[\s\S]*Highlight/,
    );
    expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*\.louise-chip\.is-active/);
  });

  it("draws the input ring solid, not as a faint tint", () => {
    expect(styles).not.toContain("rgba(20, 129, 239, 0.12);\n}");
    expect(styles).toMatch(
      /\.louise-input:focus,[\s\S]*?box-shadow: 0 0 0 1px var\(--louise-ring\)/,
    );
  });
});

describe("the chrome's text size", () => {
  it("sets every font size in rem, so it follows the browser's text size", () => {
    expect(styles).not.toMatch(/font-size:\s*[0-9.]+px/);
  });
});

describe("the chrome's language", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it("marks the node toolbar as English", () => {
    dispose = mountNodeChrome({
      resolve: () => null,
      onMove: () => {},
      onDelete: () => {},
      onAddSibling: () => {},
      onAddChild: () => {},
      onInspect: () => {},
    });
    expect(document.querySelector(".louise-chrome-toolbar")?.getAttribute("lang")).toBe("en");
  });
});

describe("the chrome's tokens (#603)", () => {
  // The rules after the `:root` block, comments and `${…}` interpolations out.
  const rules = styles
    .slice(styles.indexOf("}", styles.indexOf("--louise-font-body")))
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\$\{[^}]*\}/g, "");

  it("reads a role token for every color, never a literal", () => {
    expect(rules.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(rules.match(/rgba?\(/g) ?? []).toEqual([]);
  });

  it("sizes every piece of text from the type scale", () => {
    const sizes = [...rules.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    // A glyph box sizes its icon, not text, so it may sit above the scale.
    const offScale = sizes.filter(
      (v) =>
        !v.startsWith("var(--louise-text-") && !v.endsWith("em") && Number.parseFloat(v) < 1.0625,
    );
    expect(offScale).toEqual([]);
  });

  it("means danger and nothing else by orange", () => {
    expect(styles).toMatch(/--louise-danger:\s*var\(--louise-orange\)/);
    const orangeReaders = rules.match(/var\(--louise-orange[\w-]*\)/g) ?? [];
    expect(orangeReaders).toEqual([]);
  });
});

describe("the chrome in dark mode (#603)", () => {
  it("follows the system setting, and lets a page pin either scheme", async () => {
    const { injectStyles } = await import("../../src/client/styles.js");
    injectStyles();
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-louise-scheme="light"\]\) \{[^}]*--louise-surface: #0e141b;/,
    );
    expect(css).toMatch(/:root\[data-louise-scheme="dark"\] \{[^}]*--louise-surface: #0e141b;/);
  });
});

describe("touch targets (#543)", () => {
  const coarse = (source: string) =>
    /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";

  it.each([".louise-icon-btn", ".louise-tb-btn", ".louise-btn-xs", ".louise-bar-history"])(
    "gives %s at least 44 px under a coarse pointer",
    (selector) => {
      const rule = new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(coarse(styles))?.[1] ?? "";
      expect(rule).toMatch(/min-height: 44px/);
    },
  );

  it("gives the node toolbar's buttons 44 px, and delete room from its neighbors", () => {
    expect(coarse(chrome)).toMatch(/\.louise-chrome-btn \{ width: 44px; height: 44px; \}/);
    expect(chrome).toMatch(/\.louise-chrome-del \{ margin-inline: 6px; \}/);
    dispose = mountNodeChrome({
      resolve: () => null,
      onMove: () => {},
      onDelete: () => {},
      onAddSibling: () => {},
      onAddChild: () => {},
      onInspect: () => {},
    });
    const del = document.querySelector('.louise-chrome-toolbar button[aria-label="Delete"]');
    expect(del?.classList.contains("louise-chrome-del")).toBe(true);
  });

  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });
});
