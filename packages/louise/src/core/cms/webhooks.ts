// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/cms — afterChange-style outbound webhooks. The
// `afterChange` hook itself only enqueues (via `louise/queues`'
// `enqueue`) — it never calls `fetch()` directly, so a slow or down
// receiving endpoint can't add latency to a write request or get lost on
// a single failed attempt. `deliverWebhookMessage` is the consumer-side
// counterpart: a separate queue consumer calls it per message, and
// `processBatch` (queues/index.ts) turns a thrown delivery failure into a
// retry, eventually landing in that queue's configured DLQ.

import { LouiseQueueError } from "../errors.js";
import { enqueue } from "../queues/index.js";
import type { CollectionHooks } from "./types.js";

export interface WebhookConfig {
  /** Endpoint this webhook POSTs to on every matching event. */
  url: string;
  /** Restricts delivery to these operations. Default: both. */
  events?: Array<"create" | "update">;
  /**
   * When set, every delivery carries an `X-Louise-Signature` header —
   * HMAC-SHA256 (hex) over the raw JSON body — so the receiver can verify
   * the payload actually came from this Louise instance.
   */
  secret?: string;
}

/** The shape enqueued by `createWebhookHook`, consumed by `deliverWebhookMessage`. */
export interface WebhookMessage {
  url: string;
  secret?: string;
  event: "create" | "update";
  doc: Record<string, unknown>;
  /** ms since epoch, included in the signed/delivered payload. */
  timestamp: number;
}

/**
 * Builds an `afterChange` hook that enqueues a `WebhookMessage` for every
 * matching write — append the result to a collection's
 * `hooks.afterChange` array. `queue` is whatever `Queue<WebhookMessage>`
 * binding the caller's Worker has configured for webhook dispatch (see
 * wrangler.jsonc's webhook queue producer binding).
 */
export function createWebhookHook(
  queue: Queue<WebhookMessage>,
  config: WebhookConfig,
): NonNullable<CollectionHooks["afterChange"]>[number] {
  return async ({ doc, operation }) => {
    if (config.events && !config.events.includes(operation)) return;
    await enqueue(queue, {
      url: config.url,
      secret: config.secret,
      event: operation,
      doc,
      timestamp: Date.now(),
    });
  };
}

// Defense-in-depth, not the primary control: `global_fetch_strictly_public`
// (set in both Workers' wrangler.jsonc) already blocks `fetch()` to
// private/reserved IP literals at the platform level, and `WEBHOOK_URL` is
// operator-supplied config, not attacker input. This catches the case that
// guard doesn't: a hostname that *resolves* to a private address (or a
// non-HTTP(S) scheme) rather than being one literally, plus a clear error
// instead of a platform-level network failure when a deploy is
// misconfigured.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./, // link-local, including the cloud-metadata address
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^\[?::1\]?$/,
  /^\[?fc/i,
  /^\[?fd/i,
  /^\[?fe80/i,
];

function isAllowedWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  return !BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
}

async function hmacSha256Hex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Delivers a single `WebhookMessage` via `fetch()`. Throws
 * `LouiseQueueError` on any non-2xx response or network failure — meant
 * to be called from inside `processBatch`'s handler, where a thrown error
 * becomes a `message.retry()`.
 */
export async function deliverWebhookMessage(message: WebhookMessage): Promise<void> {
  if (!isAllowedWebhookUrl(message.url)) {
    throw new LouiseQueueError(
      `Webhook URL "${message.url}" is not allowed (must be http(s) and not target a private/reserved/loopback address)`,
    );
  }

  const body = JSON.stringify({
    event: message.event,
    doc: message.doc,
    timestamp: message.timestamp,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (message.secret) {
    headers["X-Louise-Signature"] = await hmacSha256Hex(body, message.secret);
  }

  let response: Response;
  try {
    response = await fetch(message.url, { method: "POST", headers, body });
  } catch (cause) {
    throw new LouiseQueueError(`Webhook delivery to "${message.url}" failed`, cause);
  }
  if (!response.ok) {
    throw new LouiseQueueError(
      `Webhook delivery to "${message.url}" returned status ${response.status}`,
    );
  }
}
