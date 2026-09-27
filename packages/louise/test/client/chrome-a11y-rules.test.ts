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
      /\.louise-input:focus,[\s\S]*?box-shadow: 0 0 0 1px var\(--louise-blue\)/,
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
