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

/** The copies {@link loggableError} made, so a copy passed back is kept. */
const copies = new WeakSet<object>();

/** An error's own properties a copy rebuilds rather than takes. */
const REBUILT_FIELDS = new Set(["message", "stack", "cause"]);

/** A query error's own properties that hold its SQL and bound values. */
const QUERY_FIELDS = new Set(["query", "params"]);

/** Most values one check or copy looks at. */
const MAX_NODES = 5000;

/** Most own fields a value can have and still be checked. */
const MAX_FIELDS = 5000;

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

/** A statement as {@link statementSummary} writes it. */
const SUMMARY =
  "query|update [\\w$.]+|(?:select|insert|delete|replace) (?:into|from) [\\w$.]+|select|insert|update|delete|replace|with|create|drop|alter|pragma";

/** Text after the prefix that's already reduced: a summary, and maybe a cause. */
const REDUCED = new RegExp(`^(${SUMMARY})(?:\\. Cause: (.*))?$`, "s");

/** A single-quoted SQL string, with `''` for a quote inside it. An unclosed one
 *  runs to the end. */
const SQL_STRING = /'(?:[^']|'')*(?:'|$)/g;

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
 * that quotes one, such as `Save failed: Failed query: … params: …`. Text that
 * quotes a query without its `params:` marker is reduced too, since a clipped
 * line or SQL with an inlined value can still hold one. Text that's already
 * reduced keeps its statement and has its cause cut at the first quoted
 * literal, so running it twice changes nothing.
 */
export function redactQueryText(text: string): string {
  const start = text.indexOf(QUERY_PREFIX);
  if (start === -1) return text;
  const head = `${text.slice(0, start)}${QUERY_PREFIX}`;
  const rest = text.slice(start + QUERY_PREFIX.length);
  const marker = PARAMS_MARKER.exec(rest);
  if (marker) return `${head}${statementSummary(rest.slice(0, marker.index))}`;
  const reduced = REDUCED.exec(rest);
  if (!reduced) return `${head}${statementSummary(rest)}`;
  const cause = reduced[2];
  return cause === undefined
    ? `${head}${reduced[1]}`
    : `${head}${reduced[1]}. Cause: ${redactLiterals(redactQueryText(cause))}`;
}

/**
 * A value that's safe to pass to `console.error`. A failed query's error, or
 * an error that holds one anywhere (in its `cause` chain, in `AggregateError`'s
 * `errors`, or in another own field), comes back as a copy whose query errors
 * carry their reduced message and a stack of frames only, so the log line
 * keeps the trace and loses the values. Each copied error keeps its original's
 * class, so `instanceof` still matches, and its own fields, such as a
 * `LouiseError`'s `name`, `code`, and `status`; a query error's `query` and
 * `params` are left out, and so is any field it can't check. A string that
 * quotes a failed query comes back reduced. Anything else comes back as it
 * was. It never throws.
 */
export function loggableError(value: unknown): unknown {
  try {
    if (typeof value === "object" && value !== null && copies.has(value)) return value;
    const walk: Walk = { left: MAX_NODES };
    if (!needsCopy(value, 0, walk)) return value;
    const copy = safeCopy(value, 0, { left: MAX_NODES });
    if (typeof copy === "object" && copy !== null) copies.add(copy);
    return copy;
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
  // A copy from `loggableError` already holds a summary; keep it.
  const summary = REDUCED.exec(sql)?.[1] ?? statementSummary(sql);
  const reduced = `${QUERY_PREFIX}${summary}`;
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
  // An inlined literal can hold `into` or `from` and a value after it.
  const match = TABLE.exec(sql.replace(SQL_STRING, "''"));
  const table = match ? identifier(match[2]!) : "";
  if (!table || !match) return kind;
  const keyword = match[1]!.toLowerCase();
  if (keyword === "update") return kind === "update" ? `update ${table}` : kind;
  return `${kind} ${keyword} ${table}`;
}

/** A table name without its quotes, or `""` when it isn't name-shaped. */
function identifier(raw: string): string {
  const name = raw.replace(/["`[\]]/g, "").replace(/\.+$/, "");
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

/** How many values one check or copy looks at before it stops trusting what's
 *  left, so a huge or cyclic structure can't make a log line slow. */
interface Walk {
  left: number;
}

/** The kinds of value a check looks inside. Anything else is left as it is,
 *  unless it's a field of an error being copied, where it's left out. */
type Inspectable = Error | readonly unknown[] | Record<string, unknown>;

/**
 * Whether a value needs a copy: an error, an array, or a plain object that
 * holds a failed query anywhere (its message, its `cause`, or an own field),
 * or a string that quotes one. Past {@link MAX_DEPTH}, or once the walk's
 * budget runs out, it answers yes, since what's left can't be checked.
 */
function needsCopy(value: unknown, depth: number, walk: Walk): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return quotesQuery(value);
  if (typeof value !== "object") return false;
  if (!isInspectable(value)) return false;
  if (depth > MAX_DEPTH || --walk.left < 0) return true;
  if (isError(value)) {
    if (isQueryError(value) || quotesQuery(read(value, "message"))) return true;
    if (needsCopy(read(value, "cause"), depth + 1, walk)) return true;
  }
  const fields = dataFields(value);
  if (fields === undefined) return true;
  return fields.some(([key, field]) => {
    if (isError(value) && REBUILT_FIELDS.has(key)) return false;
    return needsCopy(field, depth + 1, walk);
  });
}

/** Whether text quotes a failed query with its bound values. */
function quotesQuery(text: unknown): boolean {
  return typeof text === "string" && redactQueryText(text) !== text;
}

/**
 * A copy of a value with every query error in it reduced. A copied error keeps
 * its original's class (its prototype, so `instanceof` still matches) and its
 * own fields, so a `LouiseError` wrapping a query error keeps its `name`,
 * `code`, and `status`. Only text changes: a query error's message and stack,
 * and its `query` and `params` fields, which are left out. An array is copied
 * element by element, and a plain object field by field. Past
 * {@link MAX_DEPTH}, or once the walk's budget runs out, what's left is
 * dropped.
 */
function safeCopy(value: unknown, depth: number, walk: Walk): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === "string") return redactQueryText(value);
  if (typeof value !== "object" || value === null) return value;
  if (!isInspectable(value)) return value;
  if (!needsCopy(value, 0, { left: MAX_NODES })) return value;
  if (--walk.left < 0) return undefined;
  if (!isError(value)) return copyContainer(value, depth, walk);
  const query = isQueryError(value);
  const { name, message } = query ? queryErrorParts(value) : plainParts(value);
  // A native error, so a runtime prints it as one, then given the original's class.
  const copy = new Error(message);
  try {
    Object.setPrototypeOf(copy, Object.getPrototypeOf(value) as object | null);
  } catch {
    // A proxy that refuses: the copy stays a plain `Error`, which is still safe.
  }
  copyFields(value, copy, query, depth, walk);
  const holdsValues = query || quotesQuery(read(value, "message"));
  Object.defineProperty(copy, "stack", {
    value: `${name}: ${message}${framesOf(value, holdsValues)}`,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  const cause = safeCopy(read(value, "cause"), depth + 1, walk);
  if (cause !== undefined) {
    Object.defineProperty(copy, "cause", {
      value: cause,
      writable: true,
      configurable: true,
      enumerable: ownEnumerable(value, "cause"),
    });
  }
  return copy;
}

/** An array, element by element, or a plain object, field by field, each
 *  through {@link safeCopy}. What can't be copied is left out. */
function copyContainer(
  value: readonly unknown[] | Record<string, unknown>,
  depth: number,
  walk: Walk,
): unknown {
  const fields = dataFields(value);
  if (fields === undefined) return undefined;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const [key, field] of fields) {
      if (key === "length") continue;
      const safe = copyField(field, depth, walk);
      if (safe !== undefined) items.push(safe);
    }
    return items;
  }
  const copy: Record<string, unknown> = Object.create(
    Object.getPrototypeOf(value) as object | null,
  ) as Record<string, unknown>;
  for (const [key, field] of fields) {
    const safe = copyField(field, depth, walk);
    if (safe !== undefined) copy[key] = safe;
  }
  return copy;
}

/** One field of a value being copied: a string reduced, an error, an array, or
 *  a plain object copied, and anything else it can't check left out. */
function copyField(field: unknown, depth: number, walk: Walk): unknown {
  if (typeof field !== "object" || field === null) return safeCopy(field, depth + 1, walk);
  return isInspectable(field) ? safeCopy(field, depth + 1, walk) : undefined;
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

/**
 * The error's own data fields, such as `name`, `code`, `status`, `body`, and
 * `errors`, onto the copy. A string that quotes a failed query is reduced; an
 * error, an array, or a plain object is copied the same way as the chain; any
 * other object is left out, since it can't be checked. Never a query error's
 * SQL or bound values, and never a getter, which would run against the copy.
 */
function copyFields(from: Error, to: Error, query: boolean, depth: number, walk: Walk): void {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(from);
  } catch {
    return;
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (REBUILT_FIELDS.has(key) || (query && QUERY_FIELDS.has(key))) continue;
    if (!("value" in descriptor)) continue;
    const safe = copyField(descriptor.value as unknown, depth, walk);
    if (safe === undefined && descriptor.value !== undefined) continue;
    try {
      Object.defineProperty(to, key, { ...descriptor, value: safe });
    } catch {
      // A field the copy can't take is left out.
    }
  }
}

/** A value's own data fields, or `undefined` when they can't be read. */
function dataFields(value: object): [string, unknown][] | undefined {
  try {
    const fields: [string, unknown][] = [];
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if ("value" in descriptor) fields.push([key, descriptor.value as unknown]);
    }
    return fields.length > MAX_FIELDS ? undefined : fields;
  } catch {
    return undefined;
  }
}

/** An error, an array, or a plain object: what a check can look inside. */
function isInspectable(value: object): value is Inspectable {
  try {
    if (isError(value) || Array.isArray(value)) return true;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

/** Whether `key` is an own enumerable property, `false` when it can't tell. */
function ownEnumerable(value: object, key: string): boolean {
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.enumerable === true;
  } catch {
    return false;
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
