// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms—submission notifications (issue #46, Tier 3). A form declares
// where a submission is announced (`notify.webhook` / `notify.email`); `formRoute`
// fires these after a successful insert, off the response path (waitUntil). The
// email transport is the site's (a `FormMailer`), so Louise stays decoupled from
// any one email binding.

import { reportFallback } from "../degraded.js";
import { fetchPublicUrl } from "../security/public-url.js";
import type { FormConfig, FormMailer } from "./types.js";

/** Render a submission as a plain-text `key: value` block for an email/webhook. */
export function renderSubmissionText(config: FormConfig, values: Record<string, unknown>): string {
  return Object.entries(config.fields)
    .map(([key, field]) => `${field.label}: ${values[key] == null ? "" : String(values[key])}`)
    .join("\n");
}

/**
 * Fire a form's declared notifications for a submission. The webhook POSTs
 * `{ form, values }`; the email uses the site-supplied `mailer`. Errors are
 * reported with `reportFallback` and otherwise swallowed (a notification
 * failure must never fail the submission the visitor already completed)—the
 * caller runs this via `ctx.waitUntil`.
 */
export async function notifySubmission(
  config: FormConfig,
  values: Record<string, unknown>,
  mailer?: FormMailer,
): Promise<void> {
  const notify = config.notify;
  if (!notify) return;

  const jobs: Promise<unknown>[] = [];
  if (notify.webhook) {
    // `fetchPublicUrl`: the target is in a form config a site can edit, so it
    // gets the public-URL policy and a timeout, like any URL someone else chose.
    jobs.push(
      fetchPublicUrl(notify.webhook, {
        provider: "Form webhook",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form: config.name, values }),
      }).catch((err: unknown) => {
        reportFallback("forms.notify.webhook", err, { form: config.name });
      }),
    );
  }
  if (notify.email && mailer) {
    const subject = notify.email.subject ?? `New ${config.name} submission`;
    jobs.push(
      Promise.resolve(
        mailer({ to: notify.email.to, subject, text: renderSubmissionText(config, values) }),
      ).catch((err: unknown) => {
        reportFallback("forms.notify.email", err, { form: config.name });
      }),
    );
  }
  await Promise.all(jobs);
}

/** Which silent heuristic held a submission. */
export type SpamVerdict = "honeypot" | "too-fast";

/**
 * Run the silent anti-spam heuristics on the raw body: a filled honeypot field,
 * or a submit sooner than `spam.minSeconds` after the render helper's
 * `louise_ts` stamp. Returns which one fired, or `null` when neither did. A
 * missing timestamp isn't a bot: a plain HTML form without the render helper
 * doesn't stamp one.
 *
 * A browser or password manager can fill a honeypot a person never sees, so a
 * verdict isn't proof of a bot. `formRoute` logs each one (or hands it to
 * `onSpam`) rather than dropping it without a trace.
 */
export function spamVerdict(config: FormConfig, body: Record<string, unknown>): SpamVerdict | null {
  const spam = config.spam;
  if (!spam) return null;
  if (spam.honeypot) {
    const v = body[spam.honeypot];
    if (typeof v === "string" && v.trim() !== "") return "honeypot";
  }
  if (spam.minSeconds) {
    const ts = Number(body.louise_ts);
    if (Number.isFinite(ts) && ts > 0 && (Date.now() - ts) / 1000 < spam.minSeconds) {
      return "too-fast";
    }
  }
  return null;
}

/** Whether {@link spamVerdict} holds the submission. The route answers a
 *  held submission with a fake success, so a bot can't tune. */
export function looksLikeSpam(config: FormConfig, body: Record<string, unknown>): boolean {
  return spamVerdict(config, body) !== null;
}
