// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/forms — submission notifications (issue #46, Tier 3). A form declares
// where a submission is announced (`notify.webhook` / `notify.email`); `formRoute`
// fires these after a successful insert, off the response path (waitUntil). The
// email transport is the site's (a `FormMailer`), so Louise stays decoupled from
// any one email binding.

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
 * swallowed (a notification failure must never fail the submission the visitor
 * already completed) — the caller runs this via `ctx.waitUntil`.
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
    jobs.push(
      fetch(notify.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form: config.name, values }),
      }).catch(() => undefined),
    );
  }
  if (notify.email && mailer) {
    const subject = notify.email.subject ?? `New ${config.name} submission`;
    jobs.push(
      Promise.resolve(
        mailer({ to: notify.email.to, subject, text: renderSubmissionText(config, values) }),
      ).catch(() => undefined),
    );
  }
  await Promise.all(jobs);
}

/**
 * Silent anti-spam heuristics evaluated on the raw body: a filled honeypot field
 * or a too-fast submit (vs the render helper's `louise_ts` stamp). Returns `true`
 * when the submission looks like a bot — the route then returns a fake success
 * (so the bot can't tune) without inserting. Missing timestamp is NOT treated as
 * a bot (a plain HTML form without the render helper won't stamp one).
 */
export function looksLikeSpam(config: FormConfig, body: Record<string, unknown>): boolean {
  const spam = config.spam;
  if (!spam) return false;
  if (spam.honeypot) {
    const v = body[spam.honeypot];
    if (typeof v === "string" && v.trim() !== "") return true;
  }
  if (spam.minSeconds) {
    const ts = Number(body.louise_ts);
    if (Number.isFinite(ts) && ts > 0 && (Date.now() - ts) / 1000 < spam.minSeconds) return true;
  }
  return false;
}
