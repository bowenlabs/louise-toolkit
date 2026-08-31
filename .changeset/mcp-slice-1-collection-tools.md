---
"louise-toolkit": minor
---

mcp: tool generation from `CollectionConfig` (ADR 0009, slice 1 of #103)

New `collectionTools(collection, { sections })` and `contentTools(config)` derive
the MCP tool definitions a site exposes to an agent. Pure data in / data out,
like `content/structure.ts` — no transport, no Local API, no session. Those are
slices 2–4.

The point of the feature is that humans edit in place and agents edit over the
**same** typed primitives, so a tool's arguments are derived from the very
`FieldConfig` map that drives codegen, the schema layer and the editor, never
hand-written. Groups flatten through `flattenFields`, exactly as every other
layer canonicalizes them, so an agent cannot send a shape the write path rejects.

Two existing `admin` hints decide the surface, rather than an MCP-specific
visibility flag: `admin.hidden` yields **no tools at all** (a system table a
human never browses is not one an agent should browse), and `admin.readOnly`
yields read tools only. `search_<slug>` appears only where the collection
actually has an FTS index. Edit and publish tools require `versions.drafts` —
every agent edit lands as a draft, and a collection with no version history has
nowhere safe to put one — and `publish_<slug>` is generated separately from the
write tools so a token can be scoped to draft-only.

`add_<slug>_section` is generated from the site's `SectionCatalog` when one is
supplied, with `section` constrained to the catalog's names, so an agent cannot
insert a section the site does not render.

Not included: `add_<slug>_block`. `content/blocks.ts` is a renderer registry, not
a catalog of insertable types, and per ADR 0005 blocks are a policy declared *on*
a section — so there is nothing at this layer to derive an argument schema from.
It arrives with slice 4, where the write path establishes what inserting a block
means. ADR 0009 is amended with this and two other findings, including that
Cloudflare's new Workers-native `createMcpHandler()` removes one of the two
reasons the transport is hand-rolled (the other, zero runtime dependencies in
core, still stands).

No `./mcp` subpath export yet — publishing is slice 5, so nothing here is public
API.
