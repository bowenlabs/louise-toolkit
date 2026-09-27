// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—`mcpRoute()`, the MCP endpoint (ADR 0009, slice 2).
//
// One `WorkerRoute` that answers MCP's Streamable HTTP transport with the read
// tools `collectionTools()` generates, run through the Local API with the
// editor's session as `context`. So a collection's `read` access function and
// its read hooks fire for an agent exactly as they do for a person.
//
// It speaks both eras of the protocol. A request whose `_meta` names a version
// is served statelessly, as the 2026-07-28 revision defines. An `initialize`
// opens the older handshake that most clients still send, and nothing here
// keeps state between requests in either era, so no session is ever minted.
//
// Two credentials reach it. A browser sends the editor's session cookie, which
// goes through `resolveEditor` and `guardEditor` like every other editor route,
// same-origin check included. An agent with no browser sends an agent token in
// `Authorization: Bearer`, which `resolveAgent` turns into the editor who issued
// it, narrowed to the token's scope (slice 3). The token is the CSRF defense,
// so that path skips the origin check; a request is judged by the credential it
// authenticated with, and one with a bearer token is judged by the token alone.
//
// The write tools (slice 4) run through the editor's own paths: a draft save is
// `applySaveDraft`, and a publish is `applyPublish`, so an agent's edit meets the
// same hooks, validation, soft-locks, and access functions a person's does. On
// a collection with drafts, every agent edit lands as a draft version that
// records the token it came from, and going live takes `publish` scope. On a
// collection without drafts, the only write is `create_<slug>`, which is live
// at once, so it too takes `publish` scope.

import { desc, eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import type { AgentAccess, EditorSession } from "../auth/types.js";
import { type PageId, parsePageId } from "../content/ids.js";
import { can, createLocalApi, createVersionedLocalApi } from "../content/localApi.js";
import {
  type SectionCatalog,
  sanitizeSectionsRichText,
  validateSections,
} from "../content/sections.js";
import type { CollectionAccess, CollectionConfig } from "../content/types.js";
import { db } from "../db/index.js";
import { draftBufferKey, readDraftBuffer } from "../editor/draft-buffer.js";
import { fieldRev } from "../editor/revs.js";
import { toFtsQuery } from "../editor/search.js";
import { type EditorRouteEnv, guardEditor, type ResolveEditor } from "../editor/shared.js";
import {
  applyPublish,
  applySaveDraft,
  type DraftSoftLocks,
  latestPendingDraft,
  type PublishDeps,
  type SaveDraftResult,
} from "../editor/versions.js";
import { LouiseAccessDeniedError, LouiseContentError, LouiseValidationError } from "../errors.js";
import { sanitizeModelHtml } from "../security/sanitize.js";
import { bearerRoute, hasBearerCredential, resolveEditorOnce } from "../worker/gate.js";
import type { WorkerRoute } from "../worker/index.js";
import {
  checkRoutingHeaders,
  classifyEra,
  INVALID_PARAMS,
  INVALID_REQUEST,
  type JsonRpcId,
  MCP_LEGACY_VERSIONS,
  MCP_SUPPORTED_VERSIONS,
  META_SERVER_INFO,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  parseMessage,
  rpcError,
  rpcResult,
} from "./protocol.js";
import {
  collectionTools,
  MCP_LIMIT_DEFAULT,
  MCP_LIMIT_MAX,
  MCP_READ_OPERATIONS,
  type McpTool,
  type McpToolOperation,
  reservedAgentFields,
} from "./tools.js";
import { agentMay } from "./tokens.js";

/** One collection the endpoint exposes: its main table and its config. */
export interface McpCollection<Env extends EditorRouteEnv = EditorRouteEnv> {
  table: SQLiteTable;
  config: CollectionConfig;
  /**
   * Where a collection with drafts saves them: the deps `versionsRoute` takes,
   * minus the table and config above. Pass the same `bufferKv`, `validate`,
   * `softLocks`, and `redirects` the editor uses, so an agent's edit meets the
   * same checks. Leave it out and the collection is read-only over MCP.
   *
   * The versions table must record provenance (`versions.provenance`, and the
   * migration that adds its columns), so every agent edit names its token.
   * `mcpRoute` throws when it doesn't.
   */
  drafts?: Omit<PublishDeps<Env>, "table" | "config"> & { softLocks?: DraftSoftLocks<Env> };
}

/** How the server names itself to a client. The name is the site's, so it's
 *  yours to choose—for example, `site-example`. */
export interface McpServerInfo {
  name: string;
  version: string;
  /** A display name, for a client that shows one. */
  title?: string;
}

export interface McpRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The collections an agent may reach. A collection marked `admin.hidden`
   *  gets no tools, as in {@link collectionTools}. */
  collections: McpCollection<Env>[];
  /** Resolve the editor session from the browser's cookie. A call with no
   *  bearer token runs as this editor. */
  resolveEditor: ResolveEditor<Env>;
  /**
   * Resolve an agent token to the editor it acts for, with `agent` set—
   * normally {@link resolveMcpSession}. Omit it and the route takes no bearer
   * tokens, so only a signed-in editor on the site's own origin can call it.
   */
  resolveAgent?: ResolveEditor<Env>;
  /** The server's identity, sent in the handshake and on every modern result. */
  server: McpServerInfo;
  /**
   * Guidance a client can put in front of the model: what the site is and how
   * its content is organized. Tool descriptions already say when to use each
   * tool, so don't repeat them here.
   */
  instructions?: string;
  /** The site's section catalog, passed through to {@link collectionTools}. */
  sections?: SectionCatalog;
  /** Mount path. Default `/api/louise/mcp`. */
  path?: string;
}

