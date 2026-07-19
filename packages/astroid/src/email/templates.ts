// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The standard transactional set: sign-in link, password reset, and the
// inquiry pair (notify the owner, confirm to the sender).
//
// All three consuming sites wrote these four, with the same structure and
// near-identical copy — only the brand name differed, which is exactly what
// makes them first-party rather than site-side. The brand-agnostic *frame*
// (card, colour band, CTA button, paste-this-link fallback) already lives in
// `louise-toolkit/email`; this file owns the wording and the layout inside it.
//
// Every template returns HTML **and** plaintext from one definition. The text
// alternative is not decoration: a message with no text/plain part scores worse
// with spam filters, and for a sign-in link the plaintext body is what a
// terminal-based or accessibility client actually shows.
//
// Escaping is the other constant: every value that reaches these functions came
// from a form or a database, and it lands inside an HTML document.

import {
  escapeHtml,
  escapeMultiline,
  type MailContent,
  mailButton,
  mailFallbackLink,
  type MailTheme,
  renderEmailShell,
  subjectSafe,
} from "louise-toolkit/email";

export type { MailContent, MailTheme };

/** Body paragraph in the theme's sans stack. */
const p = (theme: MailTheme, html: string, opts: { muted?: boolean; margin?: string } = {}) =>
  `<p style="font-family:${theme.fonts.sans};font-size:${opts.muted ? "15px" : "16px"};line-height:1.6;color:${
    opts.muted ? theme.palette.inkMute : theme.palette.inkSoft
  };margin:${opts.margin ?? "0 0 12px"};">${html}</p>`;

/** Small uppercase mono label. */
const label = (theme: MailTheme, text: string, margin = "0 0 10px") =>
  `<p style="font-family:${theme.fonts.mono};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${theme.palette.inkMute};margin:${margin};">${text}</p>`;

/** A quoted block for user-authored text (a message body). */
const quote = (theme: MailTheme, text: string) =>
  `<div style="font-family:${theme.fonts.sans};font-size:15px;line-height:1.65;color:${theme.palette.ink};padding:16px 18px;background:${theme.palette.bgSoft};border:1px solid ${theme.palette.rule};border-radius:6px;">${escapeMultiline(text)}</div>`;

/**
 * A one-time link email — the shared shape behind sign-in and password reset.
 * Both are "here is a URL, it expires, ignore this if it wasn't you", and the
 * only differences are the words.
 */
function linkEmail(
  theme: MailTheme,
  opts: {
    subject: string;
    title: string;
    preheader: string;
    eyebrow: string;
    headline: string;
    lead: string;
    expiry: string;
    buttonLabel: string;
    url: string;
    toEmail: string;
    disclaimer: string;
    footerNote: string;
    textLead: string;
  },
): MailContent {
  const bodyHtml = [
    p(theme, opts.lead),
    p(
      theme,
      `This link expires in <strong style="color:${theme.palette.ink};font-weight:600;">${opts.expiry}</strong> and can only be used once.`,
      { muted: true, margin: "0 0 30px" },
    ),
    mailButton(theme, { href: opts.url, label: `${opts.buttonLabel} &rarr;` }),
    mailFallbackLink(theme, opts.url),
    p(theme, opts.disclaimer, { muted: true, margin: "26px 0 0" }),
  ].join("\n");

  return {
    subject: opts.subject,
    html: renderEmailShell(theme, {
      title: opts.title,
      preheader: opts.preheader,
      eyebrow: opts.eyebrow,
      headline: opts.headline,
      bodyHtml,
      footerNote: `Sent to ${escapeHtml(opts.toEmail)} &middot; ${opts.footerNote}`,
    }),
    text: [
      opts.headline.replace(/&[a-z]+;/g, "'"),
      "",
      opts.textLead,
      `It expires in ${opts.expiry} and can only be used once.`,
      "",
      opts.url,
      "",
      opts.disclaimer.replace(/&[a-z]+;/g, "'").replace(/<[^>]+>/g, ""),
    ].join("\n"),
  };
}

/** Editor sign-in magic link. */
export function magicLinkEmail(
  theme: MailTheme,
  params: { url: string; toEmail: string },
): MailContent {
  const brand = theme.brand.name;
  return linkEmail(theme, {
    subject: `Your sign-in link — ${brand}`,
    title: "Your sign-in link",
    preheader: "Your one-time sign-in link — expires in 15 minutes.",
    eyebrow: "Sign in",
    headline: "Here&rsquo;s your magic link.",
    lead: `Use the button below to sign in to ${escapeHtml(brand)}. No password needed.`,
    expiry: "15 minutes",
    buttonLabel: "Sign in",
    url: params.url,
    toEmail: params.toEmail,
    disclaimer: "If you didn&rsquo;t request this, you can safely ignore this email.",
    footerNote: "Automated sign-in message.",
    textLead: `Use this link to sign in to ${brand} — no password needed.`,
  });
}

