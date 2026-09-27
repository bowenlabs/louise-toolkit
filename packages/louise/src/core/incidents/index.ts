// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/incidents—the report every failure becomes (ADR 0022).
//
// A throw from a route, a queue handler, or a cron, and a fallback that fired
// (`reportDegraded`), each become one `IncidentReport`. Reports with the same
// fingerprint are one incident: a sink counts them, and the count is what
// tells a one-off from a pattern. This file is the pure part: the report's
// shape, the fingerprint, and the redaction every report gets before any sink
// sees it. Capture and the sinks build on it.
//
// No bindings and no dependencies, so any Worker code can import it.

import { causeParts, type DegradedEvent } from "../degraded.js";
import { LouiseError } from "../errors.js";

/** Where a failure came from: the Worker handler that saw it, or a fallback. */
export type IncidentKind = "fetch" | "queue" | "scheduled" | "degraded";

/**
 * One failure, flat and JSON-serializable, so it crosses a queue or an HTTP
 * call unchanged. Build one with {@link buildIncidentReport} or
 * {@link incidentFromDegraded}, which redact it, rather than by hand.
 */
export interface IncidentReport {
  readonly kind: IncidentKind;
  /** The grouping key from {@link fingerprintFailure}: 16 hex characters. */
  readonly fingerprint: string;
  /** The error's class (`TypeError`), or a degrade's dotted name (`commerce.products`). */
  readonly name: string;
  /** A `LouiseError`'s `code` (`DB_ERROR`), when the cause was one. */
  readonly code?: string;
  /** One line, redacted, at most {@link MAX_INCIDENT_MESSAGE} characters. */
  readonly message: string;
  /**
   * The request's pathname for `fetch`, never its query string; the queue's
   * name for `queue`; the cron expression for `scheduled`. Redacted like the
   * message, since a path can carry a token.
   */
  readonly path?: string;
  /** The request's host, so preview traffic stays apart from production. */
  readonly host?: string;
  /** The deployed version, when the site knows it. */
  readonly release?: string;
  /** Whether the site marked this failure critical. */
  readonly critical: boolean;
  /** Epoch milliseconds. */
  readonly at: number;
}

/**
 * Takes each report. Capture runs a sink after the response, and a sink that
 * throws or rejects is logged and ignored, so it can't fail the request it's
 * reporting on.
 */
export type IncidentSink = (report: IncidentReport) => void | Promise<void>;

/** Longest `message` a report keeps, counting the ellipsis that marks a cut. */
export const MAX_INCIDENT_MESSAGE = 500;

/** What {@link buildIncidentReport} takes. Everything but `kind` is optional. */
export interface IncidentInput {
  readonly kind: IncidentKind;
  /** Whatever was thrown or caught. Its name, message, and code fill the report. */
  readonly cause?: unknown;
  /** Overrides the cause's name, for example, with a degrade's dotted name. */
  readonly name?: string;
  /** Overrides the cause's message. */
  readonly message?: string;
  /** The request being served, for `path` and `host`. */
  readonly request?: Request;
  /** The path when there's no request: a queue's name, a cron expression. */
  readonly path?: string;
  readonly release?: string;
  readonly critical?: boolean;
  /** Epoch milliseconds. Defaults to `Date.now()`. */
  readonly now?: number;
}

/**
 * Build a redacted {@link IncidentReport}. It never throws, whatever `cause`
 * holds: it runs while something else is already failing.
 *
 * @example
 * ```ts
 * try {
 *   return await handle(request, env);
 * } catch (err) {
 *   const report = buildIncidentReport({ kind: "fetch", cause: err, request });
 *   ctx.waitUntil(sink(report));
 *   throw err;
 * }
 * ```
 */
export function buildIncidentReport(input: IncidentInput): IncidentReport {
  const parts = causeParts(input.cause);
  const name = oneLine(input.name ?? "", "") || parts.name || "Error";
  const message = cleanMessage(input.message ?? parts.message);
  const code = louiseCode(input.cause);
  const url = requestUrl(input.request);
  const path = url?.pathname ?? input.path;
  return {
    kind: input.kind,
    fingerprint: fingerprintFailure({ kind: input.kind, name, code, message }),
    name,
    ...(code === undefined ? {} : { code }),
    message,
    ...(path ? { path: cleanMessage(path) } : {}),
    ...(url ? { host: url.host } : {}),
    ...(input.release ? { release: input.release } : {}),
    critical: input.critical === true,
    at: input.now ?? Date.now(),
  };
}

/**
 * The report for a `reportDegraded` call: kind `degraded`, named for the
 * fallback that fired, with the cause's code when it was a `LouiseError`.
 */
