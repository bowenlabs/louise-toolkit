# ADR 0009 — Louise MCP server: agent-editable content over the Local API

- **Status:** Proposed (2026-07-19) — design of record for issue #103, pending review before slice 1 lands.
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #103 (milestone: Platform features push, epic #102)
- **Related:** #75 / #99 (AI assists — become MCP consumers), #16 (Local API + access), #10 (editor routes / `composeWorker`), ADR 0006 (keep hand-rolled `composeWorker`, zero-dep core)

## Context

#103 asks us to ship `louise/mcp` — a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes each Louise collection's typed CRUD + search as MCP tools, so any agent (Claude, Cursor, our own AI assists) reads and edits a live site through the **same** validation, hooks, and access rules a human gets editing in place. The pitch — "humans edit in place; agents edit over the same typed primitives" — is an OSS attention driver and an internal lever (edit client sites from Claude).

The substrate the issue leans on already exists and was verified for this ADR:

- **`createLocalApi` (`core/content/localApi.ts`)** — typed `find`/`findByID`/`count`/`search`/`reindexSearch`/`create`/`update`/`deleteByID`. Every method takes a `context` (Louise types it `{ session }`) as its first argument and runs the matching **access function** before touching D1 (`read` for `find`/`findByID`/`search`/`count`, `create`/`update`/`delete` for the writes). This _is_ the tool surface, and the access enforcement is already wired.
- **`CollectionAccess` (`core/content/types.ts:355`)** — per-operation `AccessFn`s: `create`, `read`, `update`, `delete`, and a **separate** `publish`. "No access fn configured ⇒ that op is unconditionally allowed." An agent that passes a human's `EditorSession` as `context` therefore gets _exactly_ that human's permissions with no new authz code.
- **Draft/version model (`core/editor/versions.ts`, `createVersionedLocalApi`)** — collections with `versions.drafts` get a `${slug}_versions` table and a `published_version_id` pointer; the live row is never mutated directly. `applySaveDraft` merges an edit into the newest pending draft and writes a new draft version; `publish` (gated by the distinct `publish` access fn) promotes it. This is the "writes go through drafts, not straight to published" path #103 calls for — already built.
- **Editor route pattern (`core/editor/*`, `guardEditor`/`ResolveEditor`, `composeWorker`)** — framework-generic factories returning a `WorkerRoute`, mounted by `composeWorker` and runnable from Astro via `runEditorRoute`. The MCP endpoint is the same shape with a JSON-RPC body.
- **Auth guard (`core/auth/guard.ts`)** — `requireEditor` runs a same-origin (`Origin`/`Referer`) CSRF check on mutations and **rejects when neither header is present**, so a non-browser client can't write on a session cookie alone.

Two hard constraints from ADR 0006 frame the design:

