// Worker entrypoint (composeWorker). One Worker, many concerns, dispatched in
// order over the Astro SSR fallback:
//
//   docs.louisetoolkit.com/*  → static Starlight bundle folded into /_docs (serveDocs)
//   /api/louise/*         → louise-toolkit/editor routes (pages/save/settings/media/
//                           inquiries/seed), guarded by the cookie editor gate
//   /media/*              → uploaded R2 objects (self-hosted media, no public bucket)
//   /og.png?slug=&title=  → resvg/WASM OG card, content-hash cached
//   else                  → Astro SSR (marketing + published content pages)
//   queue()               → drain deferred side-effects off the write path (FTS reindex)
//   scheduled()           → daily link-checker across both hosts
import { handle } from "@astrojs/cloudflare/handler";
import { vitalsRoute } from "louise-toolkit/analytics";
import { checkLinks, ogCacheKey, ogCardSvg, ogImage } from "louise-toolkit/browser";
import {
  DEFAULT_PAGE_FIELDS,
  aiRoute,
  formRoute,
  healthRoute,
  inquiriesRoute,
  mediaRoute,
  overviewRoute,
  pagesRoute,
  saveRoute,
  searchRoute,
  seedRoute,
  seoFixRoute,
  settingsRoute,
  versionsRoute,
} from "louise-toolkit/editor";
import { assertValidSections, reindexDoc } from "louise-toolkit/content";
import { db, inquiriesForm } from "louise-toolkit/db";
import { defineForm } from "louise-toolkit/forms";
import { enqueue, processBatch, type SideEffectJob } from "louise-toolkit/queues";
import { realtimeRoute } from "louise-toolkit/realtime";
import { composeWorker, type WorkerRoute } from "louise-toolkit/worker";
import { startWorkflow } from "louise-toolkit/workflows";
import { ogCacheStore } from "./lib/og/cache.js";
import { OG_FONT_FAMILY, ogRenderer } from "./lib/og/render.js";
import { getEditorGate } from "./lib/louise/gate.js";
import { readSiteHealth, runHealthScan } from "./lib/louise/health.js";
import { overviewContent, overviewHealth, overviewInbox } from "./lib/louise/overview.js";
import { resolveEditorFromCookie } from "./lib/louise/session.js";
import { pagesDraftDeps } from "./lib/louise/versioned-pages.js";
import { syncPageVector } from "./lib/louise/vectors.js";
import { pagesCollection } from "./pages-collection.js";
import { inquiries, media, pages, siteSettings } from "./schema.js";
import { SECTIONS } from "./sections/catalog.js";

type WorkerEnv = CloudflareEnv;

const DOCS_ORIGIN = "https://docs.louisetoolkit.com";

/* ── OG image (louise-toolkit/browser, #85) ────────────────────────────────── */

