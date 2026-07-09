// Worker entrypoint (composeWorker). One Worker, many concerns, dispatched in
// order over the Astro SSR fallback:
//
//   docs.louisecms.com/*  → static Starlight bundle folded into /_docs (serveDocs)
//   /api/louise/*         → louisecms/editor routes (pages/save/settings/media/
//                           inquiries/seed), guarded by the cookie editor gate
//   /media/*              → uploaded R2 objects (self-hosted media, no public bucket)
//   /og.png?slug=&title=  → Browser-Run OG card, content-hash cached
//   else                  → Astro SSR (marketing + published CMS pages)
//   scheduled()           → daily link-checker across both hosts
import { handle } from "@astrojs/cloudflare/handler";
import {
  checkLinks,
  createPuppeteerRenderer,
  type LouiseBrowserEnv,
  type OgImageCache,
  ogCacheKey,
  ogImage,
} from "louisecms/browser";
import {
  DEFAULT_PAGE_FIELDS,
  inquiriesRoute,
  mediaRoute,
  pagesRoute,
  saveRoute,
  seedRoute,
  settingsRoute,
  versionsRoute,
} from "louisecms/editor";
import { assertValidSections } from "louisecms/cms";
import { composeWorker, type WorkerRoute } from "louisecms/worker";
import { resolveEditorFromCookie } from "./lib/louise/session.js";
import { pagesCollection } from "./pages-collection.js";
import { inquiries, media, pages, pagesVersions, siteSettings } from "./schema.js";
import { SECTIONS } from "./sections/catalog.js";

type WorkerEnv = CloudflareEnv & LouiseBrowserEnv;

const SITE_ORIGIN = "https://louisecms.com";
const DOCS_ORIGIN = "https://docs.louisecms.com";

/* ── OG image (louisecms/browser, #5) ─────────────────────────────────── */

/** The OG card markup screenshotted into a share image. Self-contained (inline
 *  styles, system fonts) so no network fetch is needed during rendering. */