- **`WorkerRoute` is the public primitive** and factories must also run under `runEditorRoute` (no Worker `ctx`). The MCP server must be a `WorkerRoute` factory, no new transport contract.
- **Zero runtime dependencies in core** (`louise-toolkit`'s `dependencies` is `{}`). A new dep must clear a high bar.

## Decision

Ship `louise/mcp` as a **new `./mcp` subpath** exporting framework-generic factories, in the mould of `louise-toolkit/editor`. Six decisions define it.

### 1. Transport: hand-rolled Streamable HTTP JSON-RPC, zero-dep

Implement the MCP wire protocol (Streamable HTTP: `initialize`, `tools/list`, `tools/call`, and the JSON-RPC envelope) as a single `mcpRoute()` `WorkerRoute`, not via `@modelcontextprotocol/sdk`.

Rationale, consistent with ADR 0006: the reference SDK is Node/`node:http`-oriented and would be the **first** runtime dependency in a deliberately zero-dep core; the protocol surface we need is small and stable; and hand-rolling keeps the endpoint a plain `WorkerRoute` that `composeWorker` mounts and Astro runs unchanged. If the protocol surface grows (resources, prompts, sampling, SSE notifications) past what's cheap to maintain, revisit adopting the SDK **confined behind the mount** as an optional adapter — the same escape hatch ADR 0006 left for Hono.

### 2. Tool generation from `CollectionConfig`

A pure `collectionTools(config)` (data in / data out, like `structure.ts`) derives per-collection MCP tool definitions from `config.fields`:

- Read: `list_<slug>`, `get_<slug>`, `search_<slug>` (only when the collection has a `search` config), `count_<slug>`.
- Write (versioned collections): `update_<slug>_field`, `add_<slug>_section`, `add_<slug>_block`, `create_<slug>`, and a separate `publish_<slug>`.

Input JSON Schema comes from the existing field → schema path (`schema-gen.ts` / the `s` schema layer), so a tool's arguments validate with the same rules as an in-place edit. Collections marked `admin.hidden` are omitted; `admin.readOnly` collections expose read tools only. The section/block catalog (`content/sections.ts`, `content/blocks.ts`) feeds the `add_section`/`add_block` argument schemas so an agent can only insert catalog-valid sections.

### 3. Access: reuse `can()`, add nothing

Every tool invocation passes the resolved agent `EditorSession` as the Local API `context`. Read tools run through `createLocalApi`; the collection's `read`/`create`/`update`/`delete` access fns and `beforeChange`/`afterChange` hooks fire exactly as for a human. No parallel authorization layer — the agent is capability-equivalent to the human whose session backs the token.

### 4. Writes are draft-gated; publish is a separate tool

Write tools call `applySaveDraft` / the versioned API's `saveDraft` — edits land as **draft versions**, never on the live row. Going live is a distinct `publish_<slug>` tool gated by the `publish` access fn, so a token can be scoped to "draft only." Each agent-authored version records provenance (the token/agent id) for audit. Non-versioned collections either expose no write tools or write directly only when a token is explicitly allowed to — decided per slice 4.

### 5. Auth: a bearer-token path distinct from the cookie/same-origin gate

A headless agent sends no `Origin`/`Referer`, so `requireEditor`'s CSRF check would reject every write. The MCP endpoint therefore authenticates via a **bearer token** that `resolveMcpSession(request, env)` maps to an `EditorSession` (satisfying `ResolveEditor`'s shape); the token _is_ the CSRF defense, so the same-origin check is bypassed for token-authenticated requests only. Tokens are scoped — which collections, read-vs-write, draft-vs-publish — and revocable. A browser-origin session cookie continues to work for same-origin callers (e.g. our own in-app AI assists).

### 6. Packaging & distribution

New `./mcp` export in `packages/louise/package.json` (mirroring `./editor`/`./content`) → `dist/core/mcp/index.js`; a Starlight reference page; a changeset; and an [MCP registry](https://modelcontextprotocol.io) listing + server manifest for free OSS distribution.

## Slice plan (issue #103 → sub-issues)

Shipped as vertical, independently reviewable slices, per the repo's PR-per-slice norm:

1. **`louise/mcp` core + tool generation** — pure `collectionTools(config)`, JSON-Schema from fields, `admin.hidden`/`readOnly` handling, section/block catalog wiring. Fully unit-testable, no transport. _(task: tool generation)_
2. **Read MVP + transport** — hand-rolled Streamable-HTTP JSON-RPC `mcpRoute()` `WorkerRoute`; `initialize`/`tools/list`/`tools/call`; read tools over `createLocalApi` with the session as `context`. _(task: read tools MVP)_
3. **Auth for headless agents** — `resolveMcpSession` bearer-token path → `EditorSession`, scoped + revocable tokens, same-origin bypass for token requests only. _(task: session/auth)_
4. **Draft-gated write tools** — `update_field`/`add_section`/`add_block`/`create` via `applySaveDraft`; separate `publish` tool via the `publish` access fn; per-version agent provenance. _(task: write tools gated through drafts + `can()`)_
5. **Publish + register** — `./mcp` export, Starlight docs, changeset, MCP-registry listing + manifest. _(task: publish + register)_

## Consequences

- Core stays zero-dep; the MCP server is a `WorkerRoute` `composeWorker` mounts and `runEditorRoute` runs from Astro — no new public transport contract.
- Agents inherit human permissions verbatim (the `can()` path) and cannot bypass validation or hooks, because they call the _same_ Local API.
- Agent edits are safe-by-default: draft-scoped, with publish a separately-gated privilege and an audit trail on every version.
- One genuinely new security surface — the bearer-token issuer/scoper/revoker — is introduced deliberately in slice 3 and is the highest-review-value part of the feature.

## Open questions

- **Token model**: reuse the existing session/auth store for agent tokens, or a dedicated scoped-token table? (Settled in slice 3.)
- **Non-versioned collections**: expose write tools at all, or read-only until a collection opts into `versions.drafts`?
- **Registry timing**: list publicly only after slices 1–4 are on `main`, to avoid advertising an incomplete server.
