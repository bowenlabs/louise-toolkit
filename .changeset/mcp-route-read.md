---
"louise-toolkit": minor
---

`louise-toolkit/mcp` now serves its tools: `mcpRoute()` is an MCP endpoint over the Local API, with the read tools for each collection.

- **`mcpRoute({ collections, resolveEditor, server })`** returns a `WorkerRoute` that answers MCP's Streamable HTTP transport at `/api/louise/mcp`. It offers `list_<slug>`, `get_<slug>`, `count_<slug>` and `search_<slug>`, and runs each through the Local API with the editor's session, so a collection's `read` access function and read hooks apply to an agent as they do to a person. `tools/list` leaves out a collection the editor can't read.
- **Both protocol eras on one endpoint.** A request that carries its version in `_meta` is served as the stateless 2026-07-28 revision, with `server/discover` and the header checks it requires. An `initialize` gets the 2025-11-25, 2025-06-18 or 2025-03-26 handshake that most clients still send. No session is ever minted.
- **Tool descriptions say when to use each tool**, name the better tool where two overlap, and say where a write lands: as a draft, or live at once on a collection with no drafts. `publish_<slug>` says to call it only when the person asked. Each tool also carries MCP's `annotations`, with the reads marked read-only.
- **`list_<slug>` and `search_<slug>` bound `limit`** to 1 through 100, and `offset` to 0 or more, in the schema and when called.

`server.name` has no default: it's the site's identity, so pick one such as `site-example`.

**What to do:** nothing, unless you want the endpoint. The route accepts only a signed-in editor on the site's own origin for now, so an agent with no browser can't reach it until the bearer-token path lands (#235). The write tools aren't served yet (#236). If you read `McpTool` objects from `collectionTools`, they now have an `annotations` field, and the descriptions have changed.
