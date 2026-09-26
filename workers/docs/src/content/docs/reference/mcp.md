---
title: mcp
description: "louise-toolkit/mcp—a Model Context Protocol server over the Local API, so an agent reads a site's content under the same access rules as an editor."
sidebar:
  order: 16
---

```ts
import { mcpRoute, collectionTools, contentTools } from "louise-toolkit/mcp";
```

An MCP server for a site's content, built from the collections you already
define. `collectionTools()` derives the tools from a collection's fields, and
`mcpRoute()` serves them over MCP's Streamable HTTP transport. Every call runs
through the Local API with the editor's session as its context, so an agent
gets exactly the access, validation and hooks a person editing the site gets.
[ADR 0009](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0009-mcp-server-agent-editing.md)
has the design. No runtime dependencies and no bindings beyond D1.

:::caution[Read-only, and same-origin only, for now]
`mcpRoute` serves the read tools. It accepts a call only from a signed-in editor
on the site's own origin, like every other editor route. An agent with no
browser, such as Claude Code, needs the bearer-token path that arrives with
[#235](https://github.com/bowenlabs/louise-toolkit/issues/235), and the write
tools arrive with [#236](https://github.com/bowenlabs/louise-toolkit/issues/236).
:::

## Mounting the endpoint

```ts
import { composeWorker } from "louise-toolkit/worker";
import { mcpRoute } from "louise-toolkit/mcp";

export default composeWorker({
  gate: { resolveEditor },
  routes: [
    mcpRoute({
      collections: [{ table: pages, config: pagesConfig }],
      resolveEditor,
      server: { name: "site-example", version: "1.0.0" },
      instructions: "Pages are the site's top-level pages. Posts are its news.",
    }),
  ],
  fetch: app.fetch,
});
```

| Option          | Default           | What it does                                                                                       |
| --------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `collections`   | —                 | `{ table, config }` for each collection an agent may read.                                         |
| `resolveEditor` | —                 | The same resolver the other editor routes take. Every call runs as this editor.                    |
| `server`        | —                 | `{ name, version, title? }`, the server's identity. The name is the site's, so there's no default. |
| `instructions`  | none              | Guidance a client can give the model about the site. Don't repeat the tool descriptions.           |
| `sections`      | none              | The section catalog, passed to `collectionTools`.                                                  |
| `path`          | `/api/louise/mcp` | Where the endpoint mounts.                                                                         |

The route returns `undefined` for any other path, so `composeWorker` falls
through. From a framework route, run it with `runEditorRoute` from
`louise-toolkit/editor`.

## The tools

For each collection, `mcpRoute` offers the read tools `collectionTools`
generates:

| Tool            | Arguments           | Returns                                               |
| --------------- | ------------------- | ----------------------------------------------------- |
| `list_<slug>`   | `limit?`, `offset?` | `{ docs, nextOffset? }`, newest first                 |
| `get_<slug>`    | `id`                | `{ doc }`                                             |
| `count_<slug>`  | none                | `{ count }`                                           |
| `search_<slug>` | `query`, `limit?`   | `{ docs }`, when the collection has a `search` config |

`limit` runs from 1 to 100 and defaults to 20. `nextOffset` is present only when
there's another page. On a collection with drafts, a read returns the
document without its unpublished draft edits, which live in the version history.

Each description says when to use the tool, not only what it does, because an
agent chooses from the descriptions alone. A collection marked `admin.hidden`
gets no tools. `tools/list` leaves out a collection whose `read` access function
refuses the editor, and a call to one of its tools is refused anyway by the
Local API.

A bad argument, a missing document or a refused read comes back as a tool
result with `isError: true` and a sentence the model can act on, not as a
protocol error. An unknown tool is a protocol error (`-32602`).

## Protocol versions

The route speaks both eras of MCP on the same endpoint:

- **2026-07-28**, the stateless revision. A request carries its version in
  `_meta`, and the route implements `server/discover` and checks the
  `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers against the body.
- **2025-11-25, 2025-06-18 and 2025-03-26**, which open with `initialize`. Most
  clients still send it, and a client of that era has no way to move forward
  on its own.

Neither era keeps state between requests, so the route never mints a session
ID, and it answers `GET` and `DELETE` with `405`. Every response is a single
JSON object; the route doesn't stream.

## Generating tools without the route

`collectionTools(config, { sections? })` and `contentTools(contentConfig)`
return the tool definitions as data: name, description, `inputSchema`,
`annotations`, and the `collection` and `operation` a dispatcher routes on.
They also generate the write tools (`create_<slug>`, `update_<slug>_field`,
`add_<slug>_section` and `publish_<slug>`), which `mcpRoute` doesn't serve yet.
