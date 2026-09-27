import { expect, it } from "vitest";
import { injectStyles } from "../../src/client/styles.js";

// The stack uses Phosphor icons and no emoji. The soft-lock badge is a text
// element (#597) whose lock is a CSS background image, so the text a screen
// reader hears is only the holder's name.
it("draws the soft-lock badge's lock from Phosphor, in the badge's white", () => {
  injectStyles();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const start = css.indexOf(".louise-lock-note {");
  const rule = css.slice(start, css.indexOf("}", start));
  expect(start).toBeGreaterThan(-1);
  expect(rule).toContain('url("data:image/svg+xml,');
  expect(rule).toContain(encodeURIComponent('fill="#fff"'));
});
