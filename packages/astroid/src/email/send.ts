// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Best-effort delivery.
//
// Transactional mail in this stack is always store-and-forward: the inquiry row
// is already in D1, the account already exists. Mail is the *notification* of
// something that happened, so a mail failure must never fail the request that
// caused it — and never throw into a `waitUntil` where it becomes an unhandled
// rejection. Every path here resolves.
//
// The second job is the dev story. There is no EMAIL binding under `wrangler
// dev`, and the single most common local task is "click the magic link" — so an
// unconfigured mailer LOGS the message instead of silently dropping it, and it
// logs the plaintext body, which is where the link is. That is the whole reason
// every template renders a text alternative.
//
// This is the email module's half of the dormant-until-provisioned convention:
// no binding means dormant and loudly simulated, not broken.

import type { EmailSender, MailContent } from "louise-toolkit/email";
import { sendEmail } from "louise-toolkit/email";

export type { EmailSender };

/** One message queued for delivery. */
export interface OutgoingMail {
  to: string;
  content: MailContent;
  /** Reply-To — for an inquiry notification, the visitor's own address, so the
   *  owner can just hit reply. */
  replyTo?: string;
}

/** What happened to one message. Never an exception. */
export interface DeliveryResult {
  to: string;
  subject: string;
  delivered: boolean;
  messageId?: string;
  /** Why it wasn't delivered — `"not-configured"`, `"log-only"`, or the error. */
  reason?: string;
}

export interface MailerOptions {
  /**
   * The Cloudflare Email Sending binding. Absent or null → the mailer is
   * dormant: messages are logged, and every result comes back
   * `delivered: false, reason: "not-configured"`.
   */
  binding?: EmailSender | null;
  /** Envelope sender. Its domain must be onboarded for Email Sending. */
  from: string | { email: string; name?: string };
  /** Log instead of sending even when a binding exists (a dry run). */
  logOnly?: boolean;
  /** Sink for the dev log. Defaults to `console.info`; pass one in a test. */
  log?: (message: string) => void;
}

/** The console rendering of an unsent message — subject, recipient, and the
 *  plaintext body, because that's where a sign-in link actually is. */
function describe(mail: OutgoingMail, reason: string): string {
  return [
    `[astroid:email] ${reason} — not sent`,
    `  to:      ${mail.to}`,
    `  subject: ${mail.content.subject}`,
    "  ---",
    ...mail.content.text.split("\n").map((line) => `  ${line}`),
    "  ---",
  ].join("\n");
}

/**
 * Send a batch of transactional messages, best effort.
 *
 * Delivery runs concurrently and independently: an inquiry sends a notification
 * to the owner and a confirmation to the visitor, and the owner's copy must
 * still arrive when the visitor typo'd their address. Callers get a result per
 * message and decide whether to care.
 *
 * ```ts
 * const results = await sendTransactional(
 *   { binding: env.EMAIL, from: env.MAIL_FROM },
 *   [
 *     { to: owner, content: inquiryNotificationEmail(theme, i), replyTo: i.email },
 *     { to: i.email, content: inquiryConfirmationEmail(theme, i) },
 *   ],
 * );
 * ```
 */
export async function sendTransactional(
  options: MailerOptions,
  mails: OutgoingMail[],
): Promise<DeliveryResult[]> {
  const log = options.log ?? ((message: string) => console.info(message));
  const dormant = !options.binding || options.logOnly;

  if (dormant) {
    const reason = options.binding ? "log-only" : "not-configured";
    for (const mail of mails) log(describe(mail, reason));
    return mails.map((mail) => ({
      to: mail.to,
      subject: mail.content.subject,
      delivered: false,
      reason,
    }));
  }

  const binding = options.binding as EmailSender;
  const settled = await Promise.allSettled(
    mails.map((mail) =>
      sendEmail(binding, {
        from: options.from,
        to: mail.to,
        subject: mail.content.subject,
        html: mail.content.html,
        text: mail.content.text,
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      }),
    ),
  );

  return settled.map((result, i) => {
    const mail = mails[i];
    if (result.status === "fulfilled") {
      return {
        to: mail.to,
        subject: mail.content.subject,
        delivered: true,
        messageId: result.value.messageId,
      };
    }
    return {
      to: mail.to,
      subject: mail.content.subject,
      delivered: false,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

/**
 * Bind a mailer's options once so call sites read as `mailer([...])`. Useful
 * where the binding and sender are resolved per request but the sends are
 * scattered (an inquiry hook, an auth callback).
 */
export function createMailer(options: MailerOptions) {
  return (mails: OutgoingMail[]) => sendTransactional(options, mails);
}
