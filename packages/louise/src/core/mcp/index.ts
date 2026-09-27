// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—a Model Context Protocol server over the Local API, so
// an agent reads and edits a live site through the SAME validation, hooks and
// access rules a human gets editing in place (ADR 0009, issue #103).
//
// Slice 1 generates the tools; slice 2 serves the read tools over Streamable
// HTTP with `mcpRoute`; slice 3 lets an agent with no browser call it with a
// scoped, expiring agent token. The draft-gated write tools land in slice 4
// (#236).
//
// When the write tools land, any rich HTML an agent writes goes through
// `sanitizeModelHtml` (louise-toolkit/security), not the editor's
// `sanitizeRichHtml`: agent output is model output, and gets the stricter
// preset (#465).

export { type McpCollection, mcpRoute, type McpRouteConfig, type McpServerInfo } from "./route.js";
export { resolveMcpSession, type ResolveMcpSessionConfig } from "./session.js";
export { agentTokensRoute, type AgentTokensRouteConfig } from "./tokens-route.js";
export {
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
  AGENT_TOKEN_PREFIX,
  agentMay,
  type AgentTokenInfo,
  agentTokens,
  agentTokensColumns,
  type AgentTokenTable,
  bearerToken,
  hashAgentToken,
  issueAgentToken,
  type IssueAgentTokenInput,
  listAgentTokens,
  parseAgentScope,
  revokeAgentToken,
  type VerifiedAgentToken,
  verifyAgentToken,
} from "./tokens.js";
export type { AgentAccess, AgentScope, EditorAgent } from "../auth/types.js";
export { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSIONS } from "./protocol.js";
export {
  collectionTools,
  type CollectionToolsOptions,
  contentTools,
  type JsonSchema,
  MCP_LIMIT_DEFAULT,
  MCP_LIMIT_MAX,
  MCP_READ_OPERATIONS,
  type McpTool,
  type McpToolAnnotations,
  type McpToolOperation,
  reservedAgentFields,
} from "./tools.js";
