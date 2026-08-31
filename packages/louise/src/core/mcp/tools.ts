// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp` — tool generation (ADR 0009, slice 1 of #103).
//
// Pure data in / data out, like `content/structure.ts`: this derives the MCP
// tool *definitions* a collection exposes, and nothing else. No transport, no
// Local API, no session — those arrive in slices 2–4. Everything here is
// synchronous and trivially testable, which is the point of splitting it out.
//
// The pitch the whole feature rests on: humans edit in place, agents edit over
// the SAME typed primitives. So a tool's arguments are derived from the very
// `FieldConfig` map that drives codegen, the schema layer and the editor — never
// hand-written — and the tools an agent gets are exactly the operations that
// collection supports.

import { flattenFields } from "../content/types.js";
import type { CollectionConfig, ContentConfig, FieldConfig } from "../content/types.js";
import type { SectionCatalog, SectionField } from "../content/sections.js";

/** A JSON Schema fragment. Deliberately loose: MCP passes these through to the
 *  client verbatim, and pinning a full JSON Schema type here would buy nothing. */
export type JsonSchema = Record<string, unknown>;

/** Which primitive a tool maps to, for the slices that execute them. Callers
 *  switch on this rather than parsing {@link McpTool.name}. */
export type McpToolOperation =
  | "list"
  | "get"
  | "count"
  | "search"
  | "create"
  | "update_field"
  | "add_section"
  | "publish";

/** One generated tool, in the shape `tools/list` reports it. */
export interface McpTool {
  /** Wire name, e.g. `get_pages`. Unique across a config. */
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: JsonSchema;
  /** The collection this acts on — not part of the MCP wire shape, but what
   *  slice 2's dispatcher routes on. */
  collection: string;
  operation: McpToolOperation;
}

export interface CollectionToolsOptions {
  /**
   * The site's section catalog. Supplying it adds `add_<slug>_section` for
   * writable versioned collections, with `section` constrained to the catalog's
   * names — so an agent cannot insert a section the site does not render.
   * Omit it and no section tool is generated.
   */
  sections?: SectionCatalog;
}

/** JSON Schema for one editable field. */
function fieldSchema(field: FieldConfig | SectionField): JsonSchema {
  const described = (schema: JsonSchema): JsonSchema => {
    const label = "label" in field ? field.label : undefined;
    return label ? { ...schema, description: label } : schema;
  };

  switch (field.type) {
    case "select": {
      // `options` may be plain strings or `{value,label}` objects (the shape
      // `SectionField` allows), and may be a resolver function — which cannot be
      // enumerated without running it, so those degrade to a bare string.
      const options = "options" in field ? field.options : undefined;
      if (Array.isArray(options)) {
        const values = options.map((o) =>
          typeof o === "string" ? o : (o as { value: string }).value,
        );
        return described({ type: "string", enum: values });
      }
      return described({ type: "string" });
    }
    case "number":
      return described({ type: "number" });
    case "checkbox":
      return described({ type: "boolean" });
    case "date":
      // ISO 8601 on the wire regardless of the column's storage mode — an agent
      // should never have to know whether a column is seconds or milliseconds.
      return described({ type: "string", format: "date-time" });
    case "richText":
      // TipTap/ProseMirror document JSON. Left unconstrained on purpose: the
      // real shape is the editor's schema, and restating it here would create a
      // second definition to keep in sync.
      return described({
        type: "object",
        description: "Rich text as ProseMirror/TipTap document JSON.",
      });
    case "relationship": {
      const id = { type: ["string", "number"] };
      return described("hasMany" in field && field.hasMany ? { type: "array", items: id } : id);
    }
    case "array": {
      const sub = "fields" in field ? field.fields : undefined;
      return described({
        type: "array",
        items: sub ? objectSchema(sub as Record<string, FieldConfig>) : { type: "object" },
      });
    }
    case "upload":
      return described({ type: "string", description: "Media key or URL." });
    case "json":
      // Genuinely arbitrary — an empty schema accepts anything, which is
      // accurate, where `{type:"object"}` would wrongly reject an array.
      return described({});
    default:
      return described({ type: "string" });
  }
}

/** JSON Schema object for a field map, with `required` derived from the fields. */
function objectSchema(fields: Record<string, FieldConfig>): JsonSchema {
  const flat = flattenFields(fields);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(flat)) {
    properties[key] = fieldSchema(field);
    if (field.required) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    // An agent guessing a field name should get an error, not a silent no-op.
    additionalProperties: false,
  };
}