/** Password-reset link (the portal's credential flow). */
export function passwordResetEmail(
  theme: MailTheme,
  params: { url: string; toEmail: string },
): MailContent {
  const brand = theme.brand.name;
  return linkEmail(theme, {
    subject: `Reset your password — ${brand}`,
    title: "Reset your password",
    preheader: "Reset your password — this link expires in 1 hour.",
    eyebrow: "Password reset",
    headline: "Reset your password.",
    lead: `We got a request to reset the password on your ${escapeHtml(brand)} account. Use the button below to choose a new one.`,
    expiry: "1 hour",
    buttonLabel: "Reset your password",
    url: params.url,
    toEmail: params.toEmail,
    disclaimer:
      "If you didn&rsquo;t request this, you can safely ignore this email &mdash; your password won&rsquo;t change.",
    footerNote: "Automated account message.",
    textLead: `We got a request to reset the password on your ${brand} account. Use this link to choose a new one.`,
  });
}

/** The fields an inquiry contributes to both halves of the pair. */
export interface InquiryDetails {
  name: string;
  email: string;
  /** Subject line the visitor picked, if the form offers one. */
  regarding?: string;
  message: string;
}

/** Owner-facing notification for a new contact-form submission. */
export function inquiryNotificationEmail(theme: MailTheme, i: InquiryDetails): MailContent {
  const { palette: c, fonts: f } = theme;
  const name = i.name.trim() || "Someone";
  const safeEmail = escapeHtml(i.email);
  const row = (k: string, v: string) =>
    `<tr>
<td style="padding:10px 0;border-bottom:1px solid ${c.ruleSoft};font-family:${f.mono};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${c.inkMute};white-space:nowrap;vertical-align:top;width:96px;">${k}</td>
<td style="padding:10px 0 10px 16px;border-bottom:1px solid ${c.ruleSoft};font-family:${f.sans};font-size:15px;line-height:1.55;color:${c.ink};">${v}</td>
</tr>`;

  const bodyHtml = [
    p(theme, "A new message just came in through the contact form.", { margin: "0 0 24px" }),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
${row("From", escapeHtml(name))}
${row("Email", `<a href="mailto:${safeEmail}" style="color:${c.accent};text-decoration:none;">${safeEmail}</a>`)}
${i.regarding?.trim() ? row("Regarding", escapeHtml(i.regarding.trim())) : ""}
</table>`,
    label(theme, "Message"),
    quote(theme, i.message),
    p(theme, `Just reply to this email to respond to ${escapeHtml(name)} directly.`, {
      muted: true,
      margin: "24px 0 0",
    }),
  ].join("\n");

  return {
    // `subjectSafe` collapses newlines: a name field is visitor-supplied, and a
    // newline in a Subject header is a header-injection primitive.
    subject: subjectSafe(`New inquiry from ${name}`),
    html: renderEmailShell(theme, {
      title: "New inquiry",
      preheader: escapeHtml(`${name} — ${i.regarding?.trim() || "New inquiry"}`),
      eyebrow: "New inquiry",
      headline: "You&rsquo;ve got a new message.",
      bodyHtml,
      footerNote: `Reply goes to ${safeEmail} &middot; Automated notification.`,
    }),
    text: [
      "New inquiry",
      "",
      `From: ${name}`,
      `Email: ${i.email}`,
      ...(i.regarding?.trim() ? [`Regarding: ${i.regarding.trim()}`] : []),
      "",
      "Message:",
      i.message,
    ].join("\n"),
  };
}

/** Confirmation back to whoever submitted the contact form. */
export function inquiryConfirmationEmail(theme: MailTheme, i: InquiryDetails): MailContent {
  const brand = theme.brand.name;
  // Only the given name — "Hi Jane Smith" reads like a form letter, which is
  // precisely what this is trying not to.
  const first = i.name.trim().split(/\s+/)[0] || "there";

  const bodyHtml = [
    p(
      theme,
      `Hi ${escapeHtml(first)} &mdash; thanks for reaching out. Your message has landed, and we answer personally, usually within a business day or two.`,
    ),
    i.regarding?.trim()
      ? p(
          theme,
          `Regarding: <strong style="color:${theme.palette.ink};font-weight:600;">${escapeHtml(i.regarding.trim())}</strong>`,
          { muted: true, margin: "0 0 24px" },
        )
      : "",
    label(theme, "Your message"),
    quote(theme, i.message),
    p(theme, "No need to reply &mdash; this is just a confirmation that yours came through.", {
      muted: true,
      margin: "24px 0 0",
    }),
  ].join("\n");

  return {
    subject: `Thanks for your message — ${brand}`,
    html: renderEmailShell(theme, {
      title: "We got your message",
      preheader: "Thanks for reaching out — we answer personally, usually within a day or two.",
      eyebrow: escapeHtml(brand),
      headline: "Thanks &mdash; we&rsquo;ve got your message.",
      bodyHtml,
      footerNote: "Automated confirmation &middot; No reply needed.",
    }),
    text: [
      `Hi ${first} — thanks for reaching out.`,
      "",
      "Your message has landed, and we answer personally, usually within a business day or two.",
      ...(i.regarding?.trim() ? ["", `Regarding: ${i.regarding.trim()}`] : []),
      "",
      "Your message:",
      i.message,
    ].join("\n"),
  };
}