/** How long a client may reuse a `tools/list` or `server/discover` answer. The
 *  tools change only when the site deploys, so a minute costs nothing. */
const LIST_TTL_MS = 60_000;

interface ToolEntry {
  tool: McpTool;
  collection: McpCollection<EditorRouteEnv>;
}

/** Whether a collection keeps drafts, so its writes land as versions. */
const keepsDrafts = (config: CollectionConfig) => config.versions?.drafts === true;

/**
 * Whether a tool is one `mcpRoute` can run for this collection. Reads always
 * are. On a collection with drafts, the writes need its draft store. On one
 * without, `create_<slug>` is the only write, and it goes live at once.
 */
function servable(tool: McpTool, collection: McpCollection<EditorRouteEnv>): boolean {
  if (MCP_READ_OPERATIONS.includes(tool.operation)) return true;
  if (!keepsDrafts(collection.config)) return tool.operation === "create";
  return collection.drafts !== undefined;
}

/** Refuse a draft store that can't say who wrote a version. */
function assertRecordsProvenance(collection: McpCollection<EditorRouteEnv>): void {
  const versions = collection.drafts?.versionsTable as unknown as
    | Record<string, unknown>
    | undefined;
  if (!versions || (versions.author !== undefined && versions.source !== undefined)) return;
  throw new LouiseContentError(
    `The MCP write tools for "${collection.config.slug}" need a versions table that records who wrote each version. Set versions.provenance on the collection, build the table with collectionVersionsTable, and apply the migration that adds its author and source columns.`,
  );
}

/**
 * The MCP endpoint for a site's content. Mount it like any editor route; it
 * returns `undefined` for every path but its own, so `composeWorker` falls
 * through.
 *
 * ```ts
 * mcpRoute({
 *   collections: [{ table: pages, config: pagesConfig }],
 *   resolveEditor,
 *   server: { name: "site-example", version: "1.0.0" },
 * });
 * ```
 */