async function handleOgImage(url: URL): Promise<Response> {
  const slug = url.searchParams.get("slug") ?? "/";
  const title = url.searchParams.get("title") ?? "The V8-native toolkit for Cloudflare Workers";
  const cacheKey = await ogCacheKey(slug, title);
  const { bytes, cached } = await ogImage({
    cacheKey,
    markup: ogCardSvg(title, { fontFamily: OG_FONT_FAMILY }),
    render: ogRenderer,
    cache: ogCacheStore(),
  });
  // bytes: Uint8Array<ArrayBufferLike> — see the cast note in ogCacheStore.
  return new Response(bytes as BodyInit, {
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

/* ── Louise Toolkit editor routes ─────────────────────────────────────────── */

// Editor-gate config comes from astro:env (astro.config.mjs schema), not the
// binding env. Read per request via getEditorGate() — never captured at module
// scope — so the Worker's runtime env is resolved inside the request path.
const resolveEditor = (request: Request, _env: WorkerEnv) =>
  resolveEditorFromCookie(request, getEditorGate());

/** The site's media base — matches `vars.MEDIA_URL` in wrangler.jsonc. Every
 *  editor image (sections, settings, page body) is validated against this so
 *  only media-library assets are stored, never an external hotlink (#47). */
const MEDIA_BASE = "/media";

/** Setting keys that hold an image URL and must resolve to a media asset. */
const SETTINGS_IMAGE_KEYS = ["logoUrl", "faviconUrl", "defaultOgImageUrl"];

/** Base `site_settings` columns the Settings panel may write. */
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

// The public contact form: the built-in inquiries fields + Tier-3 silent spam
// heuristics (a `website` honeypot + a 2s minimum since render). Same `inquiries`
// table, so the Louise Settings Inquiries tab reviews it unchanged.
// #region example:inquiries-form  (sliced into /examples/forms — keep runnable)
const contactForm = defineForm({
  name: "inquiries",
  fields: inquiriesForm.fields,
  spam: { honeypot: "website", minSeconds: 2 },
});
// #endregion example:inquiries-form

const editorRoutes: WorkerRoute<WorkerEnv>[] = [
  // Owner Home dashboard (#108): one editor-only GET the drawer's Home landing
  // reads for its at-a-glance cards. Content + Inbox counts are live; the health
  // slice reads the summary the cron scan persists (#106) — undefined until the
  // first scan, so the card hides itself till then. A throwing resolver is
  // dropped, never 500s the dashboard.
  overviewRoute<WorkerEnv>({
    resolveEditor,
    content: overviewContent,
    inbox: overviewInbox,
    health: overviewHealth,
  }),
  // The Health card's drill-in (#106 Phase 2): the full persisted summary,
  // including the broken-link details the overview count doesn't carry.
  healthRoute<WorkerEnv>({ resolveEditor, read: readSiteHealth }),
  // Draft/publish + version history for pages: /api/louise/pages/:id/{versions,
  // publish,unpublish}. Saves stage drafts (live row untouched); publish promotes
  // a draft and sets published_version_id. Same sections validation on drafts.
  // MUST precede pagesRoute — pagesRoute's `/:id` matcher would otherwise claim
  // `/pages/:id/versions` and 400 on the non-integer id.
  versionsRoute({
    // Draft store deps (table/versions/config + sections validation + the #70 KV
    // buffer) are shared with the `saveDraft` Astro Action so the two save
    // entrypoints can't drift (#138).
    ...pagesDraftDeps,
    resolveEditor,
    // Post-publish work off the request path. Preferred: hand the published row
    // to the durable PublishWorkflow (#88) — reindex → warm the OG card → notify
    // webhook, each step retried independently and resumable mid-way (an
    // idempotency id coalesces a double-publish). Falls back to the fire-and-forget
    // reindex Queue (#77) when no Workflow is bound, then to inline sync when
    // neither is — so publish keeps working in every deployment.
    deferReindex: (env) => {
      const workflow = env.PUBLISH_WORKFLOW;
      if (workflow) {
        // DeferReindex resolves to void — start the instance and drop the handle.
        return async (id) => {
          await startWorkflow(workflow, { collection: "pages", id }, { id: `publish:pages:${id}` });
        };
      }
      const queue = env.QUEUE;
      return queue
        ? (id) => enqueue(queue, { kind: "reindex", collection: "pages", id })
        : undefined;
    },
  }),
  // Search over pages (title/body/flattened sections) — /search + a /reindex to
  // rebuild the FTS index. Before pagesRoute (its `/:id` matcher would else claim
  // the non-integer `search`/`reindex` segments). The optional `vector` layer
  // (#86) blends Vectorize kNN with the FTS keyword match via RRF; both bindings
  // are optional, so absent either the route is exactly FTS-only.
  searchRoute({
    table: pages,
    config: pagesCollection,
    resolveEditor,
    vector: {
      index: (env) => env.VECTORIZE,
      ai: (env) => env.AI,
    },
  }),
  // One-click AI SEO backfill (#106 Phase 2c): /pages/generate-seo fills the SEO
  // title/description of published pages missing them via Workers AI. Before
  // pagesRoute (its `/:id` matcher would else claim the non-integer segment).
  // Absent env.AI it answers 503, so the Health panel hides the assist.
  seoFixRoute({ table: pages, resolveEditor, ai: (env) => env.AI }),
  // Interactive editorial assists (#75/#166): the client posts here for the
  // toolbar "rewrite" action (/ai/rewrite) and the pages-panel SEO "suggest"
  // button (/ai/seo). The AI binding is server-only, so these must round-trip.
  // Absent env.AI it answers 503, so both client controls hide themselves.
  aiRoute({ resolveEditor, ai: (env) => env.AI }),
  // `sections` (structured builder blocks JSON) is editable alongside the
  // framework page fields, and validated against the catalog before write — a
  // malformed sections payload (unknown block type, wrong field shape) is
  // rejected with a 422 rather than persisted.
  pagesRoute({
    table: pages,
    resolveEditor,
    fields: [...DEFAULT_PAGE_FIELDS, "sections"],
    validate: async (data, ctx) => {
      if ("sections" in data) {
        await assertValidSections(SECTIONS, data.sections, {
          operation: ctx.operation,
          mediaBase: MEDIA_BASE,
        });
      }
    },
  }),
  // NOTE: the rich-text page `body` is NOT here — it stages drafts via
  // versionsRoute now (the versioned workflow), not a live `/save` write. The
  // sanitize that used to happen here lives on the collection's beforeChange
  // hook (pages-collection.ts) so it covers the draft/publish paths.
  saveRoute({
    resolveEditor,
    collections: {
      pages: {
        table: pages,
        fields: ["title", "seoTitle", "seoDescription"],
      },
    },
  }),
  settingsRoute({
    table: siteSettings,
    resolveEditor,
    columns: SETTINGS_COLUMNS,
    imageKeys: SETTINGS_IMAGE_KEYS,
    mediaBase: MEDIA_BASE,
  }),
  mediaRoute({
    table: media,
    resolveEditor,
    referenceSources: [
      { collection: "pages", table: "pages", columns: ["body"], labelColumn: "title" },
    ],
    // Workers AI alt text on upload (#75): fill each new image's `alt` from the
    // image. Best-effort — a model error/timeout never fails the upload (the alt
    // just stays empty, editable in the media panel). Off wherever `env.AI` is
    // unbound.
    altText: (env) => env.AI,
  }),
  // Public capture (contact form) + editor-gated review, both from the one
  // built-in `inquiries` form (louise-toolkit/forms) — #46. The site adds the
  // Tier-3 silent heuristics (honeypot + a 2s minimum) on top of the base fields.
  // #region example:inquiries-route  (sliced into /examples/forms)
  formRoute({ form: contactForm, rateLimitKv: (env) => env.RL }),
  inquiriesRoute({ table: inquiries, resolveEditor }),
  // Real-time multi-editor sessions (ADR 0002 / #71): a WebSocket upgrade at
  // /api/louise/realtime/:slug/:id, guarded then forwarded to the per-page
  // EditSessionDO. 503s when the binding is absent, so it's cleanly optional.
  realtimeRoute({ resolveEditor, namespace: (env) => env.EDIT_SESSION }),
  // #endregion example:inquiries-route
  seedRoute({ table: siteSettings, resolveEditor, defaults: { siteName: "Louise Toolkit" } }),
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
  // Serve with the stored (magic-byte-verified) content type and forbid MIME
  // sniffing — this route bypasses the Astro middleware that sets nosniff
  // elsewhere, so set it here as defense-in-depth against a polyglot upload.
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
};

const ogRoute: WorkerRoute<WorkerEnv> = (request) => {
  const url = new URL(request.url);
  return url.pathname === "/og.png" ? handleOgImage(url) : undefined;
};

// Public Core Web Vitals ingestion (#106): the visitor beacon (Vitals.astro)
// POSTs LCP/CLS/INP here; same-origin-guarded, writes to the ANALYTICS dataset.
// Unauthenticated by design (anonymous field data), so it sits outside editorRoutes.
const vitalsIngestRoute = vitalsRoute<WorkerEnv>({ dataset: (env) => env.ANALYTICS });

// The durable publish pipeline (#88). Re-exported from the Worker entry so
// wrangler's `[[workflows]]` `class_name` can find it.
export { PublishWorkflow } from "./workflows/publish.js";
// Per-page live editing session DO (#71) — the wrangler `durable_objects` binding
// names this class; it must be exported from the Worker entry.
export { EditSessionDO } from "./realtime/edit-session.js";

export default composeWorker<WorkerEnv>({
  // docs host first (never touches the content); then the editor API, media, OG;
  // everything else falls through to Astro SSR.
  routes: [docsRoute, ...editorRoutes, vitalsIngestRoute, mediaAssetRoute, ogRoute],
  fetch: (request, env, ctx) => handle(request, env, ctx),
  // Side-effect consumer (#77): drain the deferred reindex jobs enqueued on the
  // publish path. processBatch acks each message on success and retries on a
  // thrown error; Cloudflare Queues owns the backoff/DLQ (wrangler.jsonc).
  async queue(batch, env) {
    await processBatch(batch as MessageBatch<SideEffectJob>, async (job) => {
      if (job.kind === "reindex" && job.collection === "pages") {
        await reindexDoc(db(env.DB), pages, pagesCollection, job.id);
        // Embed-on-publish (#86): mirror the FTS sync into Vectorize on the same
        // deferred job. Best-effort — a missing binding / embed error is
        // swallowed, so it never fails (or retries) the FTS reindex above.
        await syncPageVector(env, job.id);
      }
    });
  },
  // Cron Trigger (wrangler.jsonc): crawl both hosts and log any broken links.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        // Site-health scan (#106): crawl for broken links + count alt/SEO gaps,
        // then persist the summary for the owner dashboard's Health card.
        const summary = await runHealthScan(env);
        console.log(
          `[health] ${summary.brokenLinks} broken link(s), ${summary.missingAlt} missing alt, ${summary.seoGaps} SEO gap(s)`,
        );
        // The docs host is a separate static bundle (not owner-editable content),
        // so its links are logged for us, not folded into the owner summary.
        const docsBroken = await checkLinks({ base: DOCS_ORIGIN, paths: ["/"] });
        if (docsBroken.length > 0)
          console.warn(`[link-check] docs: ${docsBroken.length} broken link(s):`, docsBroken);
      })(),
    );
  },
});
