// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp` — a Model Context Protocol server over the Local API, so
// an agent reads and edits a live site through the SAME validation, hooks and
// access rules a human gets editing in place (ADR 0009, issue #103).
//
// Slice 1 is tool GENERATION only: pure, synchronous, no transport. The
// Streamable-HTTP JSON-RPC route, the bearer-token session, and the draft-gated
// write execution land in slices 2–4 (#234–#236).

export {
  collectionTools,
  type CollectionToolsOptions,
  contentTools,
  type JsonSchema,
  type McpTool,
  type McpToolOperation,
} from "./tools.js";
