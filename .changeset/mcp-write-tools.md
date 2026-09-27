---
"louise-toolkit": minor
---

The MCP route serves the write tools (#236, ADR 0009 slice 4). An agent can now create documents, set a field, add a section, and publish, under the same hooks, validation, soft-locks, and access functions a person's edit meets.

- **`mcpRoute` collections take `drafts`:** the draft store the editor's `versionsRoute` uses (`versionsTable`, and `bufferKv`, `validate`, `softLocks`, and `redirects` if you use them). With it, a collection with drafts gets `create_<slug>`, `update_<slug>_field`, `add_<slug>_section`, and `publish_<slug>`. Every edit lands as a draft version, and only `publish_<slug>` puts it live, which takes `publish` scope. Without `drafts`, the collection stays read-only over MCP, as it was.
- **A collection without drafts gets `create_<slug>`,** which is live at once and so takes `publish` scope. It's served to any editor or token whose scope and `create` access allow it.
- **`versions.provenance`** records who wrote each version, in new `author` and `source` columns on `${slug}_versions`: an editor's user ID or an agent token's ID, and `editor`, `realtime`, or `agent`. `collectionVersionsTable` and `generateSchemaSource` add the columns only when it's set, and `mcpRoute` requires it for a collection's write tools.
- **`applyPublish`** in `louise-toolkit/editor` is the body of `POST /:id/publish` as a function, shared by `versionsRoute` and `publish_<slug>`. `applySaveDraft` takes `source: "realtime"`, for the realtime session's `persist`.
- **Write tool schemas leave out `status` and `publishedVersionId`** on a collection with drafts (`reservedAgentFields`), and `add_<slug>_section` is generated only for a collection with a `sections` field.

**Upgrading:** nothing changes until you pass `drafts`. To turn on agent writes, set `versions: { drafts: true, provenance: true }` on the collection, generate the migration that adds `author` and `source` to its versions table, and **apply it before the deploy that sets the flag**. The versions table is read with every column it declares, so code with the flag fails against a database without the columns. `louise migrations-check` catches it before a deploy. Then pass `drafts` to `mcpRoute`, and have the realtime `persist` pass `{ source: "realtime" }` to `applySaveDraft`.
