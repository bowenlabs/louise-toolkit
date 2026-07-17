// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The publish Workflow (#88): the durable, multi-step pipeline that runs when a
// page is published. `versionsRoute`'s `deferReindex` starts it (worker.ts), so
// publish returns as soon as the live row is written and the derived work runs
// off the request path — each step retried independently and resumable mid-way.
//
// Steps: load the published row → reindex FTS → warm the OG share card in the
// Cache API → notify an optional webhook. Reindex moves off the fire-and-forget
// Queue (#77) into a durable step here; the OG warm makes the first social share
// fast instead of paying a cold render.

import { eq } from "drizzle-orm";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { ogCacheKey, ogCardSvg, ogImage } from "louise-toolkit/browser";
import { reindexDoc } from "louise-toolkit/content";
import { db } from "louise-toolkit/db";
import { defineWorkflow } from "louise-toolkit/workflows";
import { invalidatePageCache } from "../lib/louise/cache.js";
import { ogCacheStore } from "../lib/og/cache.js";
import { OG_FONT_FAMILY, ogRenderer } from "../lib/og/render.js";
import { syncPageVector } from "../lib/louise/vectors.js";
import { pagesCollection } from "../pages-collection.js";
import { pages } from "../schema.js";

/** What starts a publish run: which collection row went live. */
export interface PublishParams {
  collection: string;
  id: number;
}

interface PublishState {
  slug?: string;
  title?: string;
  reindexed?: boolean;
  embedded?: boolean;
  cachePurged?: boolean;
  ogWarmed?: boolean;
  notified?: boolean;
}

const runPublish = defineWorkflow<CloudflareEnv, PublishParams, PublishState>([
  // Read the freshly-published row once so later steps have its slug/title.
  {
    name: "load",
    run: async ({ env, payload }) => {
      const [row] = await db(env.DB)
        .select({ slug: pages.slug, title: pages.title, seoTitle: pages.seoTitle })
        .from(pages)
        .where(eq(pages.id, payload.id))
        .limit(1);
      return { slug: row?.slug, title: row?.seoTitle || row?.title || "" };
    },
  },
  // FTS reindex — durable + retried (was the fire-and-forget Queue job in #77).
  {
    name: "reindex",
    config: { retries: { limit: 5, delay: "10 seconds" } },
    run: async ({ env, payload }) => {
      await reindexDoc(db(env.DB), pages, pagesCollection, payload.id);
      return { reindexed: true };
    },
  },
  // Semantic index (#86): embed the published row into Vectorize alongside the
  // FTS reindex. syncPageVector is best-effort (no VECTORIZE/AI binding or any
  // embed error → no-op), so the step never fails the pipeline; it's a durable
  // step for its own retry budget + observability.
  {
    name: "embed",
    config: { retries: { limit: 3, delay: "10 seconds" } },
    run: async ({ env, payload }) => {
      await syncPageVector(env, payload.id);
      return { embedded: true };
    },
  },
  // Purge the just-published page's edge cache (#95) so the new render is live
  // immediately instead of waiting out its `maxAge`. Best-effort inside
  // invalidatePageCache (no-ops without the Workers cache API), so the step never
  // fails the pipeline; the short `maxAge` is the freshness floor if it doesn't
  // land. The purge is a global cache op keyed by the page tag, so it needs only
  // the id, not `env`.
  {
    name: "invalidate-cache",
    run: async ({ payload }) => {
      await invalidatePageCache(payload.id);
      return { cachePurged: true };
    },
  },
  // Pre-warm the OG share card into the Cache API so the first social share is a
  // hit, not a cold render. Same store + renderer the on-demand `/og.png` uses.
  {
    name: "warm-og",
    run: async ({ state }) => {
      if (!state.slug) return { ogWarmed: false };
      await ogImage({
        cacheKey: await ogCacheKey(state.slug, state.title ?? ""),
        markup: ogCardSvg(state.title ?? "", { fontFamily: OG_FONT_FAMILY }),
        render: ogRenderer,
        cache: ogCacheStore(),
      });
      return { ogWarmed: true };
    },
  },
  // Optional outbound notification (rebuild hooks, analytics, …). No-op unless a
  // site configures PUBLISH_WEBHOOK.
  {
    name: "webhook",
    run: async ({ env, payload, state }) => {
      if (!env.PUBLISH_WEBHOOK) return { notified: false };
      await fetch(env.PUBLISH_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "page.published", ...payload, slug: state.slug }),
      });
      return { notified: true };
    },
  },
]);

export class PublishWorkflow extends WorkflowEntrypoint<CloudflareEnv, PublishParams> {
  run(event: Readonly<WorkflowEvent<PublishParams>>, step: WorkflowStep) {
    return runPublish(this.env, event, step);
  }
}
