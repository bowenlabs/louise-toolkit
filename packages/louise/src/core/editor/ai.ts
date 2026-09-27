// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the AI assists route (#75). Exposes the server-side
// Workers AI helpers (louise-toolkit/ai) over HTTP so the editor client can call
// them—the AI binding is server-only, so rewrite/SEO must round-trip:
//   POST /api/louise/ai/rewrite   { text, mode? }  → { text }, or 413 past REWRITE_MAX_CHARS
//   POST /api/louise/ai/seo       { content }       → { title, description }
//
// Opt-in + degrade-gracefully: the `ai` accessor returns the runner (`env.AI`),
// or `undefined` when the binding isn't provisioned—then the route answers 503
// so the client can hide/disable the assist. Editor-guarded (same-origin + a
// valid session), since each call spends Workers AI budget.

import {
  type AiGatewayOptions,
  type AiRunner,
  aiUnavailableReason,
  REWRITE_MAX_CHARS,
  type RewriteMode,
  type RewriteOptions,
  rewriteText,
  type SeoOptions,
  suggestSeo,
  type AiFailureReason,
} from "../ai/index.js";
import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

// The cap on `text` is sized from the rewrite's output cap (see REWRITE_MAX_CHARS):
// a longer selection spends tokens on an answer that comes back cut off.
const REWRITE_BODY = s.object({
  text: s.string({ min: 1, max: REWRITE_MAX_CHARS }),
  mode: s.optional(s.enumOf("tighten", "rephrase", "simplify", "fix")),
});

/** The `413` message for a selection past the cap. The toolbar shows it as is. */
const REWRITE_TOO_LONG = `Select a shorter passage. Rewrite works on up to ${REWRITE_MAX_CHARS.toLocaleString("en-US")} characters at a time.`;

/** Whether the body's `text` is past the cap, so a failed validation gets a `413`
 *  the editor can act on rather than a bare `400`. */
function rewriteTooLong(body: unknown): boolean {
  const text = (body as { text?: unknown } | null)?.text;
  return typeof text === "string" && text.length > REWRITE_MAX_CHARS;
}

const SEO_BODY = s.object({ content: s.string({ min: 1 }) });

export interface AiRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /**
   * The Workers AI runner—typically `(env) => env.AI`. Return `undefined` (for example,
   * the binding isn't provisioned) and the route answers 503, so the assist is
   * cleanly absent rather than erroring.
   */
  ai: (env: Env) => AiRunner | undefined;
  /** Optional AI Gateway routing (#87) for the rewrite/SEO calls: caching, cost
   *  caps, fallbacks, logging. Given the runtime `env`, return the gateway config
   *  (or `undefined` to call Workers AI directly). */
  gateway?: (env: Env) => AiGatewayOptions | undefined;
  /**
   * The site's voice for rewrites (#553): `instructions` (voice, audience, and
   * locale, in plain words) and up to two before-and-after `examples`. A site
   * fact, so a parameter; there's no default.
   */
  rewrite?: Pick<RewriteOptions, "instructions" | "examples">;
  /** The site's voice for SEO suggestions: `instructions`, as for rewrites. */
  seo?: Pick<SeoOptions, "instructions">;
  /** Mount base. Default `/api/louise/ai`. */
  path?: string;
}

/**
 * Build the AI assists route. Returns `undefined` for any path it doesn't own so
 * `composeWorker` falls through. Each action is a POST guarded as a mutation
 * (same-origin + editor session), since it spends AI budget.
 */
export function aiRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  cfg: AiRouteConfig<Env>,
): WorkerRoute<Env> {
  const base = cfg.path ?? "/api/louise/ai";

  return async (request, env) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(`${base}/`)) return undefined;
    const action = path.slice(base.length + 1);
    if (action !== "rewrite" && action !== "seo") return undefined;

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const g = await guardEditor(request, env, cfg.resolveEditor, true);
    if ("response" in g) return g.response;

    const runner = cfg.ai(env);
    // `reason` tells "turned off for this site" apart from "never configured".
    // Both 503 and both hide the control today; only the former deserves to say
    // so out loud, and a client can't distinguish them without this.
    if (!runner) return json({ error: "AI not available", reason: aiUnavailableReason(env) }, 503);
    const gateway = cfg.gateway?.(env);

    const body = await request.json().catch(() => null);

    if (action === "rewrite") {
      const parsed = await standardValidate(REWRITE_BODY, body);
      if (!parsed.ok) {
        if (rewriteTooLong(body)) return json({ error: REWRITE_TOO_LONG }, 413);
        return json({ error: "Invalid body" }, 400);
      }
      let reason: AiFailureReason = "error";
      const text = await rewriteText(runner, parsed.value.text, {
        ...cfg.rewrite,
        mode: parsed.value.mode as RewriteMode | undefined,
        gateway,
        onFailure: (why) => {
          reason = why;
        },
      });
      // Best-effort helper returns null when the model errored, gave nothing, or
      // was cut off at the output cap; 502 so the client can leave the original
      // text untouched, with the reason so it can say what went wrong.
      if (text === null) return json({ error: "Rewrite unavailable", reason }, 502);
      return json({ text });
    }

    // action === "seo"
    const parsed = await standardValidate(SEO_BODY, body);
    if (!parsed.ok) return json({ error: "Invalid body" }, 400);
    let reason: AiFailureReason = "error";
    const seo = await suggestSeo(runner, parsed.value.content, {
      ...cfg.seo,
      gateway,
      onFailure: (why) => {
        reason = why;
      },
    });
    if (!seo) return json({ error: "Suggestion unavailable", reason }, 502);
    return json(seo);
  };
}
