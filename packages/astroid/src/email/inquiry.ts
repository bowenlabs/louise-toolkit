// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The inquiry pair, wired to the contact form.
//
// `formRoute` fires `onSubmit` AFTER the row is inserted and off the response
// path (`waitUntil`), which is exactly the store-and-forward shape this wants:
// the submission is already durable, so mail is a notification of something that
// already happened and can fail without the visitor ever knowing.
//
// Two messages, not one — every site converged on the pair. The owner needs the
// message; the visitor needs to know it arrived, because a contact form with no
// acknowledgement is indistinguishable from one that's broken.

import type { AstroidConfig } from "../config.js";
import type { EmailSender } from "./send.js";
import { type DeliveryResult, sendTransactional } from "./send.js";
import { inquiryConfirmationEmail, inquiryNotificationEmail } from "./templates.js";
import { astroidMailTheme, type MailThemeOverrides } from "./theme.js";

/** The bindings the inquiry hook reads. All optional — an unprovisioned mail
 *  setup logs instead of sending, per the dormant-until-provisioned convention. */
export interface AstroidMailEnv {
  /** Cloudflare Email Sending binding. */
  EMAIL?: EmailSender;
  /** Envelope sender; its domain must be onboarded for Email Sending. */
  MAIL_FROM?: string;
  /** Where owner notifications go. Also the first editor's address. */
  OWNER_EMAIL?: string;
}

/** Trimmed string, or undefined for anything else. */
const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
};

/**
 * Send the notify + confirm pair for one contact-form submission.
 *
 * Wire it into the generated worker's form route:
 *
 * ```ts
 * formRoute({ form: contactForm, onSubmit: (values, env) => sendInquiryMail(config, env, values) })
 * ```
 *
 * Each half is skipped when its recipient is unknown rather than failing the
 * batch: no `OWNER_EMAIL` means no notification to send, and a submission whose
 * email didn't validate still deserves to reach the owner.
 */
export async function sendInquiryMail(
  config: AstroidConfig,
  env: AstroidMailEnv,
  values: Record<string, unknown>,
  overrides?: MailThemeOverrides,
): Promise<DeliveryResult[]> {
  const theme = astroidMailTheme(config, overrides);
  const details = {
    name: [str(values.firstName), str(values.lastName)].filter(Boolean).join(" "),
    email: str(values.email) ?? "",
    regarding: str(values.regarding),
    message: str(values.message) ?? "",
  };

  const owner = str(env.OWNER_EMAIL);
  const from = str(env.MAIL_FROM);

  const mails = [
    ...(owner
      ? [
          {
            to: owner,
            content: inquiryNotificationEmail(theme, details),
            // So the owner can answer by hitting reply, rather than copying an
            // address out of the body.
            ...(details.email ? { replyTo: details.email } : {}),
          },
        ]
      : []),
    ...(details.email
      ? [{ to: details.email, content: inquiryConfirmationEmail(theme, details) }]
      : []),
  ];

  return sendTransactional(
    {
      binding: env.EMAIL,
      from: from ?? "noreply@localhost",
      // No sender address is as unconfigured as no binding — send nothing, log
      // everything, rather than hand the Email API a placeholder envelope.
      logOnly: !from,
    },
    mails,
  );
}
