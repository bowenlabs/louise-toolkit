// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// A failed query's error, reduced to something safe to log.
//
// drizzle-orm wraps every failed query in a `DrizzleQueryError` whose message
// is `Failed query: <sql>\nparams: <bound values>`. The bound values are
// whatever the query wrote or matched on: names, addresses, notes, customer
// IDs. Logged as they are, they reach Workers Logs, the incidents table, and
// any error tracker. Email and token redaction can't catch a name or a street,
// so a query error is reduced instead: the statement's kind and table, and the
// first line of the driver's own error, which says what went wrong. A driver
// can quote a value in that line too (`D1_TYPE_ERROR: Type 'object' not
// supported for value '…'`), so the line stops at its first quoted literal.
//
// Every fallback fails closed: when this can't tell whether something holds a
// value, it leaves that thing out.
//
// It's matched by its name and its message's shape, never imported, so the
// zero-dependency core stays that way.

/** How a query error's message starts. */
const QUERY_PREFIX = "Failed query: ";

/** The class name drizzle-orm gives a failed query's error. */
const QUERY_ERROR_NAME = "DrizzleQueryError";

/**
 * Where the bound values start in free text. drizzle-orm puts them on their own
 * line, but the text may have been flattened to one line already.
 */
const PARAMS_MARKER = /\s+params: /;

/** Longest driver message a reduced query error keeps. */
const MAX_CAUSE = 200;

/** How deep a `cause` chain is followed, against a chain that loops. Past it,
 *  the rest of the chain is left out. */
const MAX_DEPTH = 10;

/** What a quoted literal in a driver's error becomes. */
const VALUE = "<value>";

/**
 * The first quote that opens a literal, and everything after it. A driver's
 * line can quote a value with a quote inside, or be cut inside one, so the
 * rest of the line goes with it. A quote counts only at the start or after a
 * space or an opening mark, so the apostrophe in "can't" doesn't open one.
 */
