---
"louise-toolkit": minor
"@louise-toolkit/astro": minor
---

An agent with no browser can call the MCP endpoint with a scoped, expiring agent token (#235).

- **`mcpRoute` takes `resolveAgent`.** A request with `Authorization: Bearer` is authenticated by the token alone and skips the same-origin check; a request without one is unchanged. `resolveMcpSession({ resolveUser })` turns a token into the editor who issued it, with `session.agent` set to the token's ID, name, and scope.
- **Tokens are scoped, expire, and revoke immediately.** A scope maps each collection to `read`, `draft`, or `publish`, and there's no default. A token lasts 30 days unless its issuer says otherwise, and at most 90. Only its SHA-256 is stored, and it starts with `louise_at_`.
- **`agentTokensRoute`** at `/api/louise/mcp/tokens` lets a signed-in editor issue, list, and revoke their own tokens. A token can't manage tokens.
- **`editorForUser(env, userId)`** in `louise-toolkit/auth` re-derives an editor from their user row. A token stops working when its editor isn't an admin, is banned, or has left the sign-in allowlist.
- **`bearerRoute(route)`** in `louise-toolkit/worker` marks a route that checks a bearer token itself. `composeWorker`'s gate lets a bearer request through to marked routes only; everywhere else under the prefix it's refused as before.
- **`apiGate.takesBearer`** in `@louise-toolkit/astro` does the same for the middleware gate, by path. It's off unless you set it.

**Upgrading:** nothing changes until you pass `resolveAgent`. To turn tokens on, export `agentTokens` from `louise-toolkit/mcp` in your Drizzle schema, generate and apply the migration that creates `agent_tokens`, and mount `agentTokensRoute`. With the Astro middleware gate, also set `apiGate.takesBearer: (path) => path === LOUISE_MCP_PATH`. If your auth uses `tablePrefix` or `resolveAdmins`, pass the same to `editorForUser`. The reasoning is in the 2026-09-27 amendments to ADR 0009 and ADR 0012.
