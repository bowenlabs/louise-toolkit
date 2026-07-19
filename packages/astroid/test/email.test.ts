import { describe, expect, it, vi } from "vitest";
import type { AstroidConfig } from "../src/config.js";
import { sendTransactional } from "../src/email/send.js";
import {
  inquiryConfirmationEmail,
  inquiryNotificationEmail,
  magicLinkEmail,
  passwordResetEmail,
} from "../src/email/templates.js";
import { astroidMailTheme } from "../src/email/theme.js";

const config: AstroidConfig = {
  key: "acme",
  archetype: "storefront",
  theme: { name: "Acme Coffee", colors: { brand: "#1f6e6d" } },
};
const theme = astroidMailTheme(config);

/** WCAG relative luminance + contrast, recomputed here so the test doesn't
 *  simply re-run the implementation's own maths. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = rgb.map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("astroidMailTheme", () => {
  it("takes the brand name and colour from the config", () => {
    expect(theme.brand.name).toBe("Acme Coffee");
    expect(theme.palette.accent).toBe("#1f6e6d");
  });

  it("darkens a pale brand colour until the accent is legible on the card", () => {
    // A brand yellow used verbatim as 11px uppercase text on a near-white card
    // is unreadable, and mail clients have no dark-mode escape hatch.
    const pale = astroidMailTheme({
      ...config,
      theme: { name: "Sun", colors: { brand: "#ffe94d" } },
    });
    expect(contrast(pale.palette.accent, pale.palette.bg)).toBeGreaterThanOrEqual(4.5);
    // An already-legible colour is left alone.
    expect(theme.palette.accent).toBe("#1f6e6d");
  });

  it("always builds a five-cell band, however many brand colours exist", () => {
    const one = astroidMailTheme(config).band;
    const two = astroidMailTheme({
      ...config,
      theme: { name: "A", colors: { brand: "#1f6e6d", secondary: "#f7d2d2" } },
    }).band;
    const three = astroidMailTheme({
      ...config,
      theme: { name: "A", colors: { brand: "#1f6e6d", secondary: "#f7d2d2", tertiary: "#fbf3c7" } },
    }).band;
    for (const band of [one, two, three]) {
      expect(band).toHaveLength(5);
      for (const cell of band) expect(cell).toMatch(/^#[0-9a-f]{6}$/);
    }
    // With one colour it's a ramp: light lead, dark tail.
    expect(one[0]).not.toBe(one[4]);
    // Supplied colours appear verbatim rather than being re-derived.
    expect(three).toContain("#1f6e6d");
    expect(three).toContain("#f7d2d2");
  });

  it("falls back instead of throwing on a malformed brand colour", () => {
    // A bad hex in settings must not take out password reset.
    const broken = astroidMailTheme({
      ...config,
      theme: { name: "Broken", colors: { brand: "not-a-color" } },
    });
    expect(broken.palette.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(broken.band).toHaveLength(5);
  });

  it("lets a site override any slot", () => {
    const custom = astroidMailTheme(config, {
      palette: { accent: "#ff0000" },
      band: ["#000000"],
      brand: { footerLead: "Acme Coffee · Chicago" },
      buttonShape: "rounded",
    });
    expect(custom.palette.accent).toBe("#ff0000");
    expect(custom.band).toEqual(["#000000"]);
    expect(custom.brand.footerLead).toBe("Acme Coffee · Chicago");
    expect(custom.brand.name).toBe("Acme Coffee");
    expect(custom.buttonShape).toBe("rounded");
  });
});

describe("templates", () => {
  it("render HTML and plaintext from one definition, both carrying the link", () => {
    const url = "https://acme.coffee/api/auth/magic?token=abc";
    const mail = magicLinkEmail(theme, { url, toEmail: "editor@acme.coffee" });
    expect(mail.subject).toBe("Your sign-in link — Acme Coffee");
    expect(mail.html).toContain(url);
    // The plaintext body is what a terminal client shows and what the dev log
    // prints, so the link has to be in it.
    expect(mail.text).toContain(url);
    expect(mail.text).not.toContain("<");
  });

  it("uses the brand name, never a hardcoded one", () => {
    const other = astroidMailTheme({
      ...config,
      theme: { name: "Ghostfire", colors: { brand: "#fa824c" } },
    });
    const mail = passwordResetEmail(other, { url: "https://x/r", toEmail: "a@b.c" });
    expect(mail.subject).toContain("Ghostfire");
    expect(mail.html).toContain("Ghostfire");
    expect(mail.html).not.toContain("Acme");
  });

  it("escapes visitor-supplied values into the HTML body", () => {
    const mail = inquiryNotificationEmail(theme, {
      name: "<script>alert(1)</script>",
      email: "evil@example.com",
      message: "Line one\nLine two <b>bold</b>",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    // Line breaks survive as <br>, but the markup in them does not.
    expect(mail.html).toContain("Line one<br>Line two");
    expect(mail.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("collapses newlines out of the subject (header injection)", () => {
    const mail = inquiryNotificationEmail(theme, {
      name: "Jane\nBcc: victim@example.com",
      email: "jane@example.com",
      message: "hi",
    });
    expect(mail.subject).not.toContain("\n");
    expect(mail.subject).toBe("New inquiry from Jane Bcc: victim@example.com");
  });

  it("greets by given name only, and degrades when there isn't one", () => {
    expect(
      inquiryConfirmationEmail(theme, { name: "Jane Smith", email: "j@x.c", message: "hi" }).text,
    ).toContain("Hi Jane —");
    expect(
      inquiryConfirmationEmail(theme, { name: "   ", email: "j@x.c", message: "hi" }).text,
    ).toContain("Hi there —");
  });

  it("omits the regarding line when the form doesn't collect one", () => {
    const without = inquiryConfirmationEmail(theme, {
      name: "Jane",
      email: "j@x.c",
      message: "hi",
    });
    expect(without.html).not.toContain("Regarding:");
    const with_ = inquiryConfirmationEmail(theme, {
      name: "Jane",
      email: "j@x.c",
      regarding: "Wholesale",
      message: "hi",
    });
    expect(with_.html).toContain("Regarding:");
    expect(with_.text).toContain("Regarding: Wholesale");
  });
});

describe("sendTransactional", () => {
  const mail = (to: string) => ({
    to,
    content: { subject: `To ${to}`, html: "<p>hi</p>", text: "hi\nhttps://link" },
  });

  it("logs instead of sending when no binding is provisioned", async () => {
    const log = vi.fn();
    const results = await sendTransactional({ from: "a@b.c", log }, [mail("x@y.z")]);
    expect(results).toEqual([
      { to: "x@y.z", subject: "To x@y.z", delivered: false, reason: "not-configured" },
    ]);
    // The plaintext body is logged because that's where a sign-in link lives —
    // "click the magic link" is the whole local dev loop.
    expect(log.mock.calls[0][0]).toContain("https://link");
    expect(log.mock.calls[0][0]).toContain("not-configured");
  });

  it("sends via the binding and reports message ids", async () => {
    const send = vi.fn(async () => ({ messageId: "msg-1" }));
    const results = await sendTransactional({ binding: { send }, from: "a@b.c" }, [mail("x@y.z")]);
    expect(results[0]).toMatchObject({ delivered: true, messageId: "msg-1" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("passes replyTo through only when set", async () => {
    const send = vi.fn(async (_message: { to: string | string[]; replyTo?: string }) => ({
      messageId: "m",
    }));
    await sendTransactional({ binding: { send }, from: "a@b.c" }, [
      { ...mail("owner@acme.co"), replyTo: "visitor@example.com" },
      mail("visitor@example.com"),
    ]);
    expect(send.mock.calls[0][0]).toMatchObject({ replyTo: "visitor@example.com" });
    expect(send.mock.calls[1][0]).not.toHaveProperty("replyTo");
  });

  it("never rejects, and one failure doesn't take out the other message", async () => {
    // The owner's copy must still arrive when the visitor typo'd their address.
    const send = vi.fn(async (m: { to: string | string[] }) => {
      if (m.to === "bad@nowhere") throw new Error("550 unknown recipient");
      return { messageId: "ok" };
    });
    const results = await sendTransactional({ binding: { send }, from: "a@b.c" }, [
      mail("bad@nowhere"),
      mail("owner@acme.co"),
    ]);
    expect(results[0].delivered).toBe(false);
    expect(results[0].reason).toContain("bad@nowhere");
    expect(results[1].delivered).toBe(true);
  });

  it("honours logOnly even with a working binding", async () => {
    const send = vi.fn(async () => ({ messageId: "m" }));
    const log = vi.fn();
    const results = await sendTransactional(
      { binding: { send }, from: "a@b.c", logOnly: true, log },
      [mail("x@y.z")],
    );
    expect(send).not.toHaveBeenCalled();
    expect(results[0].reason).toBe("log-only");
    expect(log).toHaveBeenCalledOnce();
  });

  it("handles an empty batch", async () => {
    expect(await sendTransactional({ from: "a@b.c", log: () => {} }, [])).toEqual([]);
  });
});
