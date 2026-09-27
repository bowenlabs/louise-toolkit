// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—`agentTokensRoute()`, where an editor issues, lists, and
// revokes their agent tokens (ADR 0009 §5).
//
// Issuing a token is as sensitive as signing in, so the route takes only the
// cookie session and the same-origin check every editor write gets. A request
// that an agent token authenticated is refused outright, even if a site hands
// this route a resolver that accepts one.

import type { CollectionConfig } from "../content/types.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "../editor/shared.js";
import { LouiseAuthError } from "../errors.js";
import type { WorkerRoute } from "../worker/index.js";
import {
  AGENT_TOKEN_MAX_DAYS,
  type AgentTokenTable,
  issueAgentToken,
  listAgentTokens,
  parseAgentScope,
  revokeAgentToken,
} from "./tokens.js";

export interface AgentTokensRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The same cookie-session resolver the other editor routes take. */
  resolveEditor: ResolveEditor<Env>;
  /** The collections a token's scope may name. Pass the list `mcpRoute` takes. */
  collections: readonly { config: CollectionConfig }[];
  /** The token table, if you composed your own from `agentTokensColumns`. */
  table?: AgentTokenTable;
  /** Mount path. Default `/api/louise/mcp/tokens`. */
  path?: string;
}

const NO_STORE = { "cache-control": "no-store" };

/**
 * The editor's own tokens:
 *
 * - `GET` lists them, newest first, without their secrets.
 * - `POST` with `{ name, scope, expiresInDays? }` issues one, and answers `201`
 *   with `{ token, info }`. It's the only response that ever holds the token.
 * - `DELETE ?id=tok_…` revokes one, and answers `204`, or `404` when the editor
 *   has no live token with that ID.
 *
 * An editor sees and revokes only the tokens they issued.
 */
export function agentTokensRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: AgentTokensRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/mcp/tokens";
  const slugs = new Set(config.collections.map((c) => c.config.slug));

  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname !== path) return undefined;
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      return new Response(null, { status: 405, headers: { allow: "GET, POST, DELETE" } });
    }

    const g = await guardEditor(request, env, config.resolveEditor, method !== "GET");
    if ("response" in g) return g.response;
    if (g.editor.agent) {
      return json({ error: "Manage agent tokens from the site, not with a token." }, 403);
    }
    const userId = g.editor.userId;

    if (method === "GET") {
      return json({ tokens: await listAgentTokens(env.DB, userId, config.table) }, 200, NO_STORE);
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      if (!/^tok_[0-9a-f]{16}$/.test(id)) {
        return json({ error: "Name the token to revoke with ?id=tok_…" }, 400);
      }
      const revoked = await revokeAgentToken(env.DB, { id, userId }, config.table);
      return revoked
        ? new Response(null, { status: 204 })
        : json({ error: "You have no active token with that ID." }, 404);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send the token's details as JSON." }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ error: "Send the token's details as a JSON object." }, 400);
    }
    const { name, scope, expiresInDays } = body as Record<string, unknown>;
    const parsed = parseAgentScope(scope);
    if (typeof parsed === "string") return json({ error: parsed }, 400);
    const unknown = Object.keys(parsed).filter((slug) => !slugs.has(slug));
    if (unknown.length) {
      return json({ error: `This site has no collection named ${unknown.join(", ")}.` }, 400);
    }
    if (expiresInDays !== undefined && typeof expiresInDays !== "number") {
      return json(
        { error: `expiresInDays must be a whole number from 1 to ${AGENT_TOKEN_MAX_DAYS}.` },
        400,
      );
    }
    try {
      const issued = await issueAgentToken(
        env.DB,
        {
          owner: g.editor,
          name: typeof name === "string" ? name : "",
          scope: parsed,
          ...(expiresInDays === undefined ? {} : { expiresInDays }),
        },
        config.table,
      );
      return json(issued, 201, NO_STORE);
    } catch (err) {
      if (err instanceof LouiseAuthError) return json({ error: err.message }, 400);
      throw err;
    }
  };
}
