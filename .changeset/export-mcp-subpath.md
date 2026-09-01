---
"louise-toolkit": minor
---

mcp: export `louise-toolkit/mcp` — it shipped in 0.27.0 reachable by nobody

The MCP tool-generation module (ADR 0009, slice 1 of #103) was written, tested and
announced in the 0.27.0 changelog, and never added to `exports` or to the build's
entry list. It reached npm in neither, so `import { contentTools } from
"louise-toolkit/mcp"` has been failing for anyone who read the release notes and
tried it.

Nothing about the module changes — `collectionTools`, `contentTools`, and the
`McpTool` / `McpToolOperation` / `JsonSchema` / `CollectionToolsOptions` types are
exactly as they were. They are simply reachable now.

Its own header comment named the subpath `louise-toolkit/mcp` from the start, so
this is the export it was always meant to have.