export function mcpRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: McpRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/mcp";
  const tools = new Map<string, ToolEntry>();
  for (const collection of config.collections as McpCollection<EditorRouteEnv>[]) {
    assertRecordsProvenance(collection);
    for (const tool of collectionTools(collection.config, { sections: config.sections })) {
      if (!servable(tool, collection)) continue;
      if (tools.has(tool.name)) {
        throw new LouiseContentError(
          `Two collections generate the MCP tool "${tool.name}"; each collection needs its own slug`,
        );
      }
      tools.set(tool.name, { tool, collection });
    }
  }
  const serverInfo = { ...config.server };

  const route: WorkerRoute<Env> = async (request, env) => {
    if (new URL(request.url).pathname !== path) return undefined;
    // No GET stream and no session to DELETE, in either era.
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }

    const g = await authenticate(request, env, config);
    if ("response" in g) return g.response;
    const context = { session: g.editor };

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return rpcError(undefined, PARSE_ERROR, "The request body isn't valid JSON.", 400);
    }
    const message = parseMessage(body);
    if (message.kind === "invalid") {
      return rpcError(message.id, INVALID_REQUEST, message.message, 400);
    }
    // `notifications/initialized` and any other notification: nothing to do.
    if (message.kind === "notification") return new Response(null, { status: 202 });

    const era = classifyEra(request, message);
    if (era.era === "rejected") return era.response;
    const modern = era.era === "modern";
    if (modern) {
      const mismatch = checkRoutingHeaders(request, message);
      if (mismatch) return mismatch;
    }

    // A modern result names its type and the server; a legacy one has neither.
    const answer = (result: Record<string, unknown>) =>
      rpcResult(
        message.id,
        modern
          ? { ...result, resultType: "complete", _meta: { [META_SERVER_INFO]: serverInfo } }
          : result,
      );
    const capabilities = { tools: modern ? {} : { listChanged: false } };

    switch (message.method) {
      case "server/discover":
        if (!modern) break;
        return answer({
          supportedVersions: MCP_SUPPORTED_VERSIONS,
          capabilities,
          ...(config.instructions ? { instructions: config.instructions } : {}),
          ttlMs: LIST_TTL_MS,
          cacheScope: "public",
        });

      case "initialize": {
        if (modern) break;
        const asked = message.params.protocolVersion;
        const legacy = MCP_LEGACY_VERSIONS as readonly string[];
        return answer({
          // Echo a version this route speaks; otherwise offer the newest, and
          // the client decides whether it can carry on.
          protocolVersion:
            typeof asked === "string" && legacy.includes(asked) ? asked : MCP_LEGACY_VERSIONS[0],
          capabilities,
          serverInfo,
          ...(config.instructions ? { instructions: config.instructions } : {}),
        });
      }

      case "ping":
        if (modern) break;
        return answer({});

      case "tools/list": {
        const visible = await visibleTools(tools, context);
        return answer({
          tools: visible.map(wireTool),
          // Which tools appear depends on who's asking, so no shared cache.
          ...(modern ? { ttlMs: LIST_TTL_MS, cacheScope: "private" } : {}),
        });
      }

      case "tools/call": {
        const name = message.params.name;
        const entry = typeof name === "string" ? tools.get(name) : undefined;
        if (!entry) {
          return rpcError(
            message.id,
            INVALID_PARAMS,
            `Unknown tool: ${String(name)}. Call tools/list for the tools this server offers.`,
            200,
          );
        }
        return answer(
          await callTool(entry, message.params.arguments, env, context, config.sections),
        );
      }
    }

    return notFound(message.id, message.method, modern);
  };
  // Marked so `composeWorker`'s gate lets a bearer request through to it: the
  // route checks the token itself, just above.
  return config.resolveAgent ? bearerRoute(route) : route;
}

/**
 * Who's calling. A request with a bearer token is authenticated by the token
 * alone, and its cookie is never consulted, so skipping the origin check can't
 * hand a cookie's identity to a cross-site request. Anything else is an editor
 * route call: cookie, same-origin check, and all.
 */
async function authenticate<Env extends EditorRouteEnv>(
  request: Request,
  env: Env,
  config: McpRouteConfig<Env>,
): Promise<{ editor: EditorSession } | { response: Response }> {
  if (!hasBearerCredential(request)) {
    // Every call is a POST, so every call is origin-checked like a mutation.
    return guardEditor(request, env, config.resolveEditor, true);
  }
  if (!config.resolveAgent) {
    return { response: unauthorized("This server doesn't accept bearer tokens.") };
  }
  const editor = await resolveEditorOnce(request, env, config.resolveAgent);
  // A resolver that returned a session with no scope would hand a token the
  // editor's full reach, so a bearer session without `agent` is refused.
  if (!editor?.agent) {
    return {
      response: unauthorized(
        "The token isn't valid. It may have expired or been revoked, or its editor lost access.",
      ),
    };
  }
  return { editor };
}

/** A bearer request refused. The challenge names the scheme, as RFC 6750
 *  asks; there's no OAuth server to point a client at. */
function unauthorized(message: string): Response {
  return Response.json(
    { error: message },
    {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="louise", error="invalid_token"' },
    },
  );
}

/**
 * The access a token needs for a tool. Reads need `read`, and a draft edit
 * needs `draft`. Anything that changes the live site needs `publish`: the
 * publish tool, and a create on a collection with no drafts, which is live the
 * moment it's written.
 */
