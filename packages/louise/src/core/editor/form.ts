// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the generic `form` capture route (issue #46). The PUBLIC
// companion to the editor-gated submissions review route: a same-origin-guarded
// POST that validates a visitor's submission against a `defineForm` definition,
// applies the spam guard (rate limit + optional Turnstile), and inserts a row.
// Unlike the other editor routes it is NOT session-gated—anyone may submit—so
// the guard is same-origin (CSRF) + the spam checks, not an editor session.

import { isSameOrigin } from "../auth/guard.js";
import { reportDegraded } from "../degraded.js";
import {
  columnName,
  type FormDefinition,
  type FormMailer,
  type SpamVerdict,
  spamVerdict,
  notifySubmission,
  validateSubmission,
  verifyTurnstileToken,
} from "../forms/index.js";
import { s, standardValidate } from "../schema/index.js";
import { type RateLimitBackend, rateLimit } from "../security/rate-limit.js";
import { LOUISE_FORMS_PATH, publicRoute } from "../worker/gate.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, ident, json, matchPath } from "./shared.js";

/** Env for a form capture route: the D1 binding (a KV binding too if the form
 *  rate-limits, supplied via `rateLimitKv`). */
export type FormRouteEnv = EditorRouteEnv;

export interface FormRouteConfig<Env extends FormRouteEnv = FormRouteEnv> {
  /** The form definition (from `defineForm`). */
  form: FormDefinition;
  /** Mount path. Default `/api/louise/forms/<name>`. */
  path?: string;
  /** Rate-limit backend, when the form declares `spam.rateLimit`—a KV binding
   *  or Cloudflare's native Rate Limiting binding. */
  rateLimitKv?: (env: Env) => RateLimitBackend;
  /** Rate-limit key for a request. Default: the `CF-Connecting-IP` header. */
  clientKey?: (request: Request) => string;
  /** Turnstile secret, when the form declares `spam.turnstile`. */
  turnstileSecret?: (env: Env) => string;
  /** Email transport for `notify.email`—wrap your `EMAIL` binding here. */
  mailer?: (env: Env) => FormMailer;
  /**
   * Store into the shared generic `submissions` table as `{ form, data }`
   * instead of a per-form typed table—so an ad-hoc form needs no migration.
   * Pass the ready-made `submissions` table name (default `"submissions"`).
   */
  genericTable?: string;
  /** Fired after a successful insert with the stored values (Tier 3 hook). */
  onSubmit?: (values: Record<string, unknown>, env: Env) => void | Promise<void>;
  /**
   * Fired when a silent spam heuristic holds a submission, with which one. The
   * visitor still sees a success and nothing is stored, so this is the only
   * record: count held submissions, alert on a spike, or store them yourself.
   * Default: one log line with the form's name and the verdict, never the
   * field values.
   */
  onSpam?: (
    verdict: SpamVerdict,
    env: Env,
    context: { form: string; body: Record<string, unknown> },
  ) => void | Promise<void>;
  /**
   * Answer a no-script post: a form-encoded submit from a browser that wants
   * HTML, which is what a plain `<form method="post">` sends when its script is
   * slow, blocked, or broken. Return your own thank-you page or a re-rendered
   * form, or `undefined` for the default: a `303` back to the page the form was
   * on (its `Referer`), with `?form=<name>&status=<status>`, and for `invalid`
   * the failing field keys as `&invalid=email,message`, never the messages. A
   * JSON request always gets JSON.
   */
  respond?: (outcome: FormOutcome, request: Request) => Response | undefined;
}

/** How a submission ended, for a no-script post. */
export interface FormOutcome {
  /** The form's name. */
  form: string;
  /**
   * `sent` (stored, or held as spam, which looks the same on purpose),
   * `invalid` (a field failed validation), `limited` (rate-limited), or
   * `refused` (the Turnstile check failed).
   */
  status: "sent" | "invalid" | "limited" | "refused";
  /** For `invalid`: the keys of the fields that failed. */
  invalid?: string[];
  /** For `invalid`: every violation, for a page that re-renders the form. */
  violations?: readonly { path: string; message: string }[];
}

/** Read a submission body as a flat record, from JSON or form-encoding. A
 *  file in a multipart body isn't read: its key is listed in `files`, so the
 *  route can refuse it instead of storing the file's name. */
async function readBody(
  request: Request,
): Promise<{ body: Record<string, unknown>; files: string[] }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const parsed = await standardValidate(s.record(), await request.json().catch(() => null));
    return { body: parsed.ok ? parsed.value : {}, files: [] };
  }
  const form = await request.formData().catch(() => null);
  if (!form) return { body: {}, files: [] };
  const body: Record<string, unknown> = {};
  const files: string[] = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") body[k] = v;
    else files.push(k);
  }
  return { body, files };
}

/** Whether `request` is a browser's plain form post that wants a page back. */
function wantsPage(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return (
    !type.includes("application/json") &&
    (request.headers.get("accept") ?? "").includes("text/html")
  );
}

/** The default no-script answer: a `303` back to the form's page, or the site
 *  root when the `Referer` is missing or from another origin. */
function redirectBack(outcome: FormOutcome, request: Request): Response {
  const here = new URL(request.url);
  let target = new URL("/", here);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.origin === here.origin) target = from;
    } catch {
      // An unparseable Referer: go to the root.
    }
  }
  target.hash = "";
  target.searchParams.set("form", outcome.form);
  target.searchParams.set("status", outcome.status);
  target.searchParams.delete("invalid");
  if (outcome.invalid?.length) target.searchParams.set("invalid", outcome.invalid.join(","));
  return new Response(null, { status: 303, headers: { location: target.href } });
}