/** Section fields are the same shape modulo `FieldConfig`'s extras. */
function sectionObjectSchema(fields: Record<string, SectionField>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [key, field] of Object.entries(fields)) properties[key] = fieldSchema(field);
  return { type: "object", properties, additionalProperties: false };
}

/** The document id every per-document tool takes. */
const ID_ARG: JsonSchema = {
  type: "object",
  properties: { id: { type: ["string", "number"], description: "Document id." } },
  required: ["id"],
  additionalProperties: false,
};

const label = (c: CollectionConfig) => c.admin?.label ?? c.slug;

/**
 * The MCP tools one collection exposes.
 *
 * Two `admin` hints decide the shape, reusing what the Structure Builder already
 * reads rather than inventing an MCP-specific visibility flag:
 *
 *   - `admin.hidden` → **no tools at all**. These are system/log tables a human
 *     never browses, so an agent has no business browsing them either.
 *   - `admin.readOnly` → read tools only. The editor suppresses create/edit for
 *     machine-written tables; an agent gets the same treatment.
 *
 * Write tools require `versions.drafts`, because ADR 0009 puts every agent edit
 * through the draft path — a collection with no version history has nowhere safe
 * to land one. `publish_<slug>` is generated separately from the write tools so a
 * token can be scoped to draft-only.
 */
export function collectionTools(
  collection: CollectionConfig,
  options: CollectionToolsOptions = {},
): McpTool[] {
  if (collection.admin?.hidden) return [];

  const slug = collection.slug;
  const name = label(collection);
  const tools: McpTool[] = [];
  const base = { collection: slug } as const;

  tools.push({
    ...base,
    operation: "list",
    name: `list_${slug}`,
    description: `List ${name} documents, newest first.`,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum documents to return." },
        offset: { type: "number", description: "Documents to skip." },
      },
      additionalProperties: false,
    },
  });

  tools.push({
    ...base,
    operation: "get",
    name: `get_${slug}`,
    description: `Fetch one ${name} document by id.`,
    inputSchema: ID_ARG,
  });

  tools.push({
    ...base,
    operation: "count",
    name: `count_${slug}`,
    description: `Count ${name} documents.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  });

  // Only when the collection actually has an FTS index — otherwise the tool
  // would advertise a capability `createLocalApi` cannot serve.
  if (collection.search) {
    tools.push({
      ...base,
      operation: "search",
      name: `search_${slug}`,
      description: `Full-text search ${name} across: ${collection.search.fields.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms." },
          limit: { type: "number", description: "Maximum matches to return." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    });
  }

  if (collection.admin?.readOnly) return tools;

  const fieldsSchema = objectSchema(collection.fields);
  tools.push({
    ...base,
    operation: "create",
    name: `create_${slug}`,
    description: `Create a ${name} document.`,
    inputSchema: fieldsSchema,
  });

  // Everything below edits an existing document, and every agent edit lands as a
  // draft — so these exist only where there is a version history to land in.
  if (!collection.versions?.drafts) return tools;

  const editable = Object.keys(flattenFields(collection.fields));
  tools.push({
    ...base,
    operation: "update_field",
    name: `update_${slug}_field`,
    description: `Set one field on a ${name} document, saved as a draft version.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["string", "number"], description: "Document id." },
        // An enum, not a free string: a typo should fail at the tool boundary
        // rather than becoming a silently-ignored write.
        field: { type: "string", enum: editable, description: "Field to set." },
        value: { description: "New value, matching that field's type." },
      },
      required: ["id", "field", "value"],
      additionalProperties: false,
    },
  });

  if (options.sections) {
    const names = Object.keys(options.sections);
    tools.push({
      ...base,
      operation: "add_section",
      name: `add_${slug}_section`,
      description: `Append a section to a ${name} document, saved as a draft version.`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: ["string", "number"], description: "Document id." },
          section: { type: "string", enum: names, description: "Section type to insert." },
          // Per-section prop shapes, keyed by section name, so a client can see
          // what each accepts without a second round trip.
          values: {
            type: "object",
            description: "Section props.",
            oneOf: names.map((n) => ({
              title: n,
              ...sectionObjectSchema(options.sections?.[n]?.fields ?? {}),
            })),
          },
        },
        required: ["id", "section"],
        additionalProperties: false,
      },
    });
  }

  tools.push({
    ...base,
    operation: "publish",
    name: `publish_${slug}`,
    description: `Publish the current draft of a ${name} document, making it live.`,
    inputSchema: ID_ARG,
  });

  return tools;
}

/** Every tool across a content config, in collection order. */
export function contentTools(
  config: ContentConfig,
  options: CollectionToolsOptions = {},
): McpTool[] {
  return config.collections.flatMap((c) => collectionTools(c, options));
}