function accessFor({ tool, collection }: ToolEntry): AgentAccess {
  if (MCP_READ_OPERATIONS.includes(tool.operation)) return "read";
  if (tool.operation === "publish") return "publish";
  return keepsDrafts(collection.config) ? "draft" : "publish";
}

/** Whether the caller's token scope, if any, covers the tool. A person in a
 *  browser has no token, and nothing narrows them but access functions. */
function inScope(entry: ToolEntry, session: EditorSession): boolean {
  return !session.agent || agentMay(session.agent.scope, entry.tool.collection, accessFor(entry));
}

/** The collection access function each operation answers to. */
const ACCESS_FN: Record<McpToolOperation, keyof CollectionAccess> = {
  list: "read",
  get: "read",
  count: "read",
  search: "read",
  create: "create",
  update_field: "update",
  add_section: "update",
  publish: "publish",
};

/** The modern transport answers an unknown method with a 404 so a client can
 *  tell it from a server with no MCP endpoint; a legacy client expects 200. */
function notFound(id: JsonRpcId, method: string, modern: boolean): Response {
  return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}.`, modern ? 404 : 200);
}

/**
 * The tools this editor can use. A tool whose access function refuses them
 * (`read` for a read, `create`, `update`, or `publish` for a write) isn't
 * listed, so an agent never picks a tool only to be told no—the same `can()`
 * the editor's own UI asks. The call still runs through the Local API, which
 * checks again. A token's scope narrows the list further.
 */
async function visibleTools(
  tools: Map<string, ToolEntry>,
  context: { session: EditorSession },
): Promise<McpTool[]> {
  const allowed = new Map<CollectionConfig, Map<keyof CollectionAccess, boolean>>();
  const out: McpTool[] = [];
  for (const entry of tools.values()) {
    if (!inScope(entry, context.session)) continue;
    const { config } = entry.collection;
    const fn = ACCESS_FN[entry.tool.operation];
    const answers = allowed.get(config) ?? new Map<keyof CollectionAccess, boolean>();
    allowed.set(config, answers);
    let ok = answers.get(fn);
    if (ok === undefined) {
      ok = (await can(config, "read", context)) && (await can(config, fn, context));
      answers.set(fn, ok);
    }
    if (ok) out.push(entry.tool);
  }
  return out;
}

/** A tool as the wire carries it: the routing fields stay on the server. */
function wireTool(tool: McpTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

// ─── Tool calls ─────────────────────────────────────────────────────────────

type CallResult = Record<string, unknown>;

const ok = (payload: Record<string, unknown>): CallResult => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
  structuredContent: payload,
});

/** A tool error goes back as a result, not a protocol error, so the model sees
 *  it and can correct the call. */
const toolError = (text: string): CallResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

type ReadArgs = { limit: number; offset: number; id?: number; query?: string };

const ALLOWED_ARGS: Record<string, readonly string[]> = {
  list: ["limit", "offset"],
  get: ["id"],
  count: [],
  search: ["query", "limit"],
};

/**
 * Check a read tool's arguments against what its schema promises. There's no
 * JSON Schema validator in a dependency-free core, and four fixed shapes don't
 * need one.
 */
function readArgs(tool: McpTool, raw: unknown): ReadArgs | string {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    return "`arguments` must be an object.";
  }
  const args = (raw ?? {}) as Record<string, unknown>;
  const allowed = ALLOWED_ARGS[tool.operation] ?? [];
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    return `Unknown argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ${tool.name} takes ${allowed.length ? allowed.join(", ") : "no arguments"}.`;
  }

  const out: ReadArgs = { limit: MCP_LIMIT_DEFAULT, offset: 0 };
  if (args.limit !== undefined) {
    const n = args.limit;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MCP_LIMIT_MAX) {
      return `\`limit\` must be a whole number from 1 to ${MCP_LIMIT_MAX}.`;
    }
    out.limit = n;
  }
  if (args.offset !== undefined) {
    const n = args.offset;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      return "`offset` must be a whole number, 0 or more.";
    }
    out.offset = n;
  }
  if (tool.operation === "get") {
    // The schema takes a string id too, for a client that sends every id as
    // text; a numeric string still names a row.
    const id = typeof args.id === "string" && /^\d+$/.test(args.id) ? Number(args.id) : args.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) {
      return "`id` must be a document id: a whole number.";
    }
    out.id = id;
  }
  if (tool.operation === "search") {
    if (typeof args.query !== "string" || !args.query.trim()) {
      return "`query` must be the words to search for.";
    }
    out.query = args.query;
  }
  return out;
}

