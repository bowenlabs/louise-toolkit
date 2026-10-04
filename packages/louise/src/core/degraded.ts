// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `reportDegraded`—the one call a fallback makes to say it fired (#556).
//
// Degrading instead of crashing is a house rule: a limiter outage fails open, a
// broken dashboard card collapses to "absent," an AI assist returns `null`. The
// trouble is that a degrade is quiet by design. A page that falls back to seed
// or stale content still answers 200, and nothing notices until a person looks.
// This module gives every such `catch` one shared, greppable log line, and a
// seam that later incident capture can listen on without any call site
// changing.
//
// It's exported from `louise-toolkit/errors`, next to the error classes, so a
// site that already imports those has it at hand. Kit modules import it from
// here directly.

import { isQueryError, queryErrorParts, redactQueryText } from "./query-error.js";
import { UpstreamError, upstreamLogLine } from "./security/upstream.js";

/** Small, JSON-serializable context for a degrade: an id, a count, a status.
 *  It's logged, so never put a secret, a token, or personal data in it. */
export type DegradedDetails = Readonly<Record<string, unknown>>;

/** What a {@link DegradedListener} receives for each {@link reportDegraded} call. */
export interface DegradedEvent {
  /** Which fallback fired, as a stable dotted name, for example, `"forms.notify.webhook"`. */
  readonly name: string;
  /** The cause, reduced to one line of text: `"TypeError: fetch failed"`. An
   *  `UpstreamError` adds its operation and what the provider said. */
  readonly message: string;
  /** The original cause, as passed. `undefined` when there wasn't one. */
  readonly cause: unknown;
  /** The details, as passed. */
  readonly details: DegradedDetails | undefined;
}

/** Hears every degrade in this isolate. See {@link onDegraded}. */
export type DegradedListener = (event: DegradedEvent) => void;

/** The line prefix every degrade logs with. Grep a log stream for it. */
export const DEGRADED_LOG_PREFIX = "[louise] degraded";

/** Longest cause message that goes into the log line; the rest is cut. */
const MAX_MESSAGE = 500;
/** Longest serialized details that go into the log line. */
const MAX_DETAILS = 1000;

const listeners = new Set<DegradedListener>();

/**
 * Report that a fallback fired: the code caught a failure and served something
 * lesser (seed or stale content, an empty result, a skipped side effect) rather
 * than failing the request.
 *
 * Logs exactly one line at error level, in a fixed shape you can grep for:
 *
 * ```text
 * [louise] degraded <name>: <cause> <details as JSON>
 * ```
 *
 * `name` says which fallback fired. Keep it stable and dotted, area first
 * (`"content.read"`, `"commerce.products"`), so one search finds every
 * occurrence across deploys. `cause` is whatever the `catch` caught—an `Error`,
 * a string, anything. `details` is optional, small, JSON-serializable context.
 *
 * It returns nothing and never throws, whatever `cause` and `details` hold: a
 * reporter that threw would turn a graceful degrade into the crash it was
 * written to avoid.
 *
 * Import it from the `errors` subpath. (The example leaves the import out:
 * this comment ships inside the lightweight Turnstile entry, whose emitted
 * code the export-map check scans for package imports.)
 *
 * @example
 * ```ts
 * let products;
 * try {
 *   products = await listProducts(env);
 * } catch (err) {
 *   reportDegraded("commerce.products", err, { source: "seed" });
 *   products = seedProducts;
 * }
 * ```
 */
export function reportDegraded(name: string, cause?: unknown, details?: DegradedDetails): void {
  try {
    const event: DegradedEvent = {
      name: safeText(name, "unnamed"),
      message: describeCause(cause),
      cause,
      details,
    };
    const extra = serializeDetails(details);
    console.error(`${DEGRADED_LOG_PREFIX} ${event.name}: ${event.message}${extra}`);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A listener's failure is its own; it can't be allowed to reach the
        // fallback that called in.
      }
    }
  } catch {
    // Unreachable in practice—every step above already guards itself—but the
    // no-throw contract is the whole point, so it's held here too.
  }
}

/**
 * Listen for every {@link reportDegraded} call in this isolate, for example,
 * to forward degrades to an error tracker or count them in a metric. Returns a
 * function that removes the listener.
 *
 * Listeners run synchronously, after the log line, and a listener that throws
 * is ignored. Register one at module scope rather than per request, because
 * the set lives as long as the isolate does. Louise's own incident capture is
 * meant to hook in here, so a site's `reportDegraded` calls won't need to
 * change when it does.
 */
export function onDegraded(listener: DegradedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One line of text for any thrown value, without ever throwing itself. */
function describeCause(cause: unknown): string {
  const { name, message } = causeParts(cause);
  if (!name) return clip(message, MAX_MESSAGE);
  return clip(message ? `${name}: ${message}` : name, MAX_MESSAGE);
}

/**
 * A thrown value's name and message, each flattened to one line, without ever
 * throwing. A failed query's error keeps its statement and its driver's error,
 * never its bound values. `name` is empty for a value that isn't an `Error`. Incident capture
 * reads a cause the same way, so it's exported, but it's on no subpath.
 */
export function causeParts(cause: unknown): { name: string; message: string } {
  if (cause === undefined) return { name: "", message: "no cause given" };
  if (isError(cause) && isUpstream(cause)) {
    // Its `message` is the user-safe summary; a log line wants the operation
    // and what the provider said, which `upstreamLogLine` adds.
    try {
      const name = safeText(read(cause, "name") ?? "UpstreamError", "UpstreamError");
      return { name, message: redactQueryText(safeText(upstreamLogLine(cause), "")) };
    } catch {
      // Fall through to the plain `Error` path.
    }
  }
  if (isError(cause) && isQueryError(cause)) {
    // drizzle-orm's message carries the query's bound values, which are
    // personal data as often as not. Keep the statement and the driver's error.
    const parts = queryErrorParts(cause);
    return { name: safeText(parts.name, "Error"), message: safeText(parts.message, "") };
  }
  if (isError(cause)) {
    return {
      name: safeText(read(cause, "name") ?? "Error", "Error"),
      message: redactQueryText(safeText(read(cause, "message") ?? "", "")),
    };
  }
  return { name: "", message: redactQueryText(safeText(cause, "unprintable cause")) };
}

/** `instanceof Error`, or `false` when a proxy's prototype trap throws. */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/** `instanceof UpstreamError`, guarded like {@link isError}. */
function isUpstream(value: Error): value is UpstreamError {
  try {
    return value instanceof UpstreamError;
  } catch {
    return false;
  }
}

/** `error[key]`, or `undefined` when a getter throws. */
function read(error: Error, key: "name" | "message"): unknown {
  try {
    return error[key];
  } catch {
    return undefined;
  }
}

/** `String(value)`, or `fallback` when that throws, with the value flattened to
 *  one line so the log entry stays one line. */
function safeText(value: unknown, fallback: string): string {
  try {
    const text = typeof value === "string" ? value : String(value);
    return text.replace(/\s*[\r\n]+\s*/g, " ").trim() || fallback;
  } catch {
    return fallback;
  }
}

/** ` {"k":"v"}` for non-empty details, `""` for none. */
function serializeDetails(details: DegradedDetails | undefined): string {
  if (details === undefined || details === null) return "";
  try {
    const json = JSON.stringify(details);
    if (!json || json === "{}") return "";
    return ` ${clip(json, MAX_DETAILS)}`;
  } catch {
    return " [details not serializable]";
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
