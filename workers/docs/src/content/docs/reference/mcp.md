---
title: mcp
description: "louise-toolkit/mcp—a Model Context Protocol server over the Local API, so an agent reads and drafts a site's content under the same access rules as an editor, with a scoped token of its own."
sidebar:
  order: 16
---

```ts
import {
  agentTokens,
  agentTokensRoute,
  collectionTools,
  contentTools,
  mcpRoute,
  resolveMcpSession,
} from "louise-toolkit/mcp";
```

An MCP server for a site's content, built from the collections you already
define. `collectionTools()` derives the tools from a collection's fields, and
`mcpRoute()` serves them over MCP's Streamable HTTP transport. Every call runs
through the Local API with the editor's session as its context, so an agent
gets exactly the access, validation and hooks a person editing the site gets.
[ADR 0009](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0009-mcp-server-agent-editing.md)
has the design. No runtime dependencies and no bindings beyond D1.

## Mounting the endpoint

```ts
import { editorForUser } from "louise-toolkit/auth";
import { agentTokensRoute, mcpRoute, resolveMcpSession } from "louise-toolkit/mcp";
import { composeWorker } from "louise-toolkit/worker";

const collections = [
  {
    table: pages,
    config: pagesConfig,
    // The same draft store the editor's versionsRoute uses. Leave it out and
    // pages are read-only over MCP.
    drafts: { versionsTable: pagesVersions, bufferKv: (env) => env.DRAFTS },
  },
];

export default composeWorker({
  gate: { resolveEditor },
  routes: [
    mcpRoute({
      collections,
      resolveEditor,
      resolveAgent: resolveMcpSession({
        resolveUser: (userId, env) => editorForUser(env, userId),
      }),
      server: { name: "site-example", version: "1.0.0" },
      instructions: "Pages are the site's top-level pages. Posts are its news.",
    }),
    agentTokensRoute({ collections, resolveEditor }),
  ],
  fetch: app.fetch,
});
```

