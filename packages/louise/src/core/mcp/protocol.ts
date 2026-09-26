// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/mcp`—the wire layer: the JSON-RPC envelope, MCP's error
// codes, the protocol versions the route speaks, and the header checks the
// Streamable HTTP transport requires (ADR 0009, slice 2).
//
// Hand-rolled rather than taken from an SDK, because the core has no runtime
// dependencies (ADR 0006). The surface is small: parse one message, answer it
// with one JSON object. There's no SSE here; every answer is a single JSON
// response, which the transport allows for every request.

/** The stateless revision: every request carries its version in `_meta`. */
export const MCP_MODERN_VERSIONS = ["2026-07-28"] as const;

/**
 * The revisions that open with an `initialize` handshake. Served too, because
 * most clients in use still speak them, and a legacy client has no way to
 * move forward on its own. Newest first: the answer to an `initialize` asking
 * for a version this route doesn't know. `2024-11-05` isn't here because it
 * used the older HTTP+SSE transport, which this route doesn't implement.
 */
export const MCP_LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

/** Every version, in the order an `UnsupportedProtocolVersion` error lists them. */
export const MCP_SUPPORTED_VERSIONS: readonly string[] = [
  ...MCP_MODERN_VERSIONS,
  ...MCP_LEGACY_VERSIONS,
];

/** What a legacy request means when it omits `MCP-Protocol-Version`: the
 *  header only arrived in 2025-06-18, and the transport says to assume this. */
const LEGACY_HEADERLESS_VERSION = "2025-03-26";

// JSON-RPC's own codes, then the range MCP reserves for itself.
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const HEADER_MISMATCH = -32020;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

// The `_meta` keys the modern revision reserves.
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export type JsonRpcId = string | number;

/** One parsed message: a request expects an answer, a notification doesn't. */
export type McpMessage =
  | { kind: "request"; id: JsonRpcId; method: string; params: Record<string, unknown> }
  | { kind: "notification"; method: string }
  | { kind: "invalid"; id?: JsonRpcId; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Classify a parsed request body. A batch (an array) is invalid: batching left
 * the protocol in 2025-06-18, and a single message per POST is all any revision
 * this route speaks requires.
 */
export function parseMessage(body: unknown): McpMessage {
  if (!isRecord(body)) {
    return { kind: "invalid", message: "Send one JSON-RPC message as a JSON object." };
  }
  const rawId = body.id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : undefined;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return { kind: "invalid", id, message: 'A request needs `jsonrpc: "2.0"` and a `method`.' };
  }
  if (rawId === undefined) return { kind: "notification", method: body.method };
  if (id === undefined) {
    return { kind: "invalid", message: "A request `id` must be a string or a number." };
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    return { kind: "invalid", id, message: "`params` must be an object." };
  }
  return { kind: "request", id, method: body.method, params: body.params ?? {} };
}

const JSON_HEADERS = { "content-type": "application/json" };

/** A successful JSON-RPC response. */
export function rpcResult(id: JsonRpcId, result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

/**
 * A JSON-RPC error response. `id` is left out when the request's own id
 * couldn't be read, as MCP's schema has it, rather than sent as `null`.
 */
export function rpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  status: number,
  data?: unknown,
): Response {
  const error = data === undefined ? { code, message } : { code, message, data };
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), error }),
    {
      status,
      headers: JSON_HEADERS,
    },
  );
}

const SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;

/**
 * Decode a header value that may use the transport's Base64 sentinel,
 * `=?base64?…?=`, which carries a name that isn't plain ASCII. Returns
 * `undefined` for a sentinel that doesn't decode as UTF-8, so a malformed
 * header is a mismatch, never a crash.
 */
function decodeHeaderValue(value: string): string | undefined {
  const match = SENTINEL.exec(value);
  if (!match) return value;
  try {
    const bytes = Uint8Array.from(atob(match[1] ?? ""), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Whether a version is in the stateless era. Revisions are ISO dates, so a
 *  string comparison orders them. */
function isModernVersion(version: string): boolean {
  return version >= (MCP_MODERN_VERSIONS[0] as string);
}

/** Which era a request belongs to, and the version it claims. */
export type McpEra =
  | { era: "modern"; version: string }
  | { era: "legacy"; version: string }
  | { era: "rejected"; response: Response };

/**
 * Decide a request's era from its body and headers, rejecting what the
 * transport says to reject.
 *
 * A request whose `_meta` names a protocol version is modern, and its
 * `MCP-Protocol-Version` header has to agree. Anything else is legacy—an
 * `initialize`, or a request from a client that already sent one. A legacy
 * request's header, when it sends one, has to name a legacy version this route
 * speaks; a modern version in the header of a body with no `_meta` is a
 * mismatch rather than a guess.
 */
export function classifyEra(request: Request, message: McpMessage & { kind: "request" }): McpEra {
  const meta = isRecord(message.params._meta) ? message.params._meta : undefined;
  const claimed = meta?.[META_PROTOCOL_VERSION];
  const header = request.headers.get("mcp-protocol-version");
  const reject = (code: number, text: string, data?: unknown): McpEra => ({
    era: "rejected",
    response: rpcError(message.id, code, text, 400, data),
  });

  if (typeof claimed === "string") {
    if (header !== claimed) {
      return reject(
        HEADER_MISMATCH,
        `The MCP-Protocol-Version header (${header ?? "missing"}) doesn't match the request's protocol version (${claimed}).`,
      );
    }
    if (!(MCP_MODERN_VERSIONS as readonly string[]).includes(claimed)) {
      return reject(UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version.", {
        supported: MCP_SUPPORTED_VERSIONS,
        requested: claimed,
      });
    }
    return { era: "modern", version: claimed };
  }

  if (header !== null && isModernVersion(header)) {
    return reject(
      HEADER_MISMATCH,
      `The MCP-Protocol-Version header names ${header}, but the request carries no protocol version in \`_meta\`.`,
    );
  }
  // `initialize` negotiates its version in the body; the header comes after.
  if (message.method === "initialize") return { era: "legacy", version: "" };
  const version = header ?? LEGACY_HEADERLESS_VERSION;
  if (!(MCP_LEGACY_VERSIONS as readonly string[]).includes(version)) {
    return reject(INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${version}.`, {
      supported: MCP_SUPPORTED_VERSIONS,
      requested: version,
    });
  }
  return { era: "legacy", version };
}

/**
 * Check the modern transport's routing headers against the body: `Mcp-Method`
 * on every request, and `Mcp-Name` on a `tools/call`. A gateway may route on
 * the header while this route acts on the body, so the two must agree.
 * Returns the error response, or `null` when they match.
 */
export function checkRoutingHeaders(
  request: Request,
  message: McpMessage & { kind: "request" },
): Response | null {
  const method = request.headers.get("mcp-method");
  if (method !== message.method) {
    return rpcError(
      message.id,
      HEADER_MISMATCH,
      `The Mcp-Method header (${method ?? "missing"}) doesn't match the request's method (${message.method}).`,
      400,
    );
  }
  if (message.method !== "tools/call") return null;
  const raw = request.headers.get("mcp-name");
  const name = raw === null ? undefined : decodeHeaderValue(raw);
  if (name === undefined || name !== message.params.name) {
    return rpcError(
      message.id,
      HEADER_MISMATCH,
      "The Mcp-Name header doesn't match the name of the tool being called.",
      400,
    );
  }
  return null;
}
