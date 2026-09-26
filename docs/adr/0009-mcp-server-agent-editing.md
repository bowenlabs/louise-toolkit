# ADR 0009: Louise MCP server, agent-editable content over the Local API

- **Status:** Accepted (2026-07-19). Design of record for issue #103. **Amended 2026-08-30** (see _Amendment_ below) when slice 1 landed: the hand-rolled transport stands, the target spec revision moves, and `add_block` defers to the write slice. **Amended 2026-09-26** (see _Amendment (2026-09-26)_ below) when slice 2 landed: the route serves both protocol eras, and the official SDK client tests it without shipping in it.
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #103 (in the Platform features push milestone, epic #102)
- **Related:** #75 / #99 (AI assists, which become MCP consumers), #16 (Local API + access), #10 (editor routes / `composeWorker`), ADR 0006 (keep hand-rolled `composeWorker`, zero-dep core)

## Context

#103 asks for `louise/mcp`: a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes each Louise collection's typed CRUD + search as MCP tools. Any agent (Claude, Cursor, Louise's own AI assists) then reads and edits a live site through the **same** validation, hooks, and access rules a human gets when editing in place. The pitch, "humans edit in place; agents edit over the same typed primitives", is an OSS attention driver and an internal lever (edit client sites from Claude).

The substrate the issue leans on already exists, and this ADR verified it:

- **`createLocalApi` (`core/content/localApi.ts`)** provides typed `find`/`findByID`/`count`/`search`/`reindexSearch`/`create`/`update`/`deleteByID`. Every method takes a `context` (Louise types it `{ session }`) as its first argument and runs the matching **access function** before touching D1 (`read` for `find`/`findByID`/`search`/`count`, `create`/`update`/`delete` for the writes). This _is_ the tool surface, and the access enforcement is already wired.
- **`CollectionAccess` (`core/content/types.ts:355`)** holds per-operation `AccessFn`s: `create`, `read`, `update`, `delete`, and a **separate** `publish`. "No access fn configured ⇒ that op is unconditionally allowed." An agent that passes a human's `EditorSession` as `context` therefore gets _exactly_ that human's permissions with no new authz code.
- **The draft and version model (`core/editor/versions.ts`, `createVersionedLocalApi`)**: collections with `versions.drafts` get a `${slug}_versions` table and a `published_version_id` pointer, and the live row is never mutated directly. `applySaveDraft` merges an edit into the newest pending draft and writes a new draft version; `publish` (gated by the distinct `publish` access fn) promotes it. This is the "writes go through drafts, not straight to published" path #103 calls for, and it's already built.
- **The editor route pattern (`core/editor/*`, `guardEditor`/`ResolveEditor`, `composeWorker`)**: framework-generic factories return a `WorkerRoute`, which `composeWorker` mounts and Astro can run through `runEditorRoute`. The MCP endpoint is the same shape with a JSON-RPC body.
- **The auth guard (`core/auth/guard.ts`)**: `requireEditor` runs a same-origin (`Origin`/`Referer`) CSRF check on mutations and **rejects when neither header is present**, so a non-browser client can't write on a session cookie alone.

Two hard constraints from ADR 0006 frame the design:

