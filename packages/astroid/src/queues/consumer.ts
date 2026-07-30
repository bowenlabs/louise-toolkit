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
   * Receives the message that triggered it, so a site running more than one
   * commerce provider can branch on `message.provider` rather than refreshing
   * everything for everything. A zero-argument seam stays valid — the parameter
   * is there to be ignored until it's needed.
   *
   * Throwing marks the message for retry, which is usually right: a failed
   * refresh means the site is serving stale data.
   */
  refreshCatalog?: (message: AstroidQueueMessage) => void | Promise<void>;
  /**
   * Which provider owns the catalog `refreshCatalog` re-syncs. Set it and only
   * that provider's webhooks trigger a refresh; leave it unset and any
   * catalog-affecting webhook does, which is correct for the single-provider
   * case and is what every existing consumer gets.
   *
   * This exists because two providers is now a supported configuration, and the
   * seam is provider-blind by construction: a site can run Fourthwall as its
   * storefront and Square as its POS, at which point `refreshCatalog` means
   * "re-pull Fourthwall" while Square emits `inventory.count.updated` on every
   * single sale. Unscoped, a good Saturday becomes a sync storm against an
   * unrelated provider's rate limit — and the periodic refresh is unaffected, so
   * the site looks fine until the day it's busy.
   */
  catalogProvider?: string;
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
  const owns = (provider: string) =>
    options.catalogProvider === undefined || provider === options.catalogProvider;
  return async (message: AstroidQueueMessage): Promise<void> => {
    if (message.kind === "catalog_refresh") {
      await options.refreshCatalog?.(message);
    } else if (
      message.kind === "webhook" &&
      owns(message.provider) &&
      affectsCatalog(message.provider, message.type)
    ) {
      await options.refreshCatalog?.(message);
    }
    await options.onMessage?.(message);
  };
}
