// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/content — afterChange-style outbound webhooks. The
// `afterChange` hook itself only enqueues (via `louise-toolkit/queues`'
// `enqueue`) — it never calls `fetch()` directly, so a slow or down
// receiving endpoint can't add latency to a write request or get lost on
// a single failed attempt. `deliverWebhookMessage` is the consumer-side
// counterpart: a separate queue consumer calls it per message, and
// `processBatch` (queues/index.ts) turns a thrown delivery failure into a
// retry, eventually landing in that queue's configured DLQ.

import { LouiseQueueError } from "../errors.js";
import { enqueue } from "../queues/index.js";
import { BlockedUrlError, fetchPublicUrl, type PublicUrlPolicy } from "../security/public-url.js";
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
 * Delivers a single `WebhookMessage`. Throws `LouiseQueueError` on a refused
 * URL, a non-2xx response, or no response at all — meant to be called from
 * inside `processBatch`'s handler, where a thrown error becomes a
 * `message.retry()`.
 *
 * The URL goes through `fetchPublicUrl`: https only, no IP addresses or
 * private-network names, every redirect hop checked, a timeout. The error
 * names the endpoint's origin, never its path — a webhook path is often the
 * credential (a Slack or Discord hook URL is one).
 */
export async function deliverWebhookMessage(
  message: WebhookMessage,
  policy: PublicUrlPolicy = {},
): Promise<void> {
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

  const endpoint = originOf(message.url);
  let response: Response;
  try {
    response = await fetchPublicUrl(message.url, {
      ...policy,
      provider: "Webhook",
      method: "POST",
      headers,
      body,
    });
  } catch (cause) {
    const why = cause instanceof BlockedUrlError ? `: ${cause.reason}` : "";
    throw new LouiseQueueError(`Webhook delivery to ${endpoint} failed${why}`, cause);
  }
  if (!response.ok) {
    throw new LouiseQueueError(
      `Webhook delivery to ${endpoint} returned status ${response.status}`,
    );
  }
}

/** The endpoint's origin, for an error message — never the path. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "an invalid URL";
  }
}
