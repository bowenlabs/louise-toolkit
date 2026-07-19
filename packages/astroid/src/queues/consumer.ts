// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The consumer side.
//
// `processBatch` (louise-toolkit/queues) already owns per-message ack/retry, and
// Cloudflare Queues owns redelivery and DLQ routing. What every site then wrote
// on top was the same dispatch: a periodic refresh runs the re-sync, a webhook
// runs it only if the event actually touched the catalog, and everything else
// acks as a no-op.
//
// That last part matters more than it looks. Order, payment, and subscription
// events are read live from the provider, so there is nothing local to update —
// but they still arrive, in volume. A consumer that treats every event as
// actionable turns a busy sales day into a catalog-refresh storm.

import { affectsCatalog, type AstroidQueueMessage } from "./messages.js";

export interface QueueHandlerOptions {
  /**
   * Re-sync whatever the provider owns — the catalog mirror, a cache. Called
   * for a periodic refresh and for webhooks that touched the catalog.
   *
   * Throwing marks the message for retry, which is usually right: a failed
   * refresh means the site is serving stale data.
   */
  refreshCatalog?: () => void | Promise<void>;
  /**
   * Anything else this project queues. Runs for every message, after the
   * catalog dispatch above, so a project can add its own kinds without
   * reimplementing the refresh logic.
   */
  onMessage?: (message: AstroidQueueMessage) => void | Promise<void>;
}

/**
 * Build the per-message handler to hand to `processBatch`.
 *
 * ```ts
 * async queue(batch, env) {
 *   await processBatch(batch, astroidQueueHandler({
 *     refreshCatalog: () => refreshCatalog(env),
 *   }));
 * }
 * ```
 */
export function astroidQueueHandler(options: QueueHandlerOptions = {}) {
  return async (message: AstroidQueueMessage): Promise<void> => {
    if (message.kind === "catalog_refresh") {
      await options.refreshCatalog?.();
    } else if (message.kind === "webhook" && affectsCatalog(message.provider, message.type)) {
      await options.refreshCatalog?.();
    }
    await options.onMessage?.(message);
  };
}