async function callTool(
  entry: ToolEntry,
  rawArgs: unknown,
  env: EditorRouteEnv,
  context: { session: EditorSession },
  sections: SectionCatalog | undefined,
): Promise<CallResult> {
  const { tool, collection } = entry;
  const label = collection.config.admin?.label ?? collection.config.slug;
  if (!inScope(entry, context.session)) {
    return toolError(
      `This token doesn't cover ${tool.name}. Ask the person who issued it for one whose scope includes ${label}.`,
    );
  }
  return MCP_READ_OPERATIONS.includes(tool.operation)
    ? callReadTool(entry, rawArgs, env, context)
    : callWriteTool(entry, rawArgs, env, context, sections);
}

async function callReadTool(
  { tool, collection }: ToolEntry,
  rawArgs: unknown,
  env: EditorRouteEnv,
  context: { session: EditorSession },
): Promise<CallResult> {
  const { table, config } = collection;
  const label = config.admin?.label ?? config.slug;
  const args = readArgs(tool, rawArgs);
  if (typeof args === "string") return toolError(args);

  const api = createLocalApi(db(env.DB), table as Parameters<typeof createLocalApi>[1], config);
  try {
    switch (tool.operation) {
      case "list": {
        const pk = getTableConfig(table).columns.find((c) => c.primary) as SQLiteColumn | undefined;
        // One extra row says whether there's another page, without a count.
        const rows = await api.find(context, {
          limit: args.limit + 1,
          offset: args.offset,
          ...(pk ? { orderBy: desc(pk) } : {}),
        });
        const docs = rows.slice(0, args.limit);
        return ok(
          rows.length > args.limit ? { docs, nextOffset: args.offset + args.limit } : { docs },
        );
      }
      case "get":
        return ok({ doc: await api.findByID(context, args.id as number) });
      case "count":
        return ok({ count: await api.count(context) });
      default:
        return ok({
          docs: await api.search(context, toFtsQuery(args.query as string), { limit: args.limit }),
        });
    }
  } catch (err) {
    if (err instanceof LouiseAccessDeniedError) {
      return toolError(`You don't have access to read ${label}.`);
    }
    // Not found, and the Local API's other refusals, are written for a reader.
    if (err instanceof LouiseContentError) return toolError(err.message);
    console.error(`[louise] MCP tool ${tool.name} failed`, err);
    return toolError(
      `Reading ${label} failed on the server. Try again, or tell the person it failed.`,
    );
  }
}

// ─── Write tools ────────────────────────────────────────────────────────────

/** Section keys the tool sets itself, or that belong to editor chrome. */
const isReservedSectionKey = (key: string) => key.startsWith("_") || key === "blocks";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A tool's arguments as an object with only `allowed` keys, or why not. */
function objectArgs(
  tool: McpTool,
  raw: unknown,
  allowed: readonly string[] | null,
): Record<string, unknown> | string {
  if (raw !== undefined && !isObject(raw)) return "`arguments` must be an object.";
  const args = (raw ?? {}) as Record<string, unknown>;
  if (allowed) {
    const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
    if (unknown.length) {
      return `Unknown argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ${tool.name} takes ${allowed.join(", ")}.`;
    }
  }
  return args;
}

/** The document id argument, or why it isn't one. */
function docId(args: Record<string, unknown>): PageId | string {
  return parsePageId(args.id) ?? "`id` must be a document id: a whole number.";
}

/** Violations as sentences a model can act on. */
function violationText(message: string, violations: unknown): string {
  if (!Array.isArray(violations) || violations.length === 0) return message;
  const lines = violations
    .filter((v) => isObject(v) && v.severity !== "warning")
    .map(
      (v) =>
        `- ${String((v as { path?: unknown }).path ?? "")}: ${String((v as { message?: unknown }).message ?? "")}`,
    );
  return lines.length ? `${message}\n${lines.join("\n")}` : message;
}

