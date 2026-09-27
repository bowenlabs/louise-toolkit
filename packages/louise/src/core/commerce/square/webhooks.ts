// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: webhooks, their signature and event envelope.

import { s } from "../../schema/index.js";
import { hmacSha256Base64, safeEqual } from "../index.js";

/**
 * Verify a Square webhook signature. Square signs the concatenation of the
 * exact notification URL you configured and the raw request body with
 * HMAC-SHA256, base64-encoded, delivered in the `x-square-hmacsha256-signature`
 * header (this reproduces the SDK's WebhooksHelper.verifySignature). `body`
 * must be the raw request text.
 */
export async function verifySquareSignature(
  notificationUrl: string,
  body: string,
  signatureHeader: string | null,
  signatureKey: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await hmacSha256Base64(signatureKey, notificationUrl + body);
  return safeEqual(expected, signatureHeader.trim());
}

/**
 * A Square webhook event, validated to the envelope this integration reads.
 * Run it via {@link import("./index.js").parseWebhookEvent} AFTER
 * {@link verifySquareSignature}. Square nests the changed resource under
 * `data.object`, keyed by `data.type` (for example, `payment`, `invoice`, `order`) with
 * `data.id` the resource id—the handler switches on the top-level `type` and
 * reads/re-fetches from there. The object stays an untyped record (its shape
 * depends on `data.type`); extra envelope keys (merchant_id, created_at, …) are
 * dropped.
 */
export const squareWebhookEventSchema = s.object({
  type: s.string(),
  event_id: s.optional(s.string()),
  data: s.object({
    type: s.optional(s.string()),
    id: s.optional(s.string()),
    object: s.optional(s.record()),
  }),
});