- **`WorkerRoute` is the public primitive**, and factories must also run under `runEditorRoute` (no Worker `ctx`). The MCP server must be a `WorkerRoute` factory, with no new transport contract.
- **Zero runtime dependencies in core** (`louise-toolkit`'s `dependencies` is `{}`). A new dependency must clear a high bar.

## Decision

Ship `louise/mcp` as a **new `./mcp` subpath** that exports framework-generic factories, in the mould of `louise-toolkit/editor`. Six decisions define it.

### 1. Transport: hand-rolled Streamable HTTP JSON-RPC, zero-dep

Implement the MCP wire protocol (Streamable HTTP: `initialize`, `tools/list`, `tools/call`, and the JSON-RPC envelope) as a single `mcpRoute()` `WorkerRoute`, not through `@modelcontextprotocol/sdk`.

The rationale is consistent with ADR 0006. The reference SDK is Node/`node:http`-oriented and would be the **first** runtime dependency in a deliberately zero-dep core. The protocol surface Louise needs is small and stable. And hand-rolling keeps the endpoint a plain `WorkerRoute` that `composeWorker` mounts and Astro runs unchanged. If the protocol surface grows (resources, prompts, sampling, SSE notifications) past what's cheap to maintain, revisit adopting the SDK **confined behind the mount** as an optional adapter. That's the same escape hatch ADR 0006 left for Hono.

### 2. Tool generation from `CollectionConfig`

A pure `collectionTools(config)` (data in, data out, like `structure.ts`) derives per-collection MCP tool definitions from `config.fields`:

- Read: `list_<slug>`, `get_<slug>`, `search_<slug>` (only when the collection has a `search` config), `count_<slug>`.
- Write (versioned collections): `update_<slug>_field`, `add_<slug>_section`, `add_<slug>_block`, `create_<slug>`, and a separate `publish_<slug>`.

Input JSON Schema comes from the existing field → schema path (`schema-gen.ts` / the `s` schema layer), so a tool's arguments validate with the same rules as an in-place edit. Collections marked `admin.hidden` are omitted; `admin.readOnly` collections expose read tools only. The section and block catalog (`content/sections.ts`, `content/blocks.ts`) feeds the `add_section`/`add_block` argument schemas, so an agent can only insert catalog-valid sections.

### 3. Access: reuse `can()`, add nothing

Every tool invocation passes the resolved agent `EditorSession` as the Local API `context`. Read tools run through `createLocalApi`; the collection's `read`/`create`/`update`/`delete` access fns and `beforeChange`/`afterChange` hooks fire exactly as they do for a human. There's no parallel authorization layer: the agent is capability-equivalent to the human whose session backs the token.

### 4. Writes are draft-gated; publish is a separate tool

Write tools call `applySaveDraft` / the versioned API's `saveDraft`, so edits land as **draft versions**, never on the live row. Going live is a distinct `publish_<slug>` tool gated by the `publish` access fn, so a token can be scoped to "draft only." Each agent-authored version records provenance (the token or agent ID) for audit. Non-versioned collections either expose no write tools or write directly only when a token is explicitly allowed to. Slice 4 decides which.

### 5. Auth: a bearer-token path distinct from the cookie and same-origin gate

A headless agent sends no `Origin`/`Referer`, so `requireEditor`'s CSRF check would reject every write. The MCP endpoint therefore authenticates through a **bearer token** that `resolveMcpSession(request, env)` maps to an `EditorSession` (satisfying `ResolveEditor`'s shape). The token _is_ the CSRF defense, so the same-origin check is bypassed for token-authenticated requests only. Tokens are scoped (which collections, read or write, draft or publish) and revocable. A browser-origin session cookie continues to work for same-origin callers (for example, Louise's own in-app AI assists).

### 6. Packaging and distribution

A new `./mcp` export in `packages/louise/package.json` (mirroring `./editor`/`./content`) → `dist/core/mcp/index.js`; a Starlight reference page; a changeset; and an [MCP registry](https://modelcontextprotocol.io) listing + server manifest for free OSS distribution.

## Slice plan (issue #103 → sub-issues)

The work ships as vertical, independently reviewable slices, per the repository's PR-per-slice norm:

1. **`louise/mcp` core + tool generation**: pure `collectionTools(config)`, JSON Schema from fields, `admin.hidden`/`readOnly` handling, and section and block catalog wiring. Fully unit-testable, no transport. _(task: tool generation)_
2. **Read MVP + transport**: hand-rolled Streamable-HTTP JSON-RPC `mcpRoute()` `WorkerRoute`; `initialize`/`tools/list`/`tools/call`; read tools over `createLocalApi` with the session as `context`. _(task: read tools MVP)_
3. **Auth for headless agents**: `resolveMcpSession` bearer-token path → `EditorSession`, scoped + revocable tokens, same-origin bypass for token requests only. _(task: session/auth)_
4. **Draft-gated write tools**: `update_field`/`add_section`/`add_block`/`create` through `applySaveDraft`; a separate `publish` tool through the `publish` access fn; per-version agent provenance. _(task: write tools gated through drafts + `can()`)_
5. **Publish + register**: `./mcp` export, Starlight docs, changeset, MCP-registry listing + manifest. _(task: publish + register)_

## Amendment (2026-08-30, at slice 1)

Three things had moved since this ADR was written. None overturns the preceding
decision; all three change what slices 2–4 should build against.

### Cloudflare now ships a Workers-native MCP handler, and the hand-roll still wins

Decision 1 declined `@modelcontextprotocol/sdk` on two grounds: it's
Node/`node:http`-oriented, and it would be the first runtime dependency in a
deliberately zero-dep core. **The first ground no longer holds.** Cloudflare's
Agents SDK now offers `createMcpHandler()`, a _stateless_ Workers-native MCP
handler that needs no Durable Object, alongside the stateful `McpAgent` that does.

The second ground holds completely, and it was always the load-bearing one. The
`agents` package is still a runtime dependency, and ADR 0006 keeps the core at
zero. So `packages/louise` continues to hand-roll.

What genuinely changes is that there's now a credible option for **astroid**,
which already depends on `louise-toolkit` and exists to be the opinionated layer.
A scaffolded site could mount `createMcpHandler` over the same
`collectionTools()` output this slice produces, without the core taking the
dependency. It's worth revisiting if the hand-rolled transport in slice 2 grows
past `initialize`/`tools/list`/`tools/call`.

### Target the current spec revision, not the one this ADR was written against

The MCP specification has revised to **2026-07-28**, after this ADR. Slice 2
implements against that revision. Nothing in decision 1 depends on which revision
is current (the point was that the surface Louise needs is small and stable), but
the implementation shouldn't silently target a stale one.

### `add_block` defers to the write slice

Slice 1 generates `add_<slug>_section` from the `SectionCatalog`, as planned, but
**not** `add_<slug>_block`. The reason is structural rather than schedule
pressure: `content/blocks.ts` is a _renderer registry_ (`createBlockRegistry`,
`renderBlocksToString`), not a catalog of insertable block types, and per ADR 0005
blocks are a policy declared **on a section** rather than a free-standing library.
So there's nothing at this layer to derive an argument schema from.

Generating the tool anyway would mean inventing a block catalog to satisfy the
slice plan, which is the wrong order. It arrives with slice 4, where the write
path establishes what inserting a block actually means.

## Amendment (2026-09-26, at slice 2)

The 2026-07-28 revision that the first amendment pointed slice 2 at turned out
to change the part of the protocol that decision 1 names. It removes the
`initialize` handshake and protocol-level sessions. Every request carries its
version and the client's capabilities in `_meta`, a server must implement
`server/discover`, and the Streamable HTTP transport checks the
`MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers against the body.

### The route serves both eras

Implementing only 2026-07-28 would leave the route unreachable from most
clients. The official TypeScript client, 2.1.0 at the time of writing, still
opens with `initialize` unless a caller opts in to the new negotiation, and a
client of the older era has no way to move forward to a newer server. The
revision defines a dual-era server for exactly this case, so `mcpRoute` is one:

- A request whose `_meta` names a protocol version is served statelessly, as
  2026-07-28 defines it.
- An `initialize` opens the 2025-11-25, 2025-06-18 or 2025-03-26 handshake.

Neither era needs state here, so the cost of serving both is a few branches
rather than a second implementation. The route never mints a session ID in
either era, and it answers `GET` and `DELETE` with `405`. Decision 1's
`initialize`/`tools/list`/`tools/call` becomes `server/discover` or
`initialize`, plus `tools/list` and `tools/call`.

### The SDK tests the route, without shipping in it

The core still has no runtime dependency, and the hand-rolled transport
stands. The official `@modelcontextprotocol/client` is a devDependency instead:
the route's tests connect it in both eras. A client nobody here wrote is the
evidence that the hand-rolled route speaks the protocol, and a devDependency
never reaches a site.

### `tools/list` asks `can()` before it lists a tool

Decision 3 reuses `can()` for every call. `tools/list` now asks it too, and
leaves out a collection whose `read` access function refuses the editor, so an
agent never chooses a tool only to be refused. The Local API still checks on
the call. Because the list depends on who asks, a 2026-07-28 `tools/list` marks
its result `cacheScope: "private"`.

## Consequences

- Core stays zero-dep. The MCP server is a `WorkerRoute` that `composeWorker` mounts and `runEditorRoute` runs from Astro, with no new public transport contract.
- Agents inherit human permissions verbatim (the `can()` path) and can't bypass validation or hooks, because they call the _same_ Local API.
- Agent edits are safe by default: draft-scoped, with publish as a separately gated privilege and an audit trail on every version.
- One genuinely new security surface, the bearer-token issuer, scoper, and revoker, is introduced deliberately in slice 3 and is the highest-review-value part of the feature.

## Open questions

- **Token model**: reuse the existing session and auth store for agent tokens, or a dedicated scoped-token table? (Settled in slice 3.)
- **Non-versioned collections**: expose write tools at all, or stay read-only until a collection opts into `versions.drafts`?
- **Registry timing**: list publicly only after slices 1–4 are on `main`, to avoid advertising an incomplete server.