/** Bind-safe value for D1: booleans → 1/0, everything else passes through. */
function bindValue(v: unknown): string | number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  return String(v);
}

/**
 * Build a public form capture route from a `defineForm` definition. POST only,
 * same-origin-guarded; validates + coerces against the form's fields (422 on
 * violations), enforces the declared spam guard, inserts the row, and fires the
 * `onSubmit` hook. Returns `undefined` for a non-matching path so `composeWorker`
 * falls through.
 */
export function formRoute<Env extends FormRouteEnv = FormRouteEnv>(
  config: FormRouteConfig<Env>,
): WorkerRoute<Env> {
  const { form } = config;
  const path = config.path ?? `${LOUISE_FORMS_PATH}/${form.name}`;
  const fieldKeys = Object.keys(form.fields);

  // Public: an anonymous visitor submits it, so the API gate lets it through.
  return publicRoute(async (request, env, ctx) => {
    if (!matchPath(request, path)) return undefined;
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!isSameOrigin(request)) return json({ error: "Forbidden" }, 403);

    const { body, files } = await readBody(request);
    const page = wantsPage(request);
    /** Answer JSON, or for a no-script post, `respond` or a redirect back. */
    const answer = (outcome: FormOutcome, fallback: () => Response): Response =>
      page ? (config.respond?.(outcome, request) ?? redirectBack(outcome, request)) : fallback();

    // Silent heuristics (honeypot / too-fast submit): return a fake success so a
    // bot can't tune, and never insert. Runs before the visible checks. Autofill
    // can fill a honeypot for a person, so each hold is recorded, not dropped.
    const verdict = spamVerdict(form, body);
    if (verdict) {
      try {
        if (config.onSpam) await config.onSpam(verdict, env, { form: form.name, body });
        else console.warn(`[louise] form "${form.name}": held a submission (${verdict})`);
      } catch (err) {
        reportDegraded("forms.onSpam", err, { form: form.name });
      }
      return answer({ form: form.name, status: "sent" }, () => json({ ok: true }, 201));
    }

    // Spam guard—rate limit first (cheap), then Turnstile (a network call).
    if (form.spam?.rateLimit && config.rateLimitKv) {
      const key = config.clientKey
        ? config.clientKey(request)
        : (request.headers.get("cf-connecting-ip") ?? "anon");
      const { ok, retryAfter } = await rateLimit(
        config.rateLimitKv(env),
        `form:${form.name}:${key}`,
        form.spam.rateLimit.max,
        form.spam.rateLimit.windowSec,
      );
      if (!ok) {
        return answer({ form: form.name, status: "limited" }, () =>
          json({ error: "Too many requests" }, 429, { "Retry-After": String(retryAfter) }),
        );
      }
    }
    if (form.spam?.turnstile && config.turnstileSecret) {
      const token = (body["cf-turnstile-response"] as string) ?? null;
      const ok = await verifyTurnstileToken(
        config.turnstileSecret(env),
        token,
        request.headers.get("cf-connecting-ip"),
      );
      if (!ok) {
        return answer({ form: form.name, status: "refused" }, () =>
          json({ error: "Failed the spam check" }, 403),
        );
      }
    }

    const { values, violations: checked } = await validateSubmission(form, body);
    // A file posted straight to the form has nowhere to go: the field stores a
    // link, so the file has to be uploaded first.
    const fileViolations = files
      .filter((key) => fieldKeys.includes(key))
      .map((key) => ({
        path: key,
        message: "Upload the file first; this field takes the uploaded file's link.",
        severity: "error" as const,
      }));
    const violations = [...fileViolations, ...checked.filter((v) => !files.includes(v.path))];
    const errors = violations.filter((v) => v.severity === "error");
    if (errors.length > 0) {
      const invalid = [...new Set(errors.map((v) => v.path))].filter((key) =>
        fieldKeys.includes(key),
      );
      return answer({ form: form.name, status: "invalid", invalid, violations: errors }, () =>
        json({ error: "validation", violations }, 422),
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (config.genericTable) {
      // Shared store: one row is `{ form, data }`—no per-form migration.
      await env.DB.prepare(
        `INSERT INTO ${ident(config.genericTable)} ("form","data","created_at") VALUES (?1,?2,?3)`,
      )
        .bind(form.name, JSON.stringify(values), now)
        .run();
    } else {
      // Typed table: insert only the declared columns (+ created_at). Raw D1:
      // values are bound, never interpolated; column names are validated
      // identifiers from the form.
      const cols = fieldKeys.map((k) => columnName(k));
      const placeholders = fieldKeys.map((_, i) => `?${i + 1}`);
      const binds = fieldKeys.map((k) => bindValue(values[k]));
      cols.push("created_at");
      placeholders.push(`?${fieldKeys.length + 1}`);
      binds.push(now);
      const colList = cols.map((c) => ident(c)).join(",");
      await env.DB.prepare(
        `INSERT INTO ${ident(form.name)} (${colList}) VALUES (${placeholders.join(",")})`,
      )
        .bind(...binds)
        .run();
    }

    // Notifications fire off the response path so a slow webhook/mail never
    // delays the visitor (waitUntil when available, else fire-and-forget).
    const announce = async () => {
      await notifySubmission(form, values, config.mailer?.(env));
      if (config.onSubmit) await config.onSubmit(values, env);
    };
    if (ctx?.waitUntil) ctx.waitUntil(announce());
    else void announce();

    return answer({ form: form.name, status: "sent" }, () => json({ ok: true }, 201));
  });
}
