// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/security — the one way the toolkit calls a third-party API
// (ADR 0012 §3).
//
// Every provider client used to call `fetch` itself: no timeout, redirects
// followed, and the provider's own error text copied into `Error.message` —
// which routes then handed straight to the browser. `upstreamFetch` fixes the
// first two once. `UpstreamError` fixes the third: its `message` is safe to
// show a user, and what the provider actually said is kept on `detail`, which
// is for logs and never serialized.

/** How long an upstream call may take before it's abandoned. */
export const UPSTREAM_TIMEOUT_MS = 10_000;

export interface UpstreamFetchInit extends RequestInit {
  /** Who is being called — `"Square"`, `"Stripe"`. Names the error. */
  provider: string;
  /** Abandon the call after this long. Default {@link UPSTREAM_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface UpstreamErrorInit {
  /** The provider's own error code (`"NOT_FOUND"`, `"card_declined"`). Safe to
   *  show and to branch on; anything that isn't code-shaped is dropped. */
  code?: string | null;
  /** What the provider said, verbatim. For logs — never for a response. */
  detail?: string | null;
  /** Method and path (never the query, which can carry a token). For logs. */
  operation?: string | null;
  cause?: unknown;
}

// A code is shown to users, so it has to look like one: an identifier, not a
// sentence a provider (or whoever answered in its place) chose to put there.
const CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * A call to a third-party API that failed. `message` is safe to put in front of
 * a user — provider, status, and the provider's code, nothing it wrote. The
 * provider's own words are on `detail`, non-enumerable so `{ ...err }`,
 * `JSON.stringify(err)` and a logger copying fields all leave it behind.
 *
 * Log with {@link upstreamLogLine}, which includes it. Show `message`, or map
 * `code` to your own copy.
 */
export class UpstreamError extends Error {
  readonly provider: string;
  /** HTTP status, or `0` when no response arrived (timeout, network). */
  readonly status: number;
  readonly code: string | null;
  /** Worth retrying: rate limited, a server fault, or no response at all. A
   *  4xx means the request itself is wrong and will stay wrong. */
  readonly retryable: boolean;
  declare readonly detail: string | null;
  declare readonly operation: string | null;

  constructor(provider: string, status: number, init: UpstreamErrorInit = {}) {
    const code = init.code && CODE_SHAPE.test(init.code) ? init.code : null;
    super(
      status === 0
        ? `${provider} request failed (${code === "timeout" ? "timed out" : "no response"})`
        : `${provider} request failed (${status}${code ? ` ${code}` : ""})`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = "UpstreamError";
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.retryable = status === 0 || status === 429 || status >= 500;
    Object.defineProperty(this, "detail", { value: init.detail ?? null, enumerable: false });
    Object.defineProperty(this, "operation", { value: init.operation ?? null, enumerable: false });
  }

  /** What `JSON.stringify` sees: the fields that are safe to send. */
  toJSON(): {
    name: string;
    provider: string;
    status: number;
    code: string | null;
    message: string;
  } {
    return {
      name: this.name,
      provider: this.provider,
      status: this.status,
      code: this.code,
      message: this.message,
    };
  }
}

/**
 * One log line for any error, with everything an upstream failure knows:
 * operation, status, code, and what the provider said. For logs only — the
 * point of `UpstreamError` is that its `message` alone is what users see.
 */
export function upstreamLogLine(err: unknown): string {
  if (err instanceof UpstreamError) {
    const where = err.operation ? ` ${err.operation}` : "";
    const code = err.code ? ` ${err.code}` : "";
    const detail = err.detail ? `: ${err.detail}` : "";
    return `${err.provider}${where} ${err.status}${code}${detail}`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** `METHOD /path` for logs — the pathname only, since a query can carry a token. */
function operationOf(input: string | URL, method: string | undefined): string {
  let path: string;
  try {
    path = new URL(String(input)).pathname;
  } catch {
    path = "?";
  }
  return `${(method ?? "GET").toUpperCase()} ${path}`;
}

/**
 * `fetch` for a third-party API. Adds what every provider call needs and none
 * of them had:
 *
 * - **A timeout** (default 10 s), combined with the caller's own `signal`.
 * - **`redirect: "manual"`.** Provider APIs don't redirect; a 3xx comes back as
 *   a non-ok response rather than being followed somewhere nobody chose.
 * - **A safe failure.** No response at all becomes an {@link UpstreamError}
 *   with status `0` and code `timeout` or `network`.
 *
 * A non-2xx is returned, not thrown: each provider reads its own error shape.
 * Read the body with {@link readUpstreamBody} and throw an `UpstreamError`.
 * A caller that aborts through its own `signal` gets its own abort back.
 */
export async function upstreamFetch(
  input: string | URL,
  init: UpstreamFetchInit,
): Promise<Response> {
  const { provider, timeoutMs = UPSTREAM_TIMEOUT_MS, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(input, {
      redirect: "manual",
      ...rest,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new UpstreamError(provider, 0, {
      code: timeout.aborted ? "timeout" : "network",
      detail: err instanceof Error ? err.message : String(err),
      operation: operationOf(input, rest.method),
      cause: err,
    });
  }
}

/**
 * Read a provider's response body without letting it into an error message:
 * `json` when it parses, and always the raw `text`. `res.json()` on an HTML
 * error page throws a `SyntaxError` that quotes the page, which is the same
 * leak by another route.
 */
export async function readUpstreamBody(res: Response): Promise<{ json: unknown; text: string }> {
  const text = await res.text().catch(() => "");
  if (!text) return { json: undefined, text };
  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { json: undefined, text };
  }
}
