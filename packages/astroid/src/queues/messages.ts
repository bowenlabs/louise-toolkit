// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// What flows through the project's queue, and when it matters.

import type { AstroidConfig } from "../config.js";

/**
 * Whether this project runs a queue consumer + cron.
 *
 * On by default whenever commerce is configured: a commerce provider means
 * webhooks, and a webhook processed inline is a webhook you drop the moment the
 * provider's delivery timeout is shorter than your catalog sync.
 */
export function astroidUsesQueues(config: AstroidConfig): boolean {
  return config.queues?.enabled ?? Boolean(config.commerce);
}

/** Hourly. Frequent enough that stale data has a bounded lifetime, rare enough
 *  to be free. */
export const ASTROID_DEFAULT_CRON = "0 * * * *";

/** The cron expression for the safety-net re-sync, or null when disabled. */
export function astroidCron(config: AstroidConfig): string | null {
  if (!astroidUsesQueues(config)) return null;
  const cron = config.queues?.cron;
  if (cron === false) return null;
  return cron ?? ASTROID_DEFAULT_CRON;
}

/** Binding name for the project's queue producer. */
export const ASTROID_QUEUE_BINDING = "COMMERCE_QUEUE";

/** Queue names derived from the project key — the main queue and its DLQ. */
export function astroidQueueNames(config: AstroidConfig): { queue: string; dlq: string } {
  return { queue: `${config.key}-commerce`, dlq: `${config.key}-commerce-dlq` };
}

/**
 * A provider webhook, thinned to what a consumer needs. The raw `payload` is
 * carried through deliberately: the consumer's needs change faster than the
 * webhook contract, and a message that only kept the fields today's consumer
 * reads can't be replayed from the DLQ once that changes.
 */
export interface WebhookMessage {
  kind: "webhook";
  /** Which integration sent it — `"square"`, `"stripe"`, `"fourthwall"`. */
  provider: string;
  /** The provider's event type, e.g. `"catalog.version.updated"`. */
  type: string;
  payload: unknown;
}

/** The periodic (or manually triggered) full re-sync. */
export interface CatalogRefreshMessage {
  kind: "catalog_refresh";
}

/** Everything the project's queue carries. Match on `kind`. */
export type AstroidQueueMessage = WebhookMessage | CatalogRefreshMessage;

/**
 * Event-type prefixes that invalidate a cached catalog, per provider.
 *
 * Prefix matching rather than an exhaustive list on purpose: providers add event
 * types, and the failure mode of matching one too many is a redundant refresh,
 * while missing one is a storefront serving a price that no longer exists.
 */
const CATALOG_EVENT_PREFIXES: Record<string, string[]> = {
  square: ["catalog.", "inventory.", "item.", "item_variation."],
  stripe: ["product.", "price.", "plan."],
  fourthwall: ["product.", "variant.", "collection."],
};

/** Whether a provider event should trigger a catalog re-sync. */
export function affectsCatalog(provider: string, type: string): boolean {
  const prefixes = CATALOG_EVENT_PREFIXES[provider] ?? [];
  return prefixes.some((prefix) => type.startsWith(prefix));
}
