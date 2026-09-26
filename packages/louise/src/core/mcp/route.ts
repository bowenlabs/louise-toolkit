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
// The session comes from `resolveEditor` and `guardEditor`, like every other
// editor route, so every call must be same-origin with a signed-in editor. The
// bearer-token path for agents with no browser is slice 3; the write tools are
// slice 4, and until then `tools/list` doesn't offer them.

import { desc } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { can, createLocalApi } from "../content/localApi.js";
import type { SectionCatalog } from "../content/sections.js";
import type { CollectionConfig } from "../content/types.js";
import { db } from "../db/index.js";
import { toFtsQuery } from "../editor/search.js";
import { type EditorRouteEnv, guardEditor, type ResolveEditor } from "../editor/shared.js";
import { LouiseAccessDeniedError, LouiseContentError } from "../errors.js";
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
} from "./tools.js";

/** One collection the endpoint exposes: its main table and its config. */
export interface McpCollection {
  table: SQLiteTable;
  config: CollectionConfig;
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
  /** The collections an agent may read. A collection marked `admin.hidden`
   *  gets no tools, as in {@link collectionTools}. */
  collections: McpCollection[];
  /** Resolve the editor session. Every call runs as this editor. */
  resolveEditor: ResolveEditor<Env>;
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
  collection: McpCollection;
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
  for (const collection of config.collections) {
    for (const tool of collectionTools(collection.config, { sections: config.sections })) {
      if (!MCP_READ_OPERATIONS.includes(tool.operation)) continue;
      if (tools.has(tool.name)) {
        throw new LouiseContentError(
          `Two collections generate the MCP tool "${tool.name}"; each collection needs its own slug`,
        );
      }
      tools.set(tool.name, { tool, collection });
    }
  }
  const serverInfo = { ...config.server };

  return async (request, env) => {
    if (new URL(request.url).pathname !== path) return undefined;
    // No GET stream and no session to DELETE, in either era.
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }

    // Every call is a POST, so every call is origin-checked like a mutation.
    const g = await guardEditor(request, env, config.resolveEditor, true);
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
        return answer(await callTool(entry, message.params.arguments, env, context));
      }
    }

    return notFound(message.id, message.method, modern);
  };
}

/** The modern transport answers an unknown method with a 404 so a client can
 *  tell it from a server with no MCP endpoint; a legacy client expects 200. */
function notFound(id: JsonRpcId, method: string, modern: boolean): Response {
  return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}.`, modern ? 404 : 200);
}

/**
 * The tools this editor can use. A collection whose `read` access function
 * refuses them contributes nothing, so an agent never picks a tool only to be
 * told no—the same `can()` the editor's own UI asks. The call still runs
 * through the Local API, which checks again.
 */
async function visibleTools(
  tools: Map<string, ToolEntry>,
  context: { session: unknown },
): Promise<McpTool[]> {
  const allowed = new Map<CollectionConfig, boolean>();
  const out: McpTool[] = [];
  for (const { tool, collection } of tools.values()) {
    let readable = allowed.get(collection.config);
    if (readable === undefined) {
      readable = await can(collection.config, "read", context);
      allowed.set(collection.config, readable);
    }
    if (readable) out.push(tool);
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
  { tool, collection }: ToolEntry,
  rawArgs: unknown,
  env: EditorRouteEnv,
  context: { session: unknown },
): Promise<CallResult> {
  const args = readArgs(tool, rawArgs);
  if (typeof args === "string") return toolError(args);

  const { table, config } = collection;
  const api = createLocalApi(db(env.DB), table as Parameters<typeof createLocalApi>[1], config);
  const label = config.admin?.label ?? config.slug;
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
      case "search":
        return ok({
          docs: await api.search(context, toFtsQuery(args.query as string), { limit: args.limit }),
        });
      default:
        return toolError(`${tool.name} isn't available yet.`);
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
