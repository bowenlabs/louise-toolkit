// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the public sitemap route (#583):
//   GET|HEAD /sitemap.xml   the published, indexable pages, read per request
//   GET|HEAD /robots.txt    every crawler allowed, pointing at the sitemap
//
// A publish doesn't rebuild the site, so a sitemap built from a build-time
// snapshot lists yesterday's pages. This one reads the pages table on each
// request, the way the pages render, and leaves out drafts, `noindex` rows, and
// the slugs the site names. The origin, the home slug, the excluded slugs, and
// the extra paths are the site's parameters.

import { asc, eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import { reportFallback } from "../degraded.js";
import { robotsTxt, type SitemapEntry, sitemapXml } from "../seo/sitemap.js";
import { publicRoute } from "../worker/gate.js";
import type { WorkerRoute } from "../worker/index.js";
import type { EditorRouteEnv } from "./shared.js";

/** How long a crawler or the edge may reuse either file. */
export const SITEMAP_MAX_AGE_SECONDS = 60;

export interface SitemapRouteConfig<Env> {
  /**
   * The pages table: `slug`, and `status`, `noindex`, and `updatedAt` when it
   * has them. A table without `status` lists every row; one without
   * `updatedAt` lists no `<lastmod>`.
   */
  table: SQLiteTable;
  /**
   * The site's public origin, `https://example.com`. A function gets the
   * request and `env`, for a site whose origin varies by environment. Never
   * taken from the request's own host, which a preview deploy doesn't share.
   */
  origin: string | ((request: Request, env: Env) => string);
  /** The slug a site serves at `/`. It's listed as the origin's root. */
  homeSlug?: string;
  /** A page's path from its slug. Default `/<slug>`, and `/` for `homeSlug`. */
  pathFor?: (slug: string) => string;
  /** Slugs to leave out: rows that only back a section and have no page of their own. */
  exclude?: readonly string[];
  /** Paths served by files rather than rows, such as `/examples`, listed after the pages. */
  extra?: readonly string[];
  /**
   * The `site_settings` table. When its `disableIndexing` is on, the sitemap
   * lists nothing. `robots.txt` doesn't change: a crawler must still fetch the
   * pages to see their `noindex`.
   */
  settingsTable?: SQLiteTable;
  /** Paths `robots.txt` asks crawlers not to fetch, such as `/api/`. Default none. */
  disallow?: readonly string[];
  /** Cache lifetime, in seconds. Default {@link SITEMAP_MAX_AGE_SECONDS}. */
  maxAgeSeconds?: number;
  /** Where to serve the sitemap. Default `/sitemap.xml`. */
  sitemapPath?: string;
  /** Where to serve robots.txt. Default `/robots.txt`. */
  robotsPath?: string;
}

type Columns = Record<string, SQLiteColumn | undefined>;

/**
 * Build the sitemap route. It answers `GET` and `HEAD` on the two paths, and
 * returns `undefined` for every other request. It's a {@link publicRoute}.
 *
 * ```ts
 * sitemapRoute({
 *   table: pages,
 *   settingsTable: siteSettings,
 *   origin: "https://example.com",
 *   homeSlug: "home",
 *   exclude: ["footer"],
 *   extra: ["/examples"],
 *   disallow: ["/api/"],
 * });
 * ```
 */
export function sitemapRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: SitemapRouteConfig<Env>,
): WorkerRoute<Env> {
  const sitemapPath = config.sitemapPath ?? "/sitemap.xml";
  const robotsPath = config.robotsPath ?? "/robots.txt";
  const maxAge = config.maxAgeSeconds ?? SITEMAP_MAX_AGE_SECONDS;
  const exclude = new Set(config.exclude ?? []);
  const columns = config.table as unknown as Columns;
  const settingsColumns = config.settingsTable as unknown as Columns | undefined;
  const pathFor =
    config.pathFor ??
    ((slug: string) => (slug === config.homeSlug ? "/" : `/${encodeURIComponent(slug)}`));

  const originOf = (request: Request, env: Env): string =>
    (typeof config.origin === "function" ? config.origin(request, env) : config.origin).replace(
      /\/+$/,
      "",
    );

  async function indexingDisabled(env: Env): Promise<boolean> {
    const flag = settingsColumns?.disableIndexing;
    if (!config.settingsTable || !flag) return false;
    const [row] = await db(env.DB).select({ off: flag }).from(config.settingsTable).limit(1);
    return Boolean((row as { off?: unknown } | undefined)?.off);
  }

  async function entries(request: Request, env: Env): Promise<SitemapEntry[]> {
    const origin = originOf(request, env);
    if (await indexingDisabled(env)) return [];
    const slug = columns.slug as SQLiteColumn;
    const select: Record<string, SQLiteColumn> = { slug };
    if (columns.noindex) select.noindex = columns.noindex;
    if (columns.updatedAt) select.updatedAt = columns.updatedAt;
    const query = db(env.DB).select(select).from(config.table);
    const rows = (await (columns.status
      ? query.where(eq(columns.status, "published")).orderBy(asc(slug))
      : query.orderBy(asc(slug)))) as {
      slug: string;
      noindex?: unknown;
      updatedAt?: Date | string | null;
    }[];
    const pages = rows
      .filter((row) => !row.noindex && !exclude.has(row.slug))
      .map((row) => ({ loc: `${origin}${pathFor(row.slug)}`, lastmod: row.updatedAt }));
    // The home page first: it's the one a crawler should start from.
    pages.sort((a, b) => Number(b.loc === `${origin}/`) - Number(a.loc === `${origin}/`));
    return [...pages, ...(config.extra ?? []).map((path) => ({ loc: `${origin}${path}` }))];
  }

  const respond = (request: Request, body: string, type: string): Response => {
    const headers = {
      "content-type": type,
      "cache-control": `public, max-age=${maxAge}`,
    };
    return new Response(request.method === "HEAD" ? null : body, { headers });
  };

  return publicRoute(async (request, env) => {
    const { pathname } = new URL(request.url);
    if (pathname !== sitemapPath && pathname !== robotsPath) return undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    if (pathname === robotsPath) {
      const body = robotsTxt({
        sitemapUrl: `${originOf(request, env)}${sitemapPath}`,
        disallow: config.disallow,
      });
      return respond(request, body, "text/plain; charset=utf-8");
    }
    try {
      return respond(request, sitemapXml(await entries(request, env)), "application/xml");
    } catch (err) {
      // A sitemap that fails shouldn't look like an empty site to a crawler.
      reportFallback("seo.sitemap", err);
      return new Response("Sitemap unavailable", {
        status: 503,
        headers: { "retry-after": "60", "cache-control": "no-store" },
      });
    }
  });
}
