// louise-toolkit/email — Cloudflare Email Service (transactional Email Sending).
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

/** What a {@link sendEmail} call did. */
export interface SendEmailResult {
  /** The provider's message id — present only when a real send happened. */
  messageId?: string;
  /** True when there was no binding and the send was logged, not delivered. */
  simulated?: boolean;
}

export interface SendEmailOptions {
  /**
   * What to do when `binding` is absent (no EMAIL binding provisioned).
   *
   * `true` → log a simulated send and return `{ simulated: true }` instead of
   * throwing. `false` → throw {@link LouiseEmailError}. Defaults to
   * {@link looksLikeDev}: on under `wrangler dev`/`astro dev` (no EMAIL binding
   * is the normal local case, and "click the magic link from the console" is the
   * whole dev loop), OFF in production — where a missing binding is a real
   * misconfiguration that should fail loudly rather than drop mail in silence.
   *
   * Astroid's mailer sets this itself; a direct caller (a hand-rolled contact
   * route) gets the dev-safe default for free and can opt into simulating in
   * production explicitly.
   */
  simulateWhenUnconfigured?: boolean;
  /** Sink for the simulated-send log line. Defaults to `console.info`. */
  log?: (message: string) => void;
  /**
   * Is this a development environment? The host knows; this library cannot
   * reliably tell on a Worker.
   *
   * Drives the defaults for {@link simulateWhenUnconfigured} and {@link devLog}.
   * Unset falls back to a `NODE_ENV` check that reads absent-as-production, so
   * forgetting it is safe but pessimistic: an unconfigured send throws instead of
   * simulating, and a sign-in link is withheld from the log.
   */
  dev?: boolean;
  /**
   * Print the message BODY in the simulated log. The body can carry a single-use
   * sign-in or reset link, so it is included only where we can tell we're in
   * development. Defaults to {@link dev}, else the `NODE_ENV` fallback; set it
   * explicitly when neither can tell (a local `wrangler dev` against a real
   * account, a test).
   */
  devLog?: boolean;
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

/**
 * Best-effort "are we in development?" — the fallback when the host does not say.
 *
 * Deliberately conservative: it decides both whether an unconfigured send
 * simulates rather than throws AND whether a credential-bearing body is printed,
 * so an unknown environment must read as production.
 *
 * This used to read `import.meta.env.DEV` first, which a bundler defines at build
 * time. That made a library claiming to be framework-agnostic depend on being
 * built by one — and on a plain Worker the read was absent anyway. The host knows
 * the answer and should pass {@link SendEmailOptions.dev}; `NODE_ENV` remains as
 * a fallback because it is an ordinary global rather than a bundler construct.
 */
function looksLikeDev(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.NODE_ENV;
  if (typeof nodeEnv === "string") return nodeEnv !== "production";
  return false;
}

/**
 * The console rendering of an unsent message.
 *
 * The body is the whole point in dev — that's where a sign-in link actually is,
 * and printing it is what lets you sign in with no mail provider configured. It
 * is also a credential, so it is withheld unless we can see we're in development
 * (see {@link looksLikeDev}); everywhere else the log still records THAT a message
 * went unsent, and to whom, but not the link inside it.
 */
function describeSimulated(input: SendEmailInput, includeBody: boolean): string {
  const head = [
    "[louise:email] no binding — simulated, not sent",
    `  to:      ${input.to}`,
    `  subject: ${input.subject}`,
  ];
  if (!includeBody) {
    return [
      ...head,
      "  (body withheld — it can contain a single-use sign-in or reset link, and this",
      "   does not look like a development environment. Provision the EMAIL binding to",
      "   deliver it, or pass `devLog: true` if this really is local.)",
    ].join("\n");
  }
  const text = input.text ?? htmlToText(input.html);
  return [...head, "  ---", ...text.split("\n").map((line) => `  ${line}`), "  ---"].join("\n");
}

/**
 * Sends a transactional email via the Cloudflare Email Sending binding.
 *
 * With a `binding`, this delivers and returns `{ messageId }`, throwing
 * {@link LouiseEmailError} on a send failure — unchanged. WITHOUT one, it takes
 * the dormant-until-provisioned path: in a dev context (the default) it logs a
 * simulated send and returns `{ simulated: true }` rather than throwing, so a
 * hand-rolled route that calls `sendEmail(env.EMAIL, …)` with no localhost guard
 * doesn't 500 the request that triggered it when EMAIL is absent locally. In
 * production a missing binding still throws unless the caller opts into
 * simulating — see {@link SendEmailOptions.simulateWhenUnconfigured}.
 */
export async function sendEmail(
  binding: EmailSender | null | undefined,
  input: SendEmailInput,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  if (!binding) {
    const dev = options.dev ?? looksLikeDev();
    const simulate = options.simulateWhenUnconfigured ?? dev;
    if (!simulate) {
      // A production send with no EMAIL binding is a real misconfiguration, not a
      // dev convenience: fail loudly rather than dropping the mail in silence.
      throw new LouiseEmailError(
        `No email binding configured — cannot send to "${input.to}". Provision the ` +
          "EMAIL binding, or pass `simulateWhenUnconfigured: true` to log a simulated " +
          "send instead (astroid's mailer does this for you).",
      );
    }
    const log = options.log ?? ((message: string) => console.info(message));
    log(describeSimulated(input, options.devLog ?? dev));
    return { simulated: true };
  }
  try {
    const { messageId } = await binding.send({
      to: input.to,
      from: input.from,
      subject: input.subject,
      html: input.html,
      text: input.text ?? htmlToText(input.html),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return { messageId };
  } catch (cause) {
    throw new LouiseEmailError(`Failed to send email to "${input.to}"`, cause);
  }
}
