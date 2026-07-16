// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the AI assists route (#75). Exposes the server-side
// Workers AI helpers (louise-toolkit/ai) over HTTP so the editor client can call
// them — the AI binding is server-only, so rewrite/SEO must round-trip:
//   POST /api/louise/ai/rewrite   { text, mode? }  → { text }
//   POST /api/louise/ai/seo       { content }       → { title, description }
//
// Opt-in + degrade-gracefully: the `ai` accessor returns the runner (`env.AI`),
// or `undefined` when the binding isn't provisioned — then the route answers 503
// so the client can hide/disable the assist. Editor-guarded (same-origin + a
// valid session), since each call spends Workers AI budget.

import { type AiRunner, type RewriteMode, rewriteText, suggestSeo } from "../ai/index.js";
import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

const REWRITE_BODY = s.object({
  text: s.string({ min: 1 }),
  mode: s.optional(s.enumOf("tighten", "rephrase", "simplify", "fix")),
});
const SEO_BODY = s.object({ content: s.string({ min: 1 }) });

export interface AiRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /**
   * The Workers AI runner — typically `(env) => env.AI`. Return `undefined` (e.g.
   * the binding isn't provisioned) and the route answers 503, so the assist is
   * cleanly absent rather than erroring.
   */
  ai: (env: Env) => AiRunner | undefined;
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
    if (!runner) return json({ error: "AI not available" }, 503);

    const body = await request.json().catch(() => null);

    if (action === "rewrite") {
      const parsed = await standardValidate(REWRITE_BODY, body);
      if (!parsed.ok) return json({ error: "Invalid body" }, 400);
      const text = await rewriteText(runner, parsed.value.text, {
        mode: parsed.value.mode as RewriteMode | undefined,
      });
      // Best-effort helper returns null when the model errored / gave nothing;
      // 502 so the client can leave the original text untouched.
      if (text === null) return json({ error: "Rewrite unavailable" }, 502);
      return json({ text });
    }

    // action === "seo"
    const parsed = await standardValidate(SEO_BODY, body);
    if (!parsed.ok) return json({ error: "Invalid body" }, 400);
    const seo = await suggestSeo(runner, parsed.value.content);
    if (!seo) return json({ error: "Suggestion unavailable" }, 502);
    return json(seo);
  };
}
