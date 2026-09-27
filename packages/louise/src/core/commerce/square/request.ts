// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: the one request path every call goes through.
//
// Internal: `square.ts` doesn't re-export this file, so nothing here is public.

import { readUpstreamBody, upstreamFetch } from "../../security/upstream.js";
import {
  SQUARE_VERSION,
  SquareApiError,
  type SquareConfig,
  type SquareEnvironment,
} from "./client.js";

const HOSTS: Record<SquareEnvironment, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

function host(config: SquareConfig): string {
  return HOSTS[config.environment ?? "sandbox"];
}

function headers(config: SquareConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "square-version": config.version ?? SQUARE_VERSION,
  };
}

/** Same headers minus `content-type`: `fetch` derives it from the FormData,
 *  including the multipart boundary, which we cannot compute ourselves. */
function multipartHeaders(config: SquareConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.accessToken}`,
    accept: "application/json",
    "square-version": config.version ?? SQUARE_VERSION,
  };
}

/** Run a read, turning Square's 404 into `null`; every other error still throws. */
export async function orNotFound<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof SquareApiError && err.status === 404) return null;
    throw err;
  }
}

/** Retryable = Square's weather, not our bug: rate limiting and server faults.
 *  A 400/401/403/404 means the request itself is wrong and will stay wrong. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** `Retry-After` in seconds (Square sends it on 429), or null. Honouring the
 *  server's own number beats guessing with a backoff curve. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The single request path every sq* helper goes through.
 *
 * Retries only when `config.retry` is set, so behaviour is unchanged for callers
 * that never opt in. Idempotency is the caller's job and Square's model makes
 * that workable: every mutating endpoint here takes an `idempotency_key`, so a
 * retried POST that actually succeeded server-side collapses rather than
 * double-charging—which is exactly why retrying POSTs is safe at all.
 */
export async function sqFetch<T>(
  config: SquareConfig,
  path: string,
  init: { method: string; body?: unknown; formData?: FormData },
): Promise<T> {
  const retry = config.retry;
  const attempts = Math.max(0, retry?.attempts ?? (retry ? 2 : 0));
  const baseDelay = retry?.baseDelayMs ?? 250;
  const maxDelay = retry?.maxDelayMs ?? 4000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await upstreamFetch(`${host(config)}${path}`, {
        provider: "Square",
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        method: init.method,
        headers: init.formData ? multipartHeaders(config) : headers(config),
        ...(init.formData
          ? { body: init.formData }
          : init.body === undefined
            ? {}
            : { body: JSON.stringify(init.body) }),
      });
    } catch (err) {
      // No response (timeout, DNS, connection reset)—retryable in the same
      // way a 5xx is, but there is no status to read.
      lastError = err;
      if (attempt === attempts) throw err;
      await sleep(Math.min(baseDelay * 2 ** attempt, maxDelay));
      continue;
    }

    const operation = `${init.method} ${path.split("?")[0]}`;
    const { json, text } = await readUpstreamBody(res);
    if (res.ok) {
      // A 2xx that isn't JSON is Square's failure, not an answer.
      if (json === undefined && text) {
        throw new SquareApiError(
          operation,
          res.status,
          { errors: [{ code: "INVALID_RESPONSE" }] },
          text,
        );
      }
      return json as T;
    }

    lastError = new SquareApiError(
      operation,
      res.status,
      (json ?? {}) as ConstructorParameters<typeof SquareApiError>[2],
      text,
    );
    if (attempt === attempts || !retryableStatus(res.status)) throw lastError;

    // Prefer Square's own Retry-After; otherwise exponential backoff with a
    // little jitter so concurrent workers don't resynchronize on the same tick.
    const backoff = Math.min(baseDelay * 2 ** attempt, maxDelay);
    await sleep(retryAfterMs(res) ?? backoff + Math.random() * baseDelay);
  }
  throw lastError;
}

export function sqGet<T>(config: SquareConfig, path: string): Promise<T> {
  return sqFetch<T>(config, path, { method: "GET" });
}

export function sqPost<T>(config: SquareConfig, path: string, body: unknown): Promise<T> {
  return sqFetch<T>(config, path, { method: "POST", body });
}

export function sqPut<T>(config: SquareConfig, path: string, body: unknown): Promise<T> {
  return sqFetch<T>(config, path, { method: "PUT", body });
}

export function sqDelete<T>(config: SquareConfig, path: string): Promise<T> {
  return sqFetch<T>(config, path, { method: "DELETE" });
}
