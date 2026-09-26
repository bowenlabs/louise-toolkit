import { expect, it } from "vitest";
import { injectStyles } from "../../src/client/styles.js";

// The stack uses Phosphor icons and no emoji. The soft-lock badge is a
// pseudo-element, which can't hold an inline SVG, so its lock is a CSS image.
it("draws the soft-lock badge's lock from Phosphor, in the badge's white", () => {
  injectStyles();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const start = css.indexOf(".louise-editable.louise-locked::before");
  const rule = css.slice(start, css.indexOf("}", start));
  expect(rule).toContain("content: attr(data-louise-locked-by)");
  expect(rule).toContain('url("data:image/svg+xml,');
  expect(rule).toContain(encodeURIComponent('fill="#fff"'));
});