function ogCardHtml(title: string): string {
  const safe = title.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    body{width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;
      padding:80px;background:#0f172a;color:#f8fafc;
      font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .brand{font-size:28px;font-weight:600;color:#56c6be;letter-spacing:.02em}
    h1{font-size:76px;font-weight:800;line-height:1.05;margin-top:24px;max-width:1000px}
    .u{margin-top:auto;font-size:24px;color:#94a3b8}
  </style></head><body>
    <div class="brand">louisecms</div><h1>${safe}</h1><div class="u">louisecms.com</div>
  </body></html>`;
}

/** OG-image byte store backed by the Workers Cache API — no extra binding, and
 *  the content-hashed key means a hit is always the right card. */
function ogCacheStore(): OgImageCache {
  const req = (key: string) => new Request(`https://og.cache/${key}`);
  return {
    async get(key) {
      const res = await caches.default.match(req(key));
      return res ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async put(key, bytes, contentType) {
      await caches.default.put(
        req(key),
        new Response(bytes, {
          headers: {
            "content-type": contentType ?? "image/png",
            "cache-control": "public, max-age=31536000, immutable",
          },
        }),
      );
    },
  };
}

async function handleOgImage(url: URL, env: WorkerEnv): Promise<Response> {
  const slug = url.searchParams.get("slug") ?? "/";
  const title = url.searchParams.get("title") ?? "The V8-native CMS for Cloudflare Workers";
  const cacheKey = await ogCacheKey(slug, title);
  const { bytes, cached } = await ogImage({
    cacheKey,
    html: ogCardHtml(title),
    render: createPuppeteerRenderer(env.BROWSER),
    cache: ogCacheStore(),
  });
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
      "x-og-cache": cached ? "hit" : "miss",
    },
  });
}

/* ── Static docs host ─────────────────────────────────────────────────── */

/**
 * Serve the static docs bundle (folded into this Worker's assets at /_docs by
 * scripts/ci-build.sh) at the docs subdomain root. The docs app is built as a
 * root site, so we uniformly prefix every docs-host path with /_docs before the
 * ASSETS binding. ASSETS emits its trailing-slash redirects with that
 * /_docs-prefixed Location, so strip the prefix back off — otherwise the browser
 * would be sent to `docs.host/_docs/…`, leaking the prefix and double-prefixing
 * the retry.
 */
async function serveDocs(url: URL, request: Request, env: WorkerEnv): Promise<Response> {
  const assetUrl = new URL(url);
  assetUrl.pathname = `/_docs${url.pathname}`;
  const res = await env.ASSETS.fetch(new Request(assetUrl, request));
  const location = res.headers.get("location");
  if (location?.startsWith("/_docs/")) {
    const headers = new Headers(res.headers);
    headers.set("location", location.slice("/_docs".length));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
}

/* ── Louise CMS editor routes ─────────────────────────────────────────── */

const resolveEditor = (request: Request, env: WorkerEnv) => resolveEditorFromCookie(request, env);

/** Base `site_settings` columns the drawer Settings panel may write. */
const SETTINGS_COLUMNS = [
  "siteName",
  "tagline",
  "logoUrl",
  "faviconUrl",
  "brandColor",
  "secondaryColor",
  "tertiaryColor",
  "contactEmail",
  "contactPhone",
  "contactAddress",
  "socialLinks",
  "navLinks",
  "metaDescription",
  "defaultOgImageUrl",
  "disableIndexing",
];

const editorRoutes: WorkerRoute<WorkerEnv>[] = [
  // Draft/publish + version history for pages: /api/louise/pages/:id/{versions,
  // publish,unpublish}. Saves stage drafts (live row untouched); publish promotes
  // a draft and sets published_version_id. Same sections validation on drafts.
  // MUST precede pagesRoute — pagesRoute's `/:id` matcher would otherwise claim
  // `/pages/:id/versions` and 400 on the non-integer id.
  versionsRoute({
    table: pages,
    versionsTable: pagesVersions,
    config: pagesCollection,
    resolveEditor,
    validate: async (data) => {
      if ("sections" in data) {
        await assertValidSections(SECTIONS, data.sections, { operation: "update" });
      }
    },
  }),
  // `sections` (structured page-builder blocks JSON) is editable alongside the
  // framework page fields, and validated against the catalog before write — a
  // malformed sections payload (unknown block type, wrong field shape) is
  // rejected with a 422 rather than persisted.
  pagesRoute({
    table: pages,
    resolveEditor,
    fields: [...DEFAULT_PAGE_FIELDS, "sections"],
    validate: async (data, ctx) => {
      if ("sections" in data) {
        await assertValidSections(SECTIONS, data.sections, { operation: ctx.operation });
      }
    },
  }),
  saveRoute({
    resolveEditor,
    collections: {
      pages: {
        table: pages,
        fields: ["title", "body", "seoTitle", "seoDescription"],
        richFields: ["body"],
      },
    },
  }),
  settingsRoute({ table: siteSettings, resolveEditor, columns: SETTINGS_COLUMNS }),
  mediaRoute({
    table: media,
    resolveEditor,
    referenceSources: [
      { collection: "pages", table: "pages", columns: ["body"], labelColumn: "title" },
    ],
  }),
  inquiriesRoute({ table: inquiries, resolveEditor }),
  seedRoute({ table: siteSettings, resolveEditor, defaults: { siteName: "Louise dogfood" } }),
];

/* ── Non-editor routes ────────────────────────────────────────────────── */

const docsRoute: WorkerRoute<WorkerEnv> = (request, env) => {
  const url = new URL(request.url);
  return url.hostname.startsWith("docs.") ? serveDocs(url, request, env) : undefined;
};

/** Stream uploaded media back from R2 (MEDIA_URL = "/media"). */
const mediaAssetRoute: WorkerRoute<WorkerEnv> = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/media/")) return undefined;
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!key) return undefined;
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
};

const ogRoute: WorkerRoute<WorkerEnv> = (request, env) => {
  const url = new URL(request.url);
  return url.pathname === "/og.png" ? handleOgImage(url, env) : undefined;
};

export default composeWorker<WorkerEnv>({
  // docs host first (never touches the CMS); then the editor API, media, OG;
  // everything else falls through to Astro SSR.
  routes: [docsRoute, ...editorRoutes, mediaAssetRoute, ogRoute],
  fetch: (request, env, ctx) => handle(request, env, ctx),
  // Cron Trigger (wrangler.jsonc): crawl both hosts and log any broken links.
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(
      (async () => {
        const broken = [
          ...(await checkLinks({ base: SITE_ORIGIN, paths: ["/"] })),
          ...(await checkLinks({ base: DOCS_ORIGIN, paths: ["/"] })),
        ];
        if (broken.length > 0)
          console.warn(`[link-check] ${broken.length} broken link(s):`, broken);
        else console.log("[link-check] all links OK");
      })(),
    );
  },
});