/** A refused draft save or publish, as a tool error that says what to do next. */
function refusal(
  label: string,
  id: PageId,
  result:
    | Extract<SaveDraftResult, { ok: false }>
    | { ok: false; status: number; error: string; violations?: unknown },
): CallResult {
  switch (result.status) {
    case 404:
      return toolError(`There's no ${label} document with id ${id}.`);
    case 409:
      return toolError(
        "Someone changed this document while you were editing it. Fetch it again, then retry your edit.",
      );
    case 423: {
      const locked = "locked" in result && result.locked ? ` (${result.locked.join(", ")})` : "";
      return toolError(
        `Someone is editing those fields right now${locked}. Try again later, or tell the person.`,
      );
    }
    default:
      return toolError(violationText(result.error, result.violations));
  }
}

/** Sections a model wrote, with every rich-text field held to model HTML. */
function sanitizeModelSections(value: unknown, sections: SectionCatalog | undefined): unknown {
  return sections ? sanitizeSectionsRichText(value, sections, sanitizeModelHtml) : value;
}

async function callWriteTool(
  { tool, collection }: ToolEntry,
  rawArgs: unknown,
  env: EditorRouteEnv,
  context: { session: EditorSession },
  sections: SectionCatalog | undefined,
): Promise<CallResult> {
  const { table, config } = collection;
  const label = config.admin?.label ?? config.slug;
  const deps = collection.drafts ? { ...collection.drafts, table, config } : undefined;
  const reserved = reservedAgentFields(config);
  // An agent's save always reaches D1, so the version it makes records the
  // agent. It still builds on any buffered work, and leaves the buffer holding
  // what it stored, so a person's next auto-save keeps the agent's edit.
  const saveDraft = (id: PageId, input: Record<string, unknown>, base?: Record<string, string>) =>
    applySaveDraft(
      env,
      { ...(deps as PublishDeps), bufferFlushMs: 0 },
      context.session,
      id,
      input,
      {
        softLocks: collection.drafts?.softLocks,
        ...(base ? { base } : {}),
      },
    );
  const saved = (id: PageId, result: SaveDraftResult) => {
    if (!result.ok) return refusal(label, id, result);
    const version = result.body.version as { id?: unknown } | undefined;
    return ok({
      id,
      versionId: version?.id ?? null,
      note: "Saved as a draft. Nothing is live until someone publishes it.",
    });
  };

  try {
    switch (tool.operation) {
      case "create": {
        const args = objectArgs(tool, rawArgs, null);
        if (typeof args === "string") return toolError(args);
        const refused = Object.keys(args).filter((key) => reserved.has(key));
        if (refused.length) {
          return toolError(
            `${refused.join(", ")} can't be set here. A new document starts unpublished, and \`publish_${config.slug}\` makes it live.`,
          );
        }
        const data =
          "sections" in args
            ? { ...args, sections: sanitizeModelSections(args.sections, sections) }
            : args;
        const api = createLocalApi(
          db(env.DB),
          table as Parameters<typeof createLocalApi>[1],
          config,
        );
        if (!deps) {
          return ok({
            doc: await api.create(context, data as never),
            note: "Created. It's live now.",
          });
        }
        // The site's whole-draft check, as `applySaveDraft` runs it: a throw
        // is the site refusing the content, whatever its class.
        try {
          await deps.validate?.(data);
        } catch (err) {
          const { message, violations } = err as { message?: string; violations?: unknown };
          return toolError(violationText(message ?? "That document isn't valid.", violations));
        }
        const row = (await api.create(context, data as never)) as Record<string, unknown>;
        const id = parsePageId(row.id) as PageId;
        // A first draft of the row as created, so its history names the agent.
        const result = await saveDraft(id, {});
        if (!result.ok) {
          return toolError(
            `Created ${label} document ${id}, but saving its first draft failed: ${result.error}`,
          );
        }
        return saved(id, result);
      }

      case "update_field": {
        const args = objectArgs(tool, rawArgs, ["id", "field", "value"]);
        if (typeof args === "string") return toolError(args);
        const id = docId(args);
        if (typeof id === "string") return toolError(id);
        const editable = (tool.inputSchema.properties as { field: { enum: string[] } }).field.enum;
        const field = args.field;
        if (typeof field !== "string" || !editable.includes(field)) {
          return toolError(`\`field\` must be one of: ${editable.join(", ")}.`);
        }
        if (!("value" in args)) return toolError("`value` is required: the field's new value.");
        const value =
          field === "sections" ? sanitizeModelSections(args.value, sections) : args.value;
        // Whole sections from a model meet the catalog check `add_<slug>_section` runs.
        if (field === "sections" && sections) {
          const problems = (
            await validateSections(sections, value, { operation: "update" })
          ).filter((v) => v.severity !== "warning");
          if (problems.length) {
            return toolError(violationText("Those sections aren't valid.", problems));
          }
        }
        return saved(id, await saveDraft(id, { [field]: value }));
      }

      case "add_section": {
        const args = objectArgs(tool, rawArgs, ["id", "section", "values"]);
        if (typeof args === "string") return toolError(args);
        const id = docId(args);
        if (typeof id === "string") return toolError(id);
        const catalog = sections ?? {};
        const names = Object.keys(catalog);
        if (typeof args.section !== "string" || !Object.hasOwn(catalog, args.section)) {
          return toolError(`\`section\` must be one of: ${names.join(", ")}.`);
        }
        const values = args.values ?? {};
        if (!isObject(values)) return toolError("`values` must be an object of section props.");
        const reservedKeys = Object.keys(values).filter(isReservedSectionKey);
        if (reservedKeys.length) {
          return toolError(`\`values\` can't set ${reservedKeys.join(", ")}.`);
        }
        const [item] = sanitizeModelSections(
          [{ ...values, _type: args.section }],
          catalog,
        ) as unknown[];
        const problems = (await validateSections(catalog, [item], { operation: "update" })).filter(
          (v) => v.severity !== "warning",
        );
        if (problems.length) {
          return toolError(violationText(`That ${args.section} section isn't valid.`, problems));
        }
        const current = await currentField(env, collection, context, id, "sections");
        if (current === NOT_FOUND) return toolError(`There's no ${label} document with id ${id}.`);
        const list = Array.isArray(current) ? current : [];
        // The revision it read, so a person's edit in between is a conflict,
        // not something this append quietly reverts.
        return saved(
          id,
          await saveDraft(id, { sections: [...list, item] }, { sections: await fieldRev(current) }),
        );
      }

      default: {
        const args = objectArgs(tool, rawArgs, ["id"]);
        if (typeof args === "string") return toolError(args);
        const id = docId(args);
        if (typeof id === "string") return toolError(id);
        const result = await applyPublish(env, deps as PublishDeps, context.session, id);
        if (!result.ok) return refusal(label, id, result);
        return ok({ doc: result.body.page, note: "Published. It's live on the site now." });
      }
    }
  } catch (err) {
    if (err instanceof LouiseAccessDeniedError) {
      const verb =
        tool.operation === "publish" ? "publish" : tool.operation === "create" ? "create" : "edit";
      return toolError(`You don't have access to ${verb} ${label}.`);
    }
    if (err instanceof LouiseValidationError) {
      return toolError(violationText(err.message, err.violations));
    }
    if (err instanceof LouiseContentError) return toolError(err.message);
    console.error(`[louise] MCP tool ${tool.name} failed`, err);
    return toolError(
      `Saving ${label} failed on the server. Try again, or tell the person it failed.`,
    );
  }
}

