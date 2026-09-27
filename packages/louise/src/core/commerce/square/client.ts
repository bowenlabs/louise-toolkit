// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: configuration, the application ID check, and the error
// type every call throws.

import { UpstreamError } from "../../security/upstream.js";

export type SquareEnvironment = "sandbox" | "production";

export interface SquareConfig {
  /** Square access token (server-only secret). */
  accessToken: string;
  /** Defaults to "sandbox". Selects the API host. */
  environment?: SquareEnvironment;
  /** Pinned Square-Version. Bump deliberately (response shapes are stable per
   * version). Defaults to SQUARE_VERSION. */
  version?: string;
  /** Transient-failure retry. OFF by default, so existing callers are byte-for-byte
   *  unchanged; turn it on for unattended paths (cron sync, queue consumers) where
   *  a 429 or a 5xx should cost a second rather than fail the job. Never retries a
   *  4xx other than 429—those are our bug, not Square's weather. */
  retry?: SquareRetryConfig;
  /** Abandon a request after this long, per attempt. Default 10 s. Raise it for
   *  a slow bulk call (a large catalog upsert, an image upload). */
  timeoutMs?: number;
}

export interface SquareRetryConfig {
  /** Attempts AFTER the first try. 0 disables. Defaults to 2. */
  attempts?: number;
  /** First backoff step in ms; doubles each attempt. Defaults to 250. */
  baseDelayMs?: number;
  /** Ceiling for one backoff step. Defaults to 4000. */
  maxDelayMs?: number;
}

// Pin the API version so an account-default upgrade can't silently change
// response shapes (Square best practice—mirrors what the SDKs pin at
// release). This matches the default baked into the square@44 SDK
// (BaseClient sends `Square-Version: 2026-01-22`). Bump deliberately.
export const SQUARE_VERSION = "2026-01-22";

/**
 * Which Square environment an application id belongs to, from its format—`sandbox-sq0idb-…`
 * or `sq0idp-…`—or `null` when it is neither (a
 * placeholder, a typo, an access token pasted into the wrong variable).
 *
 * The Web Payments SDK rejects a malformed id with "…not in the correct
 * format" and an id from the other environment with an opaque error at
 * checkout. Compare the result with the environment the server uses and
 * show a clear "payments not available" state instead.
 */
export function squareApplicationIdEnvironment(
  applicationId: string | null | undefined,
): SquareEnvironment | null {
  const id = applicationId?.trim() ?? "";
  if (/^sandbox-sq0idb-[\w-]+$/.test(id)) return "sandbox";
  if (/^sq0idp-[\w-]+$/.test(id)) return "production";
  return null;
}

interface SquareErrorBody {
  errors?: { code?: string; detail?: string; category?: string }[];
}

/**
 * A non-2xx answer from Square—an {@link UpstreamError}, so `message` is safe
 * to show a user and Square's own `detail` stays in the logs. `status` and
 * `code` (Square's first error code, for example, `"NOT_FOUND"`) are what let a caller
 * tell "not found" (a 404 is often an answer—no loyalty program, no such
 * card) from a failure, and map a decline to its own copy.
 */
export class SquareApiError extends UpstreamError {
  /** Square's error category, for example, `"PAYMENT_METHOD_ERROR"`—a decline, the
   *  buyer's to fix—as opposed to `"INVALID_REQUEST_ERROR"`, which is ours. */
  readonly category: string | null;
  constructor(operation: string, status: number, body: SquareErrorBody, raw = "") {
    const first = body.errors?.[0];
    super("Square", status, {
      code: first?.code ?? null,
      detail: first?.detail ?? (raw.slice(0, 500) || null),
      operation,
    });
    this.name = "SquareApiError";
    this.category = first?.category ?? null;
  }
}
