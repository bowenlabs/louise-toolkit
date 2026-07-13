// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — the generic `form` capture route (issue #46). The PUBLIC
// companion to the editor-gated submissions review route: a same-origin-guarded
// POST that validates a visitor's submission against a `defineForm` definition,
// applies the spam guard (rate limit + optional Turnstile), and inserts a row.
// Unlike the other editor routes it is NOT session-gated — anyone may submit —
// so the guard is same-origin (CSRF) + the spam checks, not an editor session.

import { isSameOrigin } from "../auth/guard.js";
import {
  columnName,
  type FormDefinition,
  type FormMailer,
  looksLikeSpam,
  notifySubmission,
  validateSubmission,
  verifyTurnstileToken,
} from "../forms/index.js";
import { type KVLike, rateLimit } from "../security/rate-limit.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, ident, json, matchPath } from "./shared.js";

/** Env for a form capture route: the D1 binding (a KV binding too if the form
 *  rate-limits — supplied via `rateLimitKv`). */
export type FormRouteEnv = EditorRouteEnv;

export interface FormRouteConfig<Env extends FormRouteEnv = FormRouteEnv> {
  /** The form definition (from `defineForm`). */
  form: FormDefinition;
  /** Mount path. Default `/api/louise/forms/<name>`. */
  path?: string;
  /** KV for the rate limiter, when the form declares `spam.rateLimit`. */
  rateLimitKv?: (env: Env) => KVLike;
  /** Rate-limit key for a request. Default: the `CF-Connecting-IP` header. */
  clientKey?: (request: Request) => string;
  /** Turnstile secret, when the form declares `spam.turnstile`. */
  turnstileSecret?: (env: Env) => string;
  /** Email transport for `notify.email` — wrap your `EMAIL` binding here. */
  mailer?: (env: Env) => FormMailer;
  /**
   * Store into the shared generic `submissions` table as `{ form, data }`
   * instead of a per-form typed table — so an ad-hoc form needs no migration.
   * Pass the ready-made `submissions` table name (default `"submissions"`).
   */
  genericTable?: string;
  /** Fired after a successful insert with the stored values (Tier 3 hook). */
  onSubmit?: (values: Record<string, unknown>, env: Env) => void | Promise<void>;
}

/** Read a submission body as a flat record, from JSON or form-encoding. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const form = await request.formData().catch(() => null);
  if (!form) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : v.name;
  return out;
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
  const path = config.path ?? `/api/louise/forms/${form.name}`;
  const fieldKeys = Object.keys(form.fields);

  return async (request, env, ctx) => {
    if (!matchPath(request, path)) return undefined;
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!isSameOrigin(request)) return json({ error: "Forbidden" }, 403);

    const body = await readBody(request);

    // Silent heuristics (honeypot / too-fast submit): return a fake success so a
    // bot can't tune, and never insert. Runs before the visible checks.
    if (looksLikeSpam(form, body)) return json({ ok: true }, 201);

    // Spam guard — rate limit first (cheap), then Turnstile (a network call).
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
        return json({ error: "Too many requests" }, 429, { "Retry-After": String(retryAfter) });
      }
    }
    if (form.spam?.turnstile && config.turnstileSecret) {
      const token = (body["cf-turnstile-response"] as string) ?? null;
      const ok = await verifyTurnstileToken(
        config.turnstileSecret(env),
        token,
        request.headers.get("cf-connecting-ip"),
      );
      if (!ok) return json({ error: "Failed the spam check" }, 403);
    }

    const { values, violations } = await validateSubmission(form, body);
    const errors = violations.filter((v) => v.severity === "error");
    if (errors.length > 0) return json({ error: "validation", violations }, 422);

    const now = Math.floor(Date.now() / 1000);
    if (config.genericTable) {
      // Shared store: one row is `{ form, data }` — no per-form migration.
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

    return json({ ok: true }, 201);
  };
}