const NOT_FOUND = Symbol("not found");

/**
 * A field's value as a draft save would build on it: the KV buffer, else the
 * newest pending draft, else the live row. `applySaveDraft` merges on the same
 * base, so an append reads what the save will write over.
 */
async function currentField(
  env: EditorRouteEnv,
  collection: McpCollection<EditorRouteEnv>,
  context: { session: EditorSession },
  id: PageId,
  field: string,
): Promise<unknown> {
  const { table, config, drafts } = collection;
  const kv = drafts?.bufferKv?.(env);
  const buffered = kv ? await readDraftBuffer(kv, draftBufferKey(config.slug, id)) : null;
  const database = db(env.DB);
  const api = createVersionedLocalApi(
    database,
    table,
    drafts?.versionsTable as SQLiteTable,
    config,
  );
  const pk = getTableConfig(table).columns.find((c) => c.primary) as SQLiteColumn;
  const [row] = (await database.select().from(table).where(eq(pk, id)).limit(1)) as Record<
    string,
    unknown
  >[];
  if (!row) return NOT_FOUND;
  const data = buffered?.data as Record<string, unknown> | undefined;
  if (data && field in data) return data[field];
  const pending = latestPendingDraft(
    (await api.findVersions(context, id)) as Record<string, unknown>[],
  )?.versionData as Record<string, unknown> | undefined;
  if (pending && field in pending) return pending[field];
  return row[field];
}
