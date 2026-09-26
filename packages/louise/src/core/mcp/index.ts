// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—a Model Context Protocol server over the Local API, so
// an agent reads and edits a live site through the SAME validation, hooks and
// access rules a human gets editing in place (ADR 0009, issue #103).
//
// Slice 1 generates the tools; slice 2 serves the read tools over Streamable
// HTTP with `mcpRoute`. The bearer-token session and the draft-gated write
// tools land in slices 3 and 4 (#235, #236).

export { type McpCollection, mcpRoute, type McpRouteConfig, type McpServerInfo } from "./route.js";
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
} from "./tools.js";
