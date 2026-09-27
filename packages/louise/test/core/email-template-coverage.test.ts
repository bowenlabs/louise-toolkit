// core/email/template—escaping helpers, the button and fallback-link blocks,
// and the email shell (#695).
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  escapeMultiline,
  mailButton,
  mailFallbackLink,
  type MailTheme,
  renderEmailShell,
  subjectSafe,
} from "../../src/core/email/template.js";

const theme: MailTheme = {
  palette: {
    pageBg: "#eeeeee",
    bg: "#ffffff",
    bgSoft: "#f5f5f5",
    ink: "#111111",
    inkSoft: "#333333",
    inkMute: "#777777",
    rule: "#dddddd",
    ruleSoft: "#e5e5e5",
    accent: "#0055aa",
    onDark: "#fafafa",
  },
  band: ["#aa0000", "#00aa00", "#0000aa"],
  fonts: { serif: "Georgia, serif", sans: "Arial, sans-serif", mono: "Courier, monospace" },
  brand: { name: "Example Organization", footerLead: "Example Organization · Open daily" },
};

describe("escapeHtml", () => {
  it("escapes ampersands, angle brackets, and double quotes", () => {
    expect(escapeHtml(`<a href="x">Alex & Kai</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Alex &amp; Kai&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first so an entity isn't double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("escapeMultiline", () => {
  it("escapes the text and turns LF and CRLF line breaks into <br>", () => {
    expect(escapeMultiline("Hi <Quinn>\r\nLine two\nLine three")).toBe(
      "Hi &lt;Quinn&gt;<br>Line two<br>Line three",
    );
  });
});

describe("subjectSafe", () => {
  it("collapses whitespace, including header-injection newlines, and trims", () => {
    expect(subjectSafe("  Order\r\nBcc: kai@example.com\t now ")).toBe(
      "Order Bcc: kai@example.com now",
    );
  });
});

describe("mailButton", () => {
  it("renders a rounded mono button by default and escapes the href", () => {
    const html = mailButton(theme, {
      href: 'https://example.com/?a=1&b="2"',
      label: "Open &rarr;",
    });
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
    expect(html).not.toContain('b="2"');
    expect(html).toContain("border-radius:6px");
    expect(html).toContain("font-family:Courier, monospace");
    expect(html).toContain("font-size:11px");
    expect(html).toContain("padding:16px 34px");
    expect(html).toContain("background:#111111");
    expect(html).toContain("color:#ffffff");
    // The label is trusted HTML, so the entity passes through untouched.
    expect(html).toContain(">Open &rarr;</a>");
  });

  it("renders a pill when the option asks for one", () => {
    const html = mailButton(theme, { href: "https://example.com", label: "Go", shape: "pill" });
    expect(html).toContain("border-radius:999px");
    expect(html).toContain("font-family:Arial, sans-serif");
    expect(html).toContain("font-size:13px");
    expect(html).toContain("letter-spacing:0.1em");
    expect(html).toContain("padding:15px 32px");
  });

  it("uses the theme's default shape and radius", () => {
    const pill = mailButton(
      { ...theme, buttonShape: "pill" },
      { href: "https://example.com", label: "Go" },
    );
    expect(pill).toContain("border-radius:999px");
    const rounded = mailButton(
      { ...theme, radius: 12 },
      { href: "https://example.com", label: "Go" },
    );
    expect(rounded).toContain("border-radius:12px");
    expect(rounded).toContain("letter-spacing:0.12em");
  });

  it("lets a per-button shape override the theme's", () => {
    const html = mailButton(
      { ...theme, buttonShape: "pill" },
      { href: "https://example.com", label: "Go", shape: "rounded" },
    );
    expect(html).toContain("border-radius:6px");
  });
});

describe("mailFallbackLink", () => {
  it("escapes the URL in both the href and the visible text", () => {
    const html = mailFallbackLink(theme, "https://example.com/verify?t=<x>&u=1");
    const escaped = "https://example.com/verify?t=&lt;x&gt;&amp;u=1";
    expect(html).toContain(`href="${escaped}"`);
    expect(html).toContain(`>${escaped}</a>`);
    expect(html).not.toContain("<x>");
    expect(html).toContain("Button not working? Paste this link");
    expect(html).toContain("border-top:1px solid #e5e5e5");
    expect(html).toContain("color:#0055aa");
  });
});

describe("renderEmailShell", () => {
  const opts = {
    title: "Your order",
    preheader: "Thanks, Alex",
    eyebrow: "Order &middot; 42",
    headline: "It's on its way",
    bodyHtml: "<p>Body copy</p>",
    footerNote: "Sent to alex@example.com",
  };

  it("places each slot and the brand into the document", () => {
    const html = renderEmailShell(theme, opts);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Your order</title>");
    expect(html).toContain(">Thanks, Alex</div>");
    expect(html).toContain(">Order &middot; 42</p>");
    expect(html).toContain(">It's on its way</h1>");
    expect(html).toContain("<p>Body copy</p>");
    expect(html).toContain(">Example Organization</span>");
    expect(html).toContain(">Example Organization · Open daily</p>");
    expect(html).toContain(">Sent to alex@example.com</p>");
  });

  it("renders one equal-width band cell per colour with default tokens", () => {
    const html = renderEmailShell(theme, opts);
    const cells = html.match(/<td width="33%" style="background:#[0-9a-f]{6};height:116px;/g);
    expect(cells).toHaveLength(3);
    expect(html).toContain("background:#aa0000");
    expect(html).toContain("border-radius:6px");
    expect(html).toContain("margin-top:-46px");
    expect(html).toContain("font-size:22px");
    expect(html).toContain("text-shadow:0 1px 6px rgba(28,22,14,0.5)");
  });

  it("honors overridden layout tokens", () => {
    const html = renderEmailShell(
      {
        ...theme,
        band: ["#123456", "#654321"],
        radius: 0,
        bandHeight: 80,
        brandSize: 30,
        brandOffset: -20,
        brandShadow: "none",
      },
      opts,
    );
    expect(html).toContain('<td width="50%" style="background:#123456;height:80px;');
    expect(html).toContain("border-radius:0px");
    expect(html).toContain("margin-top:-20px");
    expect(html).toContain("font-size:30px");
    expect(html).toContain("text-shadow:none");
  });

  it("passes slot HTML through as given, so callers escape user values first", () => {
    const name = "<b>Kai</b>";
    const raw = renderEmailShell(theme, { ...opts, preheader: name });
    expect(raw).toContain("<b>Kai</b>");
    const safe = renderEmailShell(theme, { ...opts, preheader: escapeHtml(name) });
    expect(safe).toContain("&lt;b&gt;Kai&lt;/b&gt;");
    expect(safe).not.toContain("<b>Kai</b>");
  });
});
