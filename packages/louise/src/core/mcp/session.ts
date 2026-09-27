// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—`resolveMcpSession()`, a bearer token to the editor it
// acts for (ADR 0009 §5).

import type { EditorSession } from "../auth/types.js";
import type { EditorRouteEnv, ResolveEditor } from "../editor/shared.js";
import { type AgentTokenTable, bearerToken, verifyAgentToken } from "./tokens.js";

export interface ResolveMcpSessionConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /**
   * Re-derive the editor who owns a token, on every request, the way the
   * cookie path re-derives the editor from their session. Return null when
   * they're no longer an editor, and all their tokens stop working.
   *
   * With Louise's auth, that's `editorForUser` from `louise-toolkit/auth`,
   * given the same `tablePrefix` and `resolveAdmins` as `getLouiseAuth`:
   *
   * ```ts
   * resolveUser: (userId, env) => editorForUser(env, userId),
   * ```
   */
  resolveUser: (userId: string, env: Env) => EditorSession | null | Promise<EditorSession | null>;
  /** The token table, if you composed your own from `agentTokensColumns`. */
  table?: AgentTokenTable;
}

/**
 * A resolver for `mcpRoute`'s `resolveAgent`: the request's bearer token, as
 * the editor who issued it, with `agent` set to the token's name and scope.
 * Returns null for a request with no bearer token, and for a token that's
 * unknown, revoked, or expired, or whose editor has lost access.
 */
export function resolveMcpSession<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: ResolveMcpSessionConfig<Env>,
): ResolveEditor<Env> {
  return async (request, env) => {
    const token = bearerToken(request);
    if (!token) return null;
    const verified = await verifyAgentToken(env.DB, token, config.table);
    if (!verified) return null;
    const editor = await config.resolveUser(verified.userId, env);
    // A resolver that hands back someone else is a bug that would let one
    // editor's token act as another, so it fails closed.
    if (!editor || editor.userId !== verified.userId) return null;
    return {
      ...editor,
      agent: { tokenId: verified.id, name: verified.name, scope: verified.scope },
    };
  };
}
