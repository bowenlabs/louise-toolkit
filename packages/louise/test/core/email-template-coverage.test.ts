// core/email/template—escaping helpers, the button and fallback-link blocks,
// and the email shell (#695).
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  escapeMultiline,
  mailButton,
  mailFallbackLink,
  mailRows,
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

describe("renderEmailShell — fluid card and the logo masthead", () => {
  const opts = {
    title: "Your order",
    preheader: "Thanks, Alex",
    eyebrow: "Order &middot; 42",
    headline: "It's on its way",
    bodyHtml: "<p>Body copy</p>",
    footerNote: "Sent to alex@example.com",
  };
  const logo = { src: "https://example.com/logo.png", width: 160, height: 44 };

  it("renders a fluid card with a fixed table for Outlook", () => {
    const html = renderEmailShell(theme, opts);
    expect(html).toContain(
      'width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;',
    );
    expect(html).not.toContain('width="600" cellpadding="0" cellspacing="0" style="width:600px');
    expect(html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
  });

  it("omits the eyebrow when it's empty", () => {
    expect(renderEmailShell(theme, opts)).toContain(">Order &middot; 42</p>");
    const html = renderEmailShell(theme, { ...opts, eyebrow: "" });
    expect(html).not.toContain("letter-spacing:0.16em");
    expect(html).toContain(">It's on its way</h1>");
  });

  it("draws a solid band with the logo image, sized and described, and centres the footer", () => {
    const html = renderEmailShell({ ...theme, masthead: "logo", logo }, opts);
    expect(html).toContain(
      '<img src="https://example.com/logo.png" alt="Example Organization" width="160" height="44"',
    );
    expect(html).toContain("width:160px;height:44px;");
    expect(html).toContain('align="center" style="padding:22px 40px;background:#111111;');
    expect(html).not.toContain("height:116px");
    expect(html).not.toContain("text-shadow:");
    expect(html).toContain('text-align:center;">\n<p');
  });

  it("takes the logo's own alt text and masthead fill, escaped", () => {
    const html = renderEmailShell(
      { ...theme, masthead: "logo", mastheadBg: "#222222", logo: { ...logo, alt: 'Kai & "Co"' } },
      opts,
    );
    expect(html).toContain('alt="Kai &amp; &quot;Co&quot;"');
    expect(html).toContain("background:#222222;");
  });

  it("falls back to the wordmark without a logo, or with a src that isn't http(s)", () => {
    const text = renderEmailShell({ ...theme, masthead: "logo" }, opts);
    expect(text).not.toContain("<img");
    expect(text).toContain('color:#fafafa;">Example Organization</span>');
    const unsafe = renderEmailShell(
      { ...theme, masthead: "logo", logo: { ...logo, src: "javascript:alert(1)" } },
      opts,
    );
    expect(unsafe).not.toContain("<img");
    expect(unsafe).not.toContain("javascript:");
  });

  it("keeps the band masthead and a left footer by default", () => {
    const html = renderEmailShell(theme, opts);
    expect(html).toContain("height:116px");
    expect(html).toContain("text-align:left;");
    expect(html).not.toContain("<img");
  });

  it("swaps the border for a shadow, and sizes the headline and padding from the theme", () => {
    const html = renderEmailShell(
      {
        ...theme,
        shadow: "0 6px 20px rgba(0,0,0,0.08)",
        headlineSize: 24,
        headlineWeight: 600,
        contentPadding: 32,
      },
      opts,
    );
    expect(html).toContain("box-shadow:0 6px 20px rgba(0,0,0,0.08);border-radius:6px");
    expect(html).not.toContain("border:1px solid #dddddd;border-radius");
    expect(html).toContain("font-weight:600;font-size:24px;line-height:1.1");
    expect(html).toContain("padding:40px 32px 36px;");
    expect(html).toContain("padding:24px 32px 30px;");
    const plain = renderEmailShell(theme, opts);
    expect(plain).toContain("border:1px solid #dddddd;border-radius:6px");
    expect(plain).toContain("font-weight:400;font-size:32px;");
    expect(plain).toContain("padding:40px 40px 36px;");
  });
});

describe("mailButton alignment", () => {
  it("is left by default and centres on request, by theme or by button", () => {
    const left = mailButton(theme, { href: "https://example.com", label: "Go" });
    expect(left).toContain('<table role="presentation" cellpadding="0" cellspacing="0"><tr>');
    const byTheme = mailButton(
      { ...theme, buttonAlign: "center" },
      { href: "https://example.com", label: "Go" },
    );
    expect(byTheme).toContain('cellspacing="0" align="center" style="margin:0 auto;"><tr>');
    const byButton = mailButton(theme, {
      href: "https://example.com",
      label: "Go",
      align: "center",
    });
    expect(byButton).toContain('align="center" style="margin:0 auto;"');
    const backToLeft = mailButton(
      { ...theme, buttonAlign: "center" },
      { href: "https://example.com", label: "Go", align: "left" },
    );
    expect(backToLeft).not.toContain('align="center"');
  });
});

describe("mailRows", () => {
  it("renders each label and value as a two-column line in a soft box", () => {
    const html = mailRows({ ...theme, radius: 18 }, [
      { label: "Order", value: "42 &middot; 2 bags" },
      { label: "Total", value: "$30.00" },
    ]);
    expect(html).toContain("background:#f5f5f5;border:1px solid #dddddd;border-radius:14px;");
    expect(html).toContain('color:#777777;">Order</td><td align="right"');
    expect(html).toContain(
      'color:#111111;font-weight:600;text-align:right;">42 &middot; 2 bags</td>',
    );
    expect(html).toContain(">$30.00</td>");
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(mailRows(theme, [])).not.toContain('<tr><td style="padding:5px 0;');
  });
});
