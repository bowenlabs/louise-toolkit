// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—tool generation (ADR 0009, slice 1 of #103).
//
// Pure data in / data out, like `content/structure.ts`: this derives the MCP
// tool *definitions* a collection exposes, and nothing else. No transport, no
// Local API, no session—those live in `route.ts`. Everything here is
// synchronous and trivially testable, which is the point of splitting it out.
//
// The pitch the whole feature rests on: humans edit in place, agents edit over
// the SAME typed primitives. So a tool's arguments are derived from the very
// `FieldConfig` map that drives codegen, the schema layer and the editor—never
// hand-written—and the tools an agent gets are exactly the operations that
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

/** The operations that only read, which `mcpRoute` executes. */
export const MCP_READ_OPERATIONS: readonly McpToolOperation[] = ["list", "get", "count", "search"];

/** MCP's behavior hints for a tool. Clients treat them as hints, never as a
 *  guarantee, so they describe the tool rather than enforce anything. */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One generated tool, in the shape `tools/list` reports it. */
export interface McpTool {
  /** Wire name, for example, `get_pages`. Unique across a config. */
  name: string;
  /** What the tool does and when to use it, which is what an agent reads to
   *  choose between tools that overlap. */
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: JsonSchema;
  annotations: McpToolAnnotations;
  /** The collection this acts on—not part of the MCP wire shape, but what
   *  the route's dispatcher routes on. */
  collection: string;
  operation: McpToolOperation;
}

/** Most documents a list or search call returns, and the default. */
export const MCP_LIMIT_MAX = 100;
export const MCP_LIMIT_DEFAULT = 20;

export interface CollectionToolsOptions {
  /**
   * The site's section catalog. Supplying it adds `add_<slug>_section` for
   * writable versioned collections, with `section` constrained to the catalog's
   * names—so an agent cannot insert a section the site does not render.
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
      // `SectionField` allows), and may be a resolver function—which cannot be
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
      // ISO 8601 on the wire regardless of the column's storage mode—an agent
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
      // Genuinely arbitrary—an empty schema accepts anything, which is
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

/** A page size, bounded so a call can't ask for the whole table at once. */
const LIMIT_ARG: JsonSchema = {
  type: "integer",
  minimum: 1,
  maximum: MCP_LIMIT_MAX,
  description: `Maximum documents to return. Default ${MCP_LIMIT_DEFAULT}.`,
};

// Reads touch nothing; the writes below only ever add a draft or publish one,
// never delete, and a site's content is a closed world either way.
const READ: McpToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const WRITE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
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
 * through the draft path—a collection with no version history has nowhere safe
 * to land one. `publish_<slug>` is generated separately from the write tools so a
 * token can be scoped to draft-only.
 *
 * Every description says when to use the tool as well as what it does, and
 * names the better tool where two overlap: an agent picks from descriptions
 * alone, so that sentence is the whole of its guidance.
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
  const drafts = collection.versions?.drafts === true;
  // Reads return the main row. A pending draft edit lives in the version
  // history, so an agent needs telling that it won't see one.
  const noDrafts = drafts ? " Unpublished draft edits aren't included." : "";
  const findHint = collection.search
    ? ` To find documents about a topic, use \`search_${slug}\` instead.`
    : "";

  tools.push({
    ...base,
    operation: "list",
    name: `list_${slug}`,
    description: `List ${name} documents, newest first.${noDrafts} Use it to browse or page through the collection.${findHint}`,
    annotations: READ,
    inputSchema: {
      type: "object",
      properties: {
        limit: LIMIT_ARG,
        offset: { type: "integer", minimum: 0, description: "Documents to skip. Default 0." },
      },
      additionalProperties: false,
    },
  });

  tools.push({
    ...base,
    operation: "get",
    name: `get_${slug}`,
    description: `Fetch one ${name} document by id.${noDrafts} Use it when you already have the id, for example from \`list_${slug}\`${collection.search ? ` or \`search_${slug}\`` : ""}.`,
    annotations: READ,
    inputSchema: ID_ARG,
  });

  tools.push({
    ...base,
    operation: "count",
    name: `count_${slug}`,
    description: `Count ${name} documents. Use it to size the collection before paging through it with \`list_${slug}\`.`,
    annotations: READ,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  });

  // Only when the collection actually has an FTS index—otherwise the tool
  // would advertise a capability `createLocalApi` cannot serve.
  if (collection.search) {
    tools.push({
      ...base,
      operation: "search",
      name: `search_${slug}`,
      description: `Full-text search ${name} across: ${collection.search.fields.join(", ")}. Use it to find documents about a topic or containing given words; prefer it to \`list_${slug}\` whenever you're looking for something rather than browsing. Every word must match, and a word matches as a prefix.`,
      annotations: READ,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, description: "Search terms." },
          limit: LIMIT_ARG,
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
    description: drafts
      ? `Create a ${name} document, saved as a draft. Nothing goes live until someone publishes it. Use it to add a new document; to change one that exists, use \`update_${slug}_field\`.`
      : `Create a ${name} document. This collection keeps no drafts, so the document is live as soon as it's created. Use it only to add a new document.`,
    annotations: WRITE,
    inputSchema: fieldsSchema,
  });

  // Everything below edits an existing document, and every agent edit lands as a
  // draft—so these exist only where there is a version history to land in.
  if (!drafts) return tools;

  const editable = Object.keys(flattenFields(collection.fields));
  tools.push({
    ...base,
    operation: "update_field",
    name: `update_${slug}_field`,
    description: `Set one field on a ${name} document, saved as a new draft version. The published document doesn't change until someone publishes the draft. Use it for a targeted edit to a document that exists.`,
    annotations: WRITE,
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
      description: `Append a section to a ${name} document, saved as a new draft version. The published document doesn't change until someone publishes the draft. Use it to add page content from the site's section catalog.`,
      annotations: WRITE,
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
    description: `Publish the current draft of a ${name} document, making it live on the site. Call it only when the person has asked you to publish; otherwise leave your edits as drafts for them to review.`,
    annotations: { ...WRITE, idempotentHint: true },
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