const LITERAL = /(^|[\s(=:[,])['"`].*$/;

/** Own properties a copy never takes: the parts it rebuilds, and a query
 *  error's SQL and bound values. */
const SKIPPED_FIELDS = new Set(["name", "message", "stack", "cause", "query", "params"]);

/** Statement keywords worth naming. Anything else is reported as a query. */
const KINDS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "replace",
  "with",
  "create",
  "drop",
  "alter",
  "pragma",
]);

/** The kinds whose first table is the one they act on. */
const TABLE_KINDS = new Set(["select", "insert", "update", "delete", "replace"]);

/** The table a statement reads or writes, quoted or bare, with its schema. */
const TABLE =
  /\b(into|update|from)\s+("[^"]{1,128}"|`[^`]{1,128}`|\[[^\]]{1,128}\]|[\w$.]{1,128})/i;

/**
 * Whether a thrown value is a failed query's error: drizzle-orm's
 * `DrizzleQueryError`, by its class name or by its message's shape. It never
 * throws.
 */
export function isQueryError(value: unknown): value is Error {
  if (!isError(value)) return false;
  if (className(value) === QUERY_ERROR_NAME) return true;
  const message = read(value, "message");
  return typeof message === "string" && message.startsWith(QUERY_PREFIX);
}

/**
 * The safe name and message for a failed query's error. The message keeps the
 * statement's kind and table, and the first line of the driver's error from
 * `cause`, and drops the SQL and the bound values:
 *
 * ```text
 * Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email
 * ```
 */
export function queryErrorParts(error: Error): { name: string; message: string } {
  return { name: queryErrorName(error), message: queryErrorMessage(error, 0) };
}

/**
 * `text` with a failed query's SQL and bound values reduced, for a message
 * that quotes one, such as `Save failed: Failed query: … params: …`. Only text
 * that carries the `params:` marker changes, so running it twice changes
 * nothing.
 */
export function redactQueryText(text: string): string {
  const start = text.indexOf(QUERY_PREFIX);
  if (start === -1) return text;
  const rest = text.slice(start + QUERY_PREFIX.length);
  const marker = PARAMS_MARKER.exec(rest);
  if (!marker) return text;
  return `${text.slice(0, start)}${QUERY_PREFIX}${statementSummary(rest.slice(0, marker.index))}`;
}

/**
 * A value that's safe to pass to `console.error`. A failed query's error, or
 * an error with one anywhere in its `cause` chain, comes back as a copy whose
 * query errors carry their reduced message and a stack of frames only, so the
 * log line keeps the trace and loses the values. The copy keeps each error's
 * other string and number fields, such as a `LouiseError`'s `code`. A string
 * that quotes a failed query comes back reduced. Anything else comes back as
 * it was. It never throws.
 */
export function loggableError(value: unknown): unknown {
  try {
    return needsCopy(value, 0) ? safeCopy(value, 0) : value;
  } catch {
    return "[an error that couldn't be read]";
  }
}

function queryErrorName(error: Error): string {
  if (className(error) === QUERY_ERROR_NAME) return QUERY_ERROR_NAME;
  const name = read(error, "name");
  return typeof name === "string" && name.trim() ? name.trim() : "Error";
}

function queryErrorMessage(error: Error, depth: number): string {
  const message = read(error, "message");
  const sql = typeof message === "string" ? sqlOf(message) : "";
  const reduced = `${QUERY_PREFIX}${statementSummary(sql)}`;
  const cause = causeLine(read(error, "cause"), depth + 1);
  return cause ? `${reduced}. Cause: ${cause}` : reduced;
}

/** The SQL in a query error's message: after the prefix, before the values. */
function sqlOf(message: string): string {
  const body = message.startsWith(QUERY_PREFIX) ? message.slice(QUERY_PREFIX.length) : "";
  const marker = PARAMS_MARKER.exec(body);
  return marker ? body.slice(0, marker.index) : body;
}

/**
 * `insert into inquiries`, `update orders`, `select from products`: the
 * statement's kind and the first table it names, never a value. `query` when
 * the statement's kind isn't one it knows.
 */
function statementSummary(sql: string): string {
  const kind = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase();
  if (!kind || !KINDS.has(kind)) return "query";
  if (!TABLE_KINDS.has(kind)) return kind;
  const match = TABLE.exec(sql);
  const table = match ? identifier(match[2]!) : "";
  if (!table || !match) return kind;
  const keyword = match[1]!.toLowerCase();
  if (keyword === "update") return kind === "update" ? `update ${table}` : kind;
  return `${kind} ${keyword} ${table}`;
}

/** A table name without its quotes, or `""` when it isn't name-shaped. */
function identifier(raw: string): string {
  const name = raw.replace(/["`[\]]/g, "");
  return /^[\w$.]{1,128}$/.test(name) ? name : "";
}

/** The first line of a driver's error, reduced again if it's a query error. */
function causeLine(cause: unknown, depth: number): string {
  if (cause === undefined || cause === null || depth > MAX_DEPTH) return "";
  if (isQueryError(cause)) return queryErrorMessage(cause, depth);
  let text: string;
  try {
    if (isError(cause)) {
      const message = read(cause, "message");
      text = typeof message === "string" ? message : "";
    } else {
      text = typeof cause === "string" ? cause : "";
    }
  } catch {
    return "";
  }
  const line = redactLiterals(redactQueryText(text.split(/\r?\n/, 1)[0]!.trim()));
  return line.length > MAX_CAUSE ? `${line.slice(0, MAX_CAUSE)}…` : line;
}

/** The line up to its first quoted literal, with a placeholder for the rest. */
function redactLiterals(line: string): string {
  return line.replace(LITERAL, (_match, lead: string) => `${lead}${VALUE}`);
}

/**
 * Whether a value needs a copy: an error or a string that is or quotes a failed
 * query, anywhere in its chain. A chain longer than {@link MAX_DEPTH} counts,
 * since what's past the limit can't be checked.
 */
function needsCopy(value: unknown, depth: number): boolean {
  if (value === undefined || value === null) return false;
  if (depth > MAX_DEPTH) return true;
  if (typeof value === "string") return quotesQuery(value);
  if (!isError(value)) return false;
  if (isQueryError(value) || quotesQuery(read(value, "message"))) return true;
  return needsCopy(read(value, "cause"), depth + 1);
}

/** Whether text quotes a failed query with its bound values. */
function quotesQuery(text: unknown): boolean {
  return typeof text === "string" && redactQueryText(text) !== text;
}

/** A copy of an error and its chain, with every query error reduced. Past
 *  {@link MAX_DEPTH}, the rest of the chain is dropped. */
function safeCopy(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === "string") return redactQueryText(value);
  if (!isError(value) || !needsCopy(value, 0)) return value;
  const query = isQueryError(value);
  const { name, message } = query ? queryErrorParts(value) : plainParts(value);
  const copy = new Error(message);
  copy.name = name;
  copy.stack = `${name}: ${message}${framesOf(value, query || quotesQuery(read(value, "message")))}`;
  copyFields(value, copy);
  const cause = safeCopy(read(value, "cause"), depth + 1);
  if (cause !== undefined) copy.cause = cause;
  return copy;
}

/** An error that isn't a query error but may quote one in its message. */
function plainParts(error: Error): { name: string; message: string } {
  const name = read(error, "name");
  const message = read(error, "message");
  return {
    name: typeof name === "string" && name ? name : "Error",
    message: typeof message === "string" ? redactQueryText(message) : "",
  };
}

/** The error's own string and number fields, such as `code` and `status`,
 *  onto the copy. Never a query error's SQL or bound values. */
function copyFields(from: Error, to: Error): void {
  let keys: string[];
  try {
    keys = Object.getOwnPropertyNames(from);
  } catch {
    return;
  }
  for (const key of keys) {
    if (SKIPPED_FIELDS.has(key)) continue;
    let field: unknown;
    try {
      field = (from as unknown as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (typeof field === "number") (to as unknown as Record<string, unknown>)[key] = field;
    else if (typeof field === "string") {
      (to as unknown as Record<string, unknown>)[key] = redactQueryText(field);
    }
  }
}

/**
 * An error's stack frames, without its first lines, which repeat the message.
 * It starts looking after the message, so a value that looks like a frame
 * stays out. When the error holds a value and its message can't be found in
 * its stack, it returns no frames at all.
 */
function framesOf(error: Error, holdsValues: boolean): string {
  const stack = read(error, "stack");
  const message = read(error, "message");
  if (typeof stack !== "string") return "";
  const at = typeof message === "string" && message ? stack.indexOf(message) : -1;
  if (at === -1 && holdsValues) return "";
  const tail = at === -1 ? stack : stack.slice(at + (message as string).length);
  const frames = tail.split("\n").filter((line) => /^\s+at\s/.test(line));
  return frames.length > 0 ? `\n${frames.join("\n")}` : "";
}

/** `instanceof Error`, or `false` when a proxy's prototype trap throws. */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/** The error's constructor's name, which drizzle-orm leaves as the only sign:
 *  it doesn't set `name`, so a query error's `name` reads `Error`. */
function className(error: Error): string {
  try {
    const name: unknown = (error as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

/** `error[key]`, or `undefined` when a getter throws. */
function read(error: Error, key: "name" | "message" | "cause" | "stack"): unknown {
  try {
    return error[key];
  } catch {
    return undefined;
  }
}