| Option          | Default           | What it does                                                                                       |
| --------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `collections`   | —                 | `{ table, config, drafts? }` for each collection an agent may reach. See [Writes](#writes).        |
| `resolveEditor` | —                 | The same resolver the other editor routes take. A call with no bearer token runs as this editor.   |
| `resolveAgent`  | none              | Turns an agent token into the editor it acts for; normally `resolveMcpSession`. Omit it for none.  |
| `server`        | —                 | `{ name, version, title? }`, the server's identity. The name is the site's, so there's no default. |
| `instructions`  | none              | Guidance a client can give the model about the site. Don't repeat the tool descriptions.           |
| `sections`      | none              | The section catalog, passed to `collectionTools`.                                                  |
| `path`          | `/api/louise/mcp` | Where the endpoint mounts.                                                                         |

The route returns `undefined` for any other path, so `composeWorker` falls
through. From a framework route, run it with `runEditorRoute` from
`louise-toolkit/editor`, and set `apiGate.takesBearer` in the Astro middleware
so a request with a token reaches it.

## Agent tokens

A signed-in editor in a browser calls the endpoint with their session cookie,
same-origin, like any editor route. An agent with no browser, such as Claude
Code, can't: it has no cookie and sends no `Origin`. It sends an **agent token**
instead, in `Authorization: Bearer`. The token is the CSRF defense, so a request
it authenticates skips the origin check. A request with a bearer token is
authenticated by the token alone; its cookie isn't consulted.

A token:

- **Acts as the editor who issued it,** narrowed to a scope. Every call still
  runs through the Local API with that editor's session, so access functions
  and hooks fire as they would for the editor, and can read `session.agent` to
  treat an agent differently.
- **Has a scope, and no default one.** The scope maps each collection slug to
  `read`, `draft`, or `publish`; each includes the one before. A collection it
  doesn't list gets no tools, and a call to one of its tools comes back as a
  tool error. `draft` saves drafts, and `publish` changes the live site.
- **Expires.** 30 days unless the issuer says otherwise, and never more than 90.
- **Is revocable, immediately.** The check reads D1's primary on every request,
  so a revoked token stops working on its next call.
- **Stops working when its editor loses access.** `resolveUser` re-derives the
  editor on every request. `editorForUser` from `louise-toolkit/auth` refuses a
  user who isn't an admin, is banned, or has left the sign-in allowlist; pass it
  the same `tablePrefix` and `resolveAdmins` you give `getLouiseAuth`.
- **Is stored only as a hash.** The token itself is shown once, when it's issued.
  It starts with `louise_at_`, so a secret scanner can spot one that leaked.

Treat a token like a password. Unlike a session cookie, nothing in the browser
protects it, so whoever holds it can act as the editor within its scope until
it expires or is revoked. Keep it in the agent's secret store, not in a
repository or a shared config file, and send it only over HTTPS.

### Storing tokens

Add the `agent_tokens` table to the schema drizzle-kit reads, and generate a
migration:

```ts
// db/schema.ts
export { agentTokens } from "louise-toolkit/mcp";
```

To add columns of your own, spread `agentTokensColumns` into your own
`sqliteTable("agent_tokens", …)` and pass that table as `table` to
`resolveMcpSession` and `agentTokensRoute`.

### Issuing and revoking

`agentTokensRoute({ collections, resolveEditor })` mounts at
`/api/louise/mcp/tokens`. It takes only the session cookie, same-origin, so a
token can't issue or revoke tokens. An editor sees and revokes only their own.

| Request            | Body                              | Answer                                                    |
| ------------------ | --------------------------------- | --------------------------------------------------------- |
| `GET`              | none                              | `{ tokens }`: each token's ID, name, scope, and dates     |
| `POST`             | `{ name, scope, expiresInDays? }` | `201` with `{ token, info }`, the only time `token` shows |
| `DELETE ?id=tok_…` | none                              | `204`, or `404` when there's no live token with that ID   |

Until the studio has a panel for tokens, an editor can issue one from the
browser console on the signed-in site:

```js
await fetch("/api/louise/mcp/tokens", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Claude Code on Kai's laptop", scope: { pages: "read" } }),
}).then((r) => r.json());
```

`issueAgentToken`, `listAgentTokens`, and `revokeAgentToken` are the same
operations as functions, for a script or your own interface.

### Connecting an agent

Give the agent the endpoint and the token. With Claude Code:

```sh
claude mcp add --transport http site-example https://example.com/api/louise/mcp \
  --header "Authorization: Bearer $LOUISE_AGENT_TOKEN"
```

A bad, expired, or revoked token gets `401` with a
`WWW-Authenticate: Bearer` challenge.

## The tools

For each collection, `mcpRoute` offers the read tools `collectionTools`
generates, and the write tools where the collection allows them:

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

## Writes

An agent's edit takes the path a person's takes. A draft save runs through
`applySaveDraft` and a publish through `applyPublish`, both from
`louise-toolkit/editor`. So the collection's hooks, its `validate`, soft-locks,
conflict checks, and access functions all apply, and a pending draft is never
reverted by an agent that didn't see it.

| Tool                  | Arguments                  | Scope     | Access function | Result                                  |
| --------------------- | -------------------------- | --------- | --------------- | --------------------------------------- |
| `create_<slug>`       | the collection's fields    | `draft`   | `create`        | A new, unpublished document and a draft |
| `update_<slug>_field` | `id`, `field`, `value`     | `draft`   | `update`        | A new draft version                     |
| `add_<slug>_section`  | `id`, `section`, `values?` | `draft`   | `update`        | A new draft version                     |
| `publish_<slug>`      | `id`                       | `publish` | `publish`       | The pending draft, live                 |

These rules apply only to a collection with `versions.drafts` and a `drafts`
store in its `collections` entry:

- **Every edit is a draft.** The live row doesn't move until `publish_<slug>`,
  which takes `publish` scope. A draft-only token can prepare changes for a
  person to review, and can't put anything live.
- **Every draft names its author.** The collection must set
  `versions.provenance`, which adds `author` and `source` columns to its
  versions table. An agent's version records its token's ID and
  `source: "agent"`. `mcpRoute` throws at startup when a `drafts` store's table
  lacks those columns, so an agent edit can't go unrecorded.
- **An agent's save reaches D1 at once,** even with the KV buffer on, so the
  version it makes is the agent's. It still builds on buffered work, and leaves
  the buffer holding the result.
- **Visibility isn't a field.** `status` and `publishedVersionId` aren't in
  any write tool's schema. A new document starts unpublished.
- **Model HTML is held to text structure.** Rich text in a section an agent
  writes goes through `sanitizeModelHtml` from `louise-toolkit/security`, then
  the collection's own hooks.
- **Sections come from the catalog.** `add_<slug>_section` exists only when
  you pass `sections` and the collection has a `sections` field. It validates
  the new section against the catalog before saving, and a person's edit to the
  sections in between is a conflict rather than something the append reverts. `update_<slug>_field` on `sections` runs the same catalog check over the
  whole list.

A collection **without drafts** has nowhere to hold a draft, so its only write
is `create_<slug>`, which is live at once. It takes `publish` scope for that
reason.

### Recording provenance

Set `versions.provenance` on the collection, build its versions table with
`collectionVersionsTable`, and generate the migration:

```ts
const pagesConfig = defineCollection({
  slug: "pages",
  fields,
  versions: { drafts: true, provenance: true },
});
export const pagesVersions = collectionVersionsTable(pagesConfig);
```

**Apply the migration before the deploy that turns it on.** The versions table
is read with every column it declares, so code that knows the new columns fails
against a database that doesn't have them yet.

Once it's on, every version records who wrote it, not only an agent's: an
editor's save records their user ID with `source: "editor"`. The realtime
session's save records `"realtime"` when its `persist` passes
`{ source: "realtime" }` to `applySaveDraft`.

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
They generate every tool a collection could have, including the write tools;
`mcpRoute` serves the ones its configuration allows. `reservedAgentFields`
names the fields the write schemas leave out.
