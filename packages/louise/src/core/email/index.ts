// louise/email — Cloudflare Email Service (transactional Email Sending).
//
// Uses the modern object-form binding API — env.EMAIL.send({to, from,
// subject, html, text}) → {messageId} — NOT the legacy cloudflare:email
// EmailMessage/mimetext path, which routes through Email Routing and can
// only deliver to *verified* destination addresses. Email Sending delivers
// to any recipient once the `from` domain is onboarded
// (`wrangler email sending enable <domain>`).

import { LouiseEmailError } from "../errors.js";

// Transactional-email templating (the brand-agnostic frame + helpers). Sites
// supply a MailTheme and compose each email from these; sending stays below.
export * from "./template.js";

/** Modern Email Sending binding shape (kept local so the module doesn't
 * depend on a specific @cloudflare/workers-types version's `SendEmail`). */
export interface EmailSender {
  send(message: {
    to: string | string[];
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
}

export interface SendEmailInput {
  from: string | { email: string; name?: string };
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text alternative. Derived from `html` when omitted (spam-score hygiene). */
  text?: string;
  replyTo?: string;
}

/** Very small HTML→text fallback for the text/plain alternative. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sends a transactional email via the Cloudflare Email Sending binding. */
export async function sendEmail(
  binding: EmailSender,
  input: SendEmailInput,
): Promise<{ messageId: string }> {
  try {
    return await binding.send({
      to: input.to,
      from: input.from,
      subject: input.subject,
      html: input.html,
      text: input.text ?? htmlToText(input.html),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
  } catch (cause) {
    throw new LouiseEmailError(`Failed to send email to "${input.to}"`, cause);
  }
}
