// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The webhook receiver: verify → enqueue → return fast.
//
// All three sites wrote this route the same way, and the ordering is the part
// worth encoding. **Verify the HMAC over the raw body before parsing anything.**
// Not for style — parsing first means an unauthenticated caller can reach the
// JSON parser and everything downstream of it, and re-serializing a parsed body
// to check the signature is how signature checks quietly stop checking anything.
// So the raw text is read once, verified, and only then parsed.
//
// The other half is what the status code means to the sender. Every provider
// here retries on non-2xx, which makes the response the only backpressure signal
// available: a 5xx means "try again", a 4xx means "never again", and returning
// the wrong one either loses the event permanently or pins the provider in a
// retry loop. Each code below is chosen for what it tells the sender to do.

import type { AstroidQueueMessage } from "./messages.js";

/**
 * The queue producer surface used here — structural, so a real `Queue<T>`
 * binding satisfies it without astroid depending on the Workers types.
 *
 * `Promise<unknown>` rather than `Promise<void>`: Cloudflare's `Queue.send`
 * resolves to a `QueueSendResponse`, and a `void` return type would reject the
 * actual binding. Nothing here reads the value.
 */
export interface QueueProducer<T = AstroidQueueMessage> {
  send(message: T): Promise<unknown>;
}

export interface WebhookVerifyInput {
  /** The raw request body, exactly as received. */
  raw: string;
  headers: Headers;
  url: URL;
  /** The signing secret — already checked to be real by the caller. */
  secret: string;
}

export interface WebhookRouteOptions {
  /** Which integration this endpoint serves — carried into the message. */
  provider: string;
  /**
   * The signing secret, or `null` when unprovisioned. Read it with
   * `readModuleSecret` so a placeholder counts as absent.
   */
  secret: string | null;
  /** Signature check over the raw body — e.g. `verifySquareSignature`. */
  verify: (input: WebhookVerifyInput) => boolean | Promise<boolean>;
  /** The queue binding, or null/undefined when Queues aren't provisioned. */
  queue?: QueueProducer | null;
  /**
   * Pull the event type out of the parsed payload. Defaults to a `type` field;
   * override for providers that name it differently (Fourthwall's `testMode`
   * envelope, Stripe's nested object).
   */
  eventType?: (payload: unknown) => string;
  /**
   * Decide whether an event is worth queueing at all. Returning false acks the
   * delivery without enqueuing — the provider is satisfied and the consumer
   * isn't woken for an event nothing acts on.
   */
  accept?: (type: string, payload: unknown) => boolean;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Default event-type reader: a top-level `type` string. */
function defaultEventType(payload: unknown): string {
  const type = (payload as { type?: unknown })?.type;
  return typeof type === "string" ? type : "";
}

/**
 * Handle one inbound provider webhook.
 *
 * ```ts
 * export const POST: APIRoute = ({ request, url }) =>
 *   handleWebhook(request, url, {
 *     provider: "square",
 *     secret: await readModuleSecret(env.SQUARE_WEBHOOK_SECRET),
 *     queue: env.COMMERCE_QUEUE,
 *     verify: ({ raw, headers, url, secret }) =>
 *       verifySquareSignature(url.href, raw, headers.get("x-square-hmacsha256-signature"), secret),
 *   });
 * ```
 */
export async function handleWebhook(
  request: Request,
  url: URL,
  options: WebhookRouteOptions,
): Promise<Response> {
  // 503, not 500 or 200: the module is dormant, which is a temporary state a
  // deploy fixes. 5xx keeps the provider retrying, so events delivered during
  // the gap land once the secret is provisioned instead of being lost.
  if (!options.secret) return text("Webhook not configured", 503);

  const raw = await request.text();

  let valid = false;
  try {
    valid = await options.verify({ raw, headers: request.headers, url, secret: options.secret });
  } catch {
    valid = false;
  }
  // 401 is terminal on purpose. A signature that doesn't check out will never
  // check out on retry, and asking the provider to keep trying turns a
  // misconfiguration into a self-inflicted flood.
  if (!valid) return text("Invalid signature", 401);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Also terminal — a body that isn't JSON now won't become JSON later.
    return text("Invalid JSON", 400);
  }

  const type = (options.eventType ?? defaultEventType)(payload);
  if (options.accept && !options.accept(type, payload)) {
    return text("Ignored", 202);
  }

  if (!options.queue) return text("Queue not configured", 503);

  try {
    await options.queue.send({ kind: "webhook", provider: options.provider, type, payload });
  } catch {
    // The signature was good, so this event is real and worth keeping. 503 asks
    // the provider to redeliver rather than dropping it.
    return text("Queue unavailable", 503);
  }

  // 202, not 200: the work hasn't happened yet, it's been accepted. That's the
  // entire point of enqueuing — the response returns before the consumer runs.
  return text("Accepted", 202);
}
