// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the owner dashboard's overview route (#108).
//
//   GET /api/louise/overview   (editor-only)
//   → { content?, inbox?, health? }
//
// One cheap aggregate the Home dashboard reads in a single round-trip; each card
// selects its slice. The route is config-driven — the site supplies a resolver
// per slice (it owns the exact COUNTs against its own tables) — so the toolkit
// makes no assumption about column names. A slice with no resolver is simply
// omitted; a resolver that throws is treated as absent (never 500s the whole
// dashboard), so a card degrades to "nothing to show" rather than an error. Mount
// it before pagesRoute like searchRoute/versionsRoute.

import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

/** Content status — drafts + pages with unpublished changes (both drive the
 *  ContentStatus card's "needs attention" count). */
export interface OverviewContent {
  drafts: number;
  unpublished: number;
  /** ISO timestamp of the most recent edit, if the site tracks one. */
  lastEditedAt?: string;
}

/** Inbox status — unread contact-form submissions. */
export interface OverviewInbox {
  unread: number;
}

/** Site-health status — the persisted link-check / SEO summary (#106). */
export interface OverviewHealth {
  brokenLinks: number;
  missingAlt: number;
  seoGaps: number;
  /** ISO timestamp of the last health check, if available. */
  checkedAt?: string;
}

/** The overview payload — every slice optional so a card degrades to "absent"
 *  rather than erroring when its data source isn't wired. */
export interface OverviewData {
  content?: OverviewContent;
  inbox?: OverviewInbox;
  health?: OverviewHealth;
}

/** Resolve one overview slice from the runtime env. Return `undefined` (or throw)
 *  to omit the slice — the matching card then hides itself. */
type SliceResolver<Env, T> = (env: Env) => T | undefined | Promise<T | undefined>;

export interface OverviewRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Resolve the editor session (the overview is editor-only). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path. Default `/api/louise/overview`. */
  path?: string;
  /** Content counts (drafts / unpublished). Omit → no content card. */
  content?: SliceResolver<Env, OverviewContent>;
  /** Unread inbox count. Omit → no inbox card. */
  inbox?: SliceResolver<Env, OverviewInbox>;
  /** Persisted health summary (#106). Omit → no health card. */
  health?: SliceResolver<Env, OverviewHealth>;
}

/** Run a slice resolver, collapsing an absent resolver or any thrown error to
 *  `undefined` so one broken slice can't take down the whole dashboard. */
async function settle<Env, T>(
  resolver: SliceResolver<Env, T> | undefined,
  env: Env,
): Promise<T | undefined> {
  if (!resolver) return undefined;
  try {
    return (await resolver(env)) ?? undefined;
  } catch (err) {
    console.error("[louise] overview slice failed", err);
    return undefined;
  }
}

/**
 * Build the overview route. Returns `undefined` for a non-matching path so
 * `composeWorker` falls through. Only GET is served; the resolvers run in
 * parallel and absent slices are omitted from the response.
 */
export function overviewRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: OverviewRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/overview";

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const g = await guardEditor(request, env, config.resolveEditor, false);
    if ("response" in g) return g.response;

    const [content, inbox, health] = await Promise.all([
      settle(config.content, env),
      settle(config.inbox, env),
      settle(config.health, env),
    ]);

    // Omit absent slices entirely (the card checks presence, not zero-vs-missing).
    const data: OverviewData = {};
    if (content) data.content = content;
    if (inbox) data.inbox = inbox;
    if (health) data.health = health;
    return json(data);
  };
}