export function incidentFromDegraded(
  event: DegradedEvent,
  options: Pick<IncidentInput, "release" | "critical" | "now"> = {},
): IncidentReport {
  return buildIncidentReport({
    ...options,
    kind: "degraded",
    cause: event.cause,
    name: event.name,
    message: event.message,
  });
}

/**
 * Whether a report matches the site's critical list. Only the site knows which
 * failures matter most, so the list is a parameter (ADR 0022 § 6). An entry
 * that starts with `/` is a path prefix: `/cart` matches `/cart` and
 * `/cart/checkout`, not `/cartoon`. Any other entry is a name, and matches
 * that name and the dotted names under it: `commerce.checkout` matches
 * `commerce.checkout.session` too.
 */
export function isCriticalIncident(
  report: Pick<IncidentReport, "name" | "path">,
  critical: readonly string[],
): boolean {
  return critical.some((entry) => {
    if (!entry) return false;
    if (entry.startsWith("/")) {
      const path = report.path;
      if (!path) return false;
      const prefix = entry.endsWith("/") ? entry : `${entry}/`;
      return path === entry || path.startsWith(prefix);
    }
    return report.name === entry || report.name.startsWith(`${entry}.`);
  });
}

/**
 * The grouping key for a failure: 16 hex characters from the kind, the name,
 * the code, and the message with its variable parts replaced (numbers, IDs,
 * quoted values, email addresses, tokens). "Row 41 not found" and "Row 97 not
 * found" share a fingerprint.
 *
 * It leaves out the path, so one bug across many pages is one incident; the
 * stack, whose line numbers move with every deploy; and the release, so a
 * failure that comes back after a fix reads as the same incident. It's pure
 * and synchronous, and gives the same answer for a raw message and for the
 * redacted one a report stores.
 */
export function fingerprintFailure(failure: {
  readonly kind: IncidentKind;
  readonly name: string;
  readonly code?: string;
  readonly message: string;
}): string {
  const key = [failure.kind, failure.name, failure.code ?? "", normalize(failure.message)].join(
    "\u0000",
  );
  return fnv1a64(key);
}

/**
 * The redaction every report's `message` and `path` get: email addresses
 * become `[email]`, and a run of 24 or more token characters that includes a
 * digit becomes `[redacted]`. It's a floor, not a guarantee, so never put
 * personal data in an error message or a degrade's details.
 */
export function redactMessage(text: string): string {
  return text.replace(EMAIL, "[email]").replace(TOKEN, "[redacted]");
}

// Deliberately loose: a false positive costs one placeholder in a log line,
// and a miss leaks an address.
const EMAIL = /[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[a-z]{2,}/gi;
// Base64 and base64url characters, no slash, so a path's segments are judged
// one at a time. The digit lookahead spares long hyphenated names.
const TOKEN = /(?=[A-Za-z0-9+_=-]*\d)(?=[A-Za-z0-9+_=-]*[A-Za-z])[A-Za-z0-9+_=-]{24,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A single quote counts only after a space or an opening mark, so the
// apostrophe in "can't" doesn't open a quoted value.
const QUOTED = /"[^"]*"|`[^`]*`|(^|[\s(=:[])'[^'\n]*'/g;
const HEX = /\b[0-9a-f]{8,}\b/gi;
const NUMBER = /\d+/g;

function normalize(message: string): string {
  return cleanMessage(message)
    .replace(UUID, "<id>")
    .replace(QUOTED, (_match, lead: string | undefined) => `${lead ?? ""}<value>`)
    .replace(HEX, "<hex>")
    .replace(NUMBER, "<n>");
}

/** Redacted, one line, and clipped. Running it twice changes nothing. */
function cleanMessage(text: string): string {
  const line = redactMessage(oneLine(text, ""));
  return line.length > MAX_INCIDENT_MESSAGE ? `${line.slice(0, MAX_INCIDENT_MESSAGE - 1)}…` : line;
}

function oneLine(value: string, fallback: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim() || fallback;
}

/** A `LouiseError`'s code, or `undefined`, guarded against hostile getters. */
function louiseCode(cause: unknown): string | undefined {
  try {
    if (!(cause instanceof LouiseError)) return undefined;
    const code: unknown = cause.code;
    return typeof code === "string" && code ? oneLine(code, "") || undefined : undefined;
  } catch {
    return undefined;
  }
}

function requestUrl(request: Request | undefined): URL | undefined {
  if (!request) return undefined;
  try {
    return new URL(request.url);
  } catch {
    return undefined;
  }
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** 64-bit FNV-1a over the text's UTF-8 bytes, as 16 hex characters. A
 *  grouping key, not a security boundary, so a fast non-cryptographic hash
 *  that needs no `await` is the right fit. */
function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
