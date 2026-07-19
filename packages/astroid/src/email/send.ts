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
import { type ModuleSecrets, resolveModuleSecrets, type SecretSource } from "../secrets.js";

export type { EmailSender };

/**
 * The secrets the mailer needs. Just the envelope sender: the EMAIL binding is a
 * binding, not a secret, so it's gated by presence rather than by value.
 *
 * Named here so `astroid doctor` and the scaffold's `.dev.vars` seed read the
 * same list the runtime gate does.
 */
export const EMAIL_SECRET_NAMES = ["MAIL_FROM"] as const;

/**
 * The mailer's resolved gate. Deliberately NOT `ModuleSecrets<"MAIL_FROM">`:
 * `missing` here can name `EMAIL`, which is a binding rather than a secret, so
 * the key type is widened to plain strings.
 */
export interface MailerStatus {
  /** True only when a binding AND a real sender address are both present. */
  configured: boolean;
  values: ModuleSecrets<"MAIL_FROM">["values"];
  /** What's unprovisioned — secret names and/or `"EMAIL"`. */
  missing: string[];
  /** Whether an Email Sending binding is present at all. */
  hasBinding: boolean;
}

/** The env members the mailer reads. Structural, so a project's env fits. */
export interface MailerEnv {
  EMAIL?: EmailSender | null;
  MAIL_FROM?: SecretSource;
}

/**
 * Resolve the email module's dormancy.
 *
 * Both halves are required, and for the same reason: a binding with no sender
 * address can't build an envelope, and a sender address with no binding has
 * nothing to send through. Either one missing means log-and-continue, which
 * under `wrangler dev` (no EMAIL binding at all) is the normal case — and the
 * reason the magic-link flow is still workable locally.
 */
export async function resolveMailerStatus(env: MailerEnv): Promise<MailerStatus> {
  const secrets = await resolveModuleSecrets({ MAIL_FROM: env.MAIL_FROM });
  const hasBinding = Boolean(env.EMAIL);
  return {
    configured: secrets.configured && hasBinding,
    values: secrets.values,
    missing: hasBinding ? [...secrets.missing] : [...secrets.missing, "EMAIL"],
    hasBinding,
  };
}

/**
 * Build `MailerOptions` from an env, with dormancy already decided.
 *
 * The point of routing through {@link resolveMailerStatus} rather than checking
 * `!env.EMAIL` inline is that the placeholder sentinel counts: a scaffold seeds
 * `MAIL_FROM=DUMMY_REPLACE_ME`, and handing that to the Email API as an
 * envelope sender is exactly the "called upstream with a dummy credential"
 * failure the convention exists to prevent.
 */
export async function resolveMailer(
  env: MailerEnv,
  overrides: Partial<Omit<MailerOptions, "binding" | "from">> = {},
): Promise<MailerOptions & { status: MailerStatus }> {
  const status = await resolveMailerStatus(env);
  return {
    ...overrides,
    binding: env.EMAIL ?? null,
    from: status.values.MAIL_FROM ?? "noreply@localhost",
    logOnly: overrides.logOnly || !status.configured,
    status,
  };
}

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
