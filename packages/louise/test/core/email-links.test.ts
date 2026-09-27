import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  type MailTheme,
  mailButton,
  mailFallbackLink,
} from "../../src/core/email/index.js";

// #703: a link in an email may only be https, http, or mailto, and escaping
// covers single quotes too.

const c = "#000000";
const theme: MailTheme = {
  palette: {
    pageBg: c,
    bg: c,
    bgSoft: c,
    ink: c,
    inkSoft: c,
    inkMute: c,
    rule: c,
    ruleSoft: c,
    accent: c,
    onDark: c,
  },
  band: [c],
  fonts: { serif: "serif", sans: "sans-serif", mono: "monospace" },
  brand: { name: "Example Organization", footerLead: "Example Organization" },
};

describe("links in an email", () => {
  it("keeps https, http, and mailto links, escaped", () => {
    expect(mailButton(theme, { href: "https://example.com/a?b=1&c=2", label: "Open" })).toContain(
      'href="https://example.com/a?b=1&amp;c=2"',
    );
    expect(mailButton(theme, { href: "mailto:alex@example.com", label: "Write" })).toContain(
      'href="mailto:alex@example.com"',
    );
    expect(mailFallbackLink(theme, " http://example.com ")).toContain('href="http://example.com"');
  });

  it("drops the href for any other scheme, and still shows the text", () => {
    for (const url of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,x",
      "/relative",
    ]) {
      expect(mailButton(theme, { href: url, label: "Open" })).not.toContain("href=");
      expect(mailFallbackLink(theme, url)).not.toContain("href=");
    }
    expect(mailFallbackLink(theme, "javascript:alert(1)")).toContain(">javascript:alert(1)</a>");
  });
});

describe("escapeHtml", () => {
  it("escapes single quotes as well as the rest", () => {
    expect(escapeHtml(`<a href='x' title="y">&`)).toBe(
      "&lt;a href=&#39;x&#39; title=&quot;y&quot;&gt;&amp;",
    );
  });
});
