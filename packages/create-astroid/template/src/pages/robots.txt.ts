// robots.txt — origin-aware, with the disallow list derived from your Astroid
// config (the editor + its API always; portal and checkout routes when those
// modules are on). Scaffolded once and yours to edit: add a Disallow here when
// you add a route crawlers shouldn't reach.
import type { APIRoute } from "astro";
import { astroidRobotsTxt } from "astroidjs";
import { env } from "cloudflare:workers";
import astroidConfig from "../../astroid.config.js";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  // The origin actually serving this request — never a configured domain. A
  // preview deploy that advertises the production host invites its content to
  // be indexed under the real domain.
  const origin = new URL(context.request.url).origin;

  // The same site-wide switch that noindexes pages also stops the crawl, rather
  // than relying on crawlers fetching every page to find the meta tag.
  let disableIndexing = false;
  try {
    const row = await env.DB.prepare("SELECT disable_indexing FROM site_settings WHERE id = 1").first<{
      disable_indexing: number;
    }>();
    disableIndexing = Boolean(row?.disable_indexing);
  } catch {
    // No DB binding yet (pre-provision) — fall through to the crawlable default.
  }

  return new Response(astroidRobotsTxt(astroidConfig, { origin, disableIndexing }), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
