// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// generateAstroidWorker / generateAstroidMiddleware — emit the Cloudflare Worker
// entrypoint and the Astro middleware a Louise site would otherwise hand-write.
// The worker's editor routes are composed in the fixed order from the route plan
// (routes.ts), so the "versionsRoute/searchRoute before pagesRoute" collision is
// impossible by construction. Pure string generation, like generateAstroidSchema.
//
// Two seams are marked with TODO(astroid) and filled by later slices: the auth
// `resolveEditor`, and the section-catalog `validate` on the pages routes.

import type { AstroidConfig } from "../config.js";
import {
  ASTROID_VITALS_BINDING,
  generateAstroidCwvQuery,
} from "../analytics/index.js";
import { astroidPortal } from "../portal/config.js";
import { ASTROID_HEALTH_CRON, astroidCron, astroidUsesQueues } from "../queues/messages.js";
import {
  ASTROID_EDIT_SESSION_CLASS,
  ASTROID_REALTIME_BINDING,
  usesRealtime,
} from "../realtime/scaffold.js";
import { capturesInquiries } from "../schema/framework.js";
import { type AstroidEditorRouteName, astroidEditorRoutePlan } from "./routes.js";

// Astroid's default editable site_settings surface — the columns the Settings
// panel may write, and which of them hold a media-library image URL.
//
// EXPORTED because the generated worker is not the only consumer: the scaffolded
// Astro Actions surface needs the identical allowlist, and a second literal in an
// editable file is a list that drifts from the one the routes enforce. Both read
// this.
export const ASTROID_SETTINGS_COLUMNS = [
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
export const ASTROID_SETTINGS_IMAGE_KEYS = ["logoUrl", "faviconUrl", "defaultOgImageUrl"];

/**
 * Generate the Worker entrypoint (`worker.ts`) from an Astroid config: the editor
 * routes in collision-free order, an R2 media-asset route, and the `composeWorker`
 * default export over Astro's SSR handler. Inquiry routes + the contact form are
 * emitted only when a brand captures inquiries.
 */
export function generateAstroidWorker(config: AstroidConfig): string {
  const inquiries = capturesInquiries(config);
  const queues = astroidUsesQueues(config);
  const cron = astroidCron(config);
  const mediaBase = config.deploy?.mediaBase ?? "/media";
  const seedName = config.theme.name;
  const plan = astroidEditorRoutePlan(config);

  // `realtimeRoute` lives in `louise-toolkit/realtime`, not `/editor` — it is the
  // one factory in the plan that isn't an editor route. Importing it with the
  // rest type-checks fine HERE (the plan is just strings) and fails only in the
  // scaffold, which is exactly how it got caught.
  // Same trap as realtimeRoute: these live outside `louise-toolkit/editor`.
  const realtimeRouteFactories = new Set(["realtimeRoute", "vitalsRoute"]);
  const editorImports = [
    "DEFAULT_PAGE_FIELDS",
    ...new Set(plan.map((route) => route.factory).filter((f) => !realtimeRouteFactories.has(f))),
  ].sort();
  const tables = [
    "media",
    "pages",
    "pagesVersions",
    "siteSettings",
    ...(inquiries ? ["inquiries"] : []),
  ].sort();

  const routeCall = (name: AstroidEditorRouteName): string => {
    switch (name) {
      case "overview":
        // `inbox` only when this project captures inquiries — an absent slice
        // hides its card, which is right for an archetype with no contact form.
        return inquiries
          ? "overviewRoute({ resolveEditor, content: overviewContent, inbox: overviewInbox, health: overviewHealth })"
          : "overviewRoute({ resolveEditor, content: overviewContent, health: overviewHealth })";
      case "vitals":
        return `vitalsRoute({ dataset: (env) => env.${ASTROID_VITALS_BINDING} })`;
      case "health":
        return "healthRoute({ resolveEditor, read: readSiteHealth })";
      case "realtime":
        return `realtimeRoute({ resolveEditor, namespace: (env) => env.${ASTROID_REALTIME_BINDING} })`;
      case "versions":
        return "versionsRoute({ table: pages, versionsTable: pagesVersions, config: pagesCollection, resolveEditor, bufferKv: (env) => env.DRAFTS })";
      case "search":
        return "searchRoute({ table: pages, config: pagesCollection, resolveEditor })";
      case "pages":
        return 'pagesRoute({ table: pages, resolveEditor, fields: [...DEFAULT_PAGE_FIELDS, "sections"] })';
      case "save":
        // No `bufferKv` here, deliberately: `saveRoute` has no such option. It
        // writes live field saves (title, SEO) straight through, and the draft
        // buffer belongs to the versioned body — i.e. to versionsRoute.
        return 'saveRoute({ resolveEditor, collections: { pages: { table: pages, fields: ["title", "seoTitle", "seoDescription"] } } })';
      case "settings":
        return "settingsRoute({ table: siteSettings, resolveEditor, columns: SETTINGS_COLUMNS, imageKeys: SETTINGS_IMAGE_KEYS, mediaBase: MEDIA_BASE })";
      case "ai":
        return "aiRoute({ resolveEditor, ai: (env) => env.AI })";
      case "seoFix":
        return "seoFixRoute({ table: pages, resolveEditor, ai: (env) => env.AI })";
      case "media":
        // `altText` fills a new upload's alt from the image itself. Best-effort
        // by contract — a model error or a missing binding never fails the
        // upload — so it costs nothing on a project that doesn't want it.
        return "mediaRoute({ table: media, resolveEditor, referenceSources: MEDIA_REFERENCE_SOURCES, altText: (env) => env.AI })";
      case "editors":
        // Better Auth owns the `user` table (a NAME, not a Drizzle table), so this
        // route takes the default `"user"`; a `tablePrefix` would rename it.
        return 'editorsRoute({ table: "user", resolveEditor })';
      case "form":
        // `onSubmit` fires AFTER the insert and off the response path, so the
        // notify + confirm pair is store-and-forward by construction: the
        // submission is already durable and mail can fail without the visitor
        // ever knowing. Unprovisioned mail logs instead of sending.
        // The `await` + block body is load-bearing: `onSubmit` returns
        // `void | Promise<void>`, and sendInquiryMail resolves to delivery
        // results nobody here reads.
        return "formRoute({ form: contactForm, rateLimitKv: (env) => env.RL, onSubmit: async (values, env) => { await sendInquiryMail(astroidConfig, env, values); } })";
      case "inquiries":
        return "inquiriesRoute({ table: inquiries, resolveEditor })";
      case "seed":
        return `seedRoute({ table: siteSettings, resolveEditor, defaults: { siteName: ${JSON.stringify(seedName)} } })`;
    }
  };

  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p("// Generated by astroidjs — do not hand-edit.");
  p("// Source: your defineAstroid config. The editor route ORDER is fixed by");
  p("// Astroid to avoid matcher collisions — see each route's note below.");
  p('import { handle } from "@astrojs/cloudflare/handler";');
  p("import {");
  for (const name of editorImports) p(`  ${name},`);
  p('} from "louise-toolkit/editor";');
  if (usesRealtime(config)) p('import { realtimeRoute } from "louise-toolkit/realtime";');
  p(
    'import { cwvSqlQuery, parseCwvRows, summarizeCwv, vitalsRoute } from "louise-toolkit/analytics";',
  );
  if (inquiries) p('import { defineForm } from "louise-toolkit/forms";');
  if (queues) p('import { processBatch } from "louise-toolkit/queues";');
  p('import { checkLinks } from "louise-toolkit/browser";');
  p(
    'import { readHealthSummary, summarizeHealth, writeHealthSummary } from "louise-toolkit/health";',
  );
  p(
    'import { composeWorker, isEditRequest, type WorkerRoute, withEdgeCache } from "louise-toolkit/worker";',
  );
  if (inquiries) p('import { inquiriesForm } from "louise-toolkit/db";');
  p(`import { ${tables.join(", ")} } from "./schema.js";`);
  const astroidImports = [
    "astroidPagesCollection",
    "readModuleSecret",
    ...(inquiries ? ["sendInquiryMail"] : []),
    ...(queues ? ["type AstroidQueueMessage"] : []),
  ].sort();
  p(`import { ${astroidImports.join(", ")} } from "astroidjs";`);
  // The config lives at the PROJECT ROOT (create-astroid writes it there); this
  // file is src/worker.ts, so the specifier is `../`, not `./`.
  p('import astroidConfig from "../astroid.config.js";');
  p("// TODO(astroid): your AUTH seam. resolveEditor resolves the editor session");
  p("// from a request; a truthy result authorizes editor writes. A generated auth");
  p("// module is a later slice.");
  p('import { resolveEditor } from "./auth.js";');
  if (queues) {
    p("// Your QUEUE seam: what each message actually does. Scaffolded once and");
    p("// yours to edit — `astroidQueueHandler` there covers the catalog dispatch.");
    p('import { handleQueueMessage } from "./queue.js";');
  }
  p();
  p(`const MEDIA_BASE = ${JSON.stringify(mediaBase)};`);
  p("const pagesCollection = astroidPagesCollection(astroidConfig);");
  p();
  p("// Editable site_settings columns the Settings panel may write, and which of");
  p("// them resolve to a media-library asset.");
  p(`const SETTINGS_COLUMNS = ${JSON.stringify(ASTROID_SETTINGS_COLUMNS)};`);
  p(`const SETTINGS_IMAGE_KEYS = ${JSON.stringify(ASTROID_SETTINGS_IMAGE_KEYS)};`);
  p();
  p("// Delete-safety for the media library: where a media key can be REFERENCED,");
  p("// so deleting an asset that's live on a page warns instead of silently");
  p("// breaking it. Without these the scan has nothing to look at and every");
  p("// delete reports 'no references'. Column names are SQL, not Drizzle keys —");
  p("// the scan is raw SQL over the table.");
  p("const MEDIA_REFERENCE_SOURCES = [");
  p(
    '  { collection: "pages", table: "pages", columns: ["body", "sections", "og_image"], labelColumn: "title" },',
  );
  p(
    '  { collection: "settings", table: "site_settings", columns: ["logo_url", "favicon_url", "default_og_image_url"], labelColumn: "site_name" },',
  );
  p("];");
  p();
  p();
  p("// --- site health ----------------------------------------------------------");
  p("// Stored in the RL namespace under its own key rather than a new binding:");
  p("// it's one small singleton blob, and a binding you must provision before the");
  p("// dashboard works is a binding people don't provision.");
  p("const readSiteHealth = (env: CloudflareEnv) => readHealthSummary(env.RL);");
  p();
  p("// The same read, adapted for the overview slice. `readHealthSummary` yields");
  p("// `null` for 'no scan yet' while a slice resolver signals absence with");
  p("// `undefined` — the two types are otherwise identical, and this one-line");
  p("// coercion is the whole difference.");
  p("const overviewHealth = async (env: CloudflareEnv) =>");
  p("  (await readSiteHealth(env)) ?? undefined;");
  p();
  for (const line of generateAstroidCwvQuery(config)) p(line);
  p();
  p("// The daily scan. Crawls the site's own pages for broken links and counts the");
  p("// two accessibility/SEO gaps that are cheap to compute, then persists one");
  p("// snapshot for the dashboard to read. Every part degrades on its own — a");
  p("// failed crawl or a failed COUNT yields zero rather than aborting the scan,");
  p("// because a partial health report is worth strictly more than none.");
  p("async function runHealthScan(env: CloudflareEnv) {");
  p("  const origin = env.SITE_URL ?? MEDIA_BASE;");
  p("  const [brokenLinks, missingAlt, seoGaps] = await Promise.all([");
  p("    checkLinks({ base: origin, paths: [\"/\"] }).catch(() => []),");
  p("    countRows(env, \"SELECT COUNT(*) AS n FROM media WHERE alt IS NULL OR alt = ''\"),");
  p("    countRows(");
  p("      env,");
  p('      "SELECT COUNT(*) AS n FROM pages WHERE status = \'published\'" +');
  p("      \" AND (seo_title IS NULL OR seo_title = '' OR seo_description IS NULL OR seo_description = '')\",");
  p("    ),");
  p("  ]);");
  p("  const summary = summarizeHealth({ brokenLinks, missingAlt, seoGaps });");
  p("  // Field data, when the SQL API credentials are real. Absent leaves the");
  p("  // Health badge at 'not measured yet' rather than failing the scan.");
  p("  const cwv = await queryCwv(env);");
  p("  if (cwv) summary.cwv = cwv;");
  p("  await writeHealthSummary(env.RL, summary);");
  p("  return summary;");
  p("}");
  p();
  p("/** One COUNT, degrading to 0 — a missing table must not abort the scan. */");
  p("async function countRows(env: CloudflareEnv, sql: string): Promise<number> {");
  p("  try {");
  p("    const row = await env.DB.prepare(sql).first<{ n: number }>();");
  p("    return Number(row?.n ?? 0);");
  p("  } catch {");
  p("    return 0;");
  p("  }");
  p("}");
  p();
  if (inquiries) {
    p();
    p("// Unhandled inquiries. The COUNT is the whole table on purpose: the");
    p("// Inquiries tab reviews and CLEARS submissions (GET lists, DELETE removes),");
    p("// so a row that still exists is a message still waiting on you. There is no");
    p("// read/unread column because deletion IS the acknowledgement — which also");
    p("// means this number goes down as you work through them, rather than being a");
    p("// total that only ever climbs.");
    p("const overviewInbox = async (env: CloudflareEnv) => {");
    p('  const n = await countRows(env, "SELECT COUNT(*) AS n FROM inquiries");');
    p("  return { unread: n };");
    p("};");
  }
  p("// The Home dashboard's content counts. Raw SQL because these are COUNTs over");
  p("// THIS project's tables — the toolkit deliberately makes no assumption about");
  p("// column names. A throw here degrades to a hidden card, never a 500.");
  p("const overviewContent = async (env: CloudflareEnv) => {");
  p("  const row = await env.DB.prepare(");
  p('    "SELECT" +');
  p("    \" (SELECT COUNT(*) FROM pages WHERE status = 'draft') AS drafts,\" +");
  p(
    '    " (SELECT COUNT(DISTINCT parent_id) FROM pages_versions WHERE status = \'draft\') AS unpublished," +',
  );
  p('    " (SELECT MAX(updated_at) FROM pages) AS last_edited",');
  p("  ).first<{ drafts: number; unpublished: number; last_edited: number | null }>();");
  p("  if (!row) return undefined;");
  p("  return {");
  p("    drafts: Number(row.drafts ?? 0),");
  p("    unpublished: Number(row.unpublished ?? 0),");
  p("    // Stored as a unix timestamp; the card wants ISO.");
  p("    ...(row.last_edited");
  p("      ? { lastEditedAt: new Date(Number(row.last_edited) * 1000).toISOString() }");
  p("      : {}),");
  p("  };");
  p("};");
  if (inquiries) {
    p();
    p("// Public contact form: the built-in inquiries fields + silent spam");
    p("// heuristics (a honeypot + a minimum time-since-render).");
    p(
      'const contactForm = defineForm({ name: "inquiries", fields: inquiriesForm.fields, spam: { honeypot: "website", minSeconds: 2, rateLimit: { max: 5, windowSec: 60 } } });',
    );
  }
  p();
  p("// `sections` writes are validated against the section catalog before they");
  p("// persist — Astroid wires `assertValidSections` + `sanitizeSectionsRichText`");
  p("// into the pages collection's beforeChange hook (src/schema.ts's config), so");
  p("// every route below inherits it. An unknown `_type`, a field of the wrong");
  p("// shape, or a setting outside its declared options is a 422, not a hole in");
  p("// the page.");
  p("const editorRoutes: WorkerRoute<CloudflareEnv>[] = [");
  for (const route of plan) {
    p(`  // ${route.note}`);
    p(`  ${routeCall(route.name)},`);
  }
  p("];");
  p();
  p("// Stream uploaded media back from R2 at MEDIA_BASE (self-hosted, no public bucket).");
  p("const mediaAssetRoute: WorkerRoute<CloudflareEnv> = async (request, env) => {");
  p("  const url = new URL(request.url);");
  p("  if (!url.pathname.startsWith(`${MEDIA_BASE}/`)) return undefined;");
  p("  const key = decodeURIComponent(url.pathname.slice(MEDIA_BASE.length + 1));");
  p("  if (!key) return undefined;");
  p("  const obj = await env.MEDIA.get(key);");
  p('  if (!obj) return new Response("Not found", { status: 404 });');
  p("  const headers = new Headers();");
  p("  obj.writeHttpMetadata(headers);");
  p('  headers.set("etag", obj.httpEtag);');
  p('  headers.set("cache-control", "public, max-age=31536000, immutable");');
  p('  headers.set("x-content-type-options", "nosniff");');
  p("  return new Response(obj.body, { headers });");
  p("};");
  p();
  // The queue message type parameter is what gives the `queue` consumer below a
  // typed `MessageBatch` instead of `MessageBatch<unknown>`.
  p(
    queues
      ? "export default composeWorker<CloudflareEnv, AstroidQueueMessage>({"
      : "export default composeWorker<CloudflareEnv>({",
  );
  p("  routes: [...editorRoutes, mediaAssetRoute],");
  p("  // The SSR fallback, wrapped in the cookie-aware Worker cache (ADR 0004).");
  p("  //");
  p("  // Wrapped UNCONDITIONALLY, and that is safe: `withEdgeCache` only stores a");
  p("  // response that carries a cacheable Cloudflare-CDN-Cache-Control directive,");
  p("  // and a page emits one only via `Astro.cache.set(...)` — which the scaffold");
  p("  // gates on ASTROID_EDGE_CACHE being \"true\" AND the request not being in edit");
  p("  // mode. With the var off (the default) every render is `no-store`, so this");
  p("  // layer stores nothing and is a transparent pass-through.");
  p("  //");
  p("  // It must be THIS cache and not Cloudflare's automatic edge cache: that one");
  p("  // is keyed by URL, runs BEFORE the Worker, and is therefore cookie-blind —");
  p("  // it will happily serve an editor a cached public page. That exact bug got");
  p("  // this feature reverted twice (#163, #165). `withEdgeCache` strips the CDN");
  p("  // directive from every response so the automatic cache never engages.");
  p("  //");
  p("  // Read the activation runbook in docs/adr/0004-edge-caching.md before");
  p("  // flipping the var on: `caches.default` is NOT cleared by Cloudflare Dev");
  p("  // Mode or Purge Everything, so a mistake in prod is hard to walk back.");
  p("  fetch: withEdgeCache((request, env, ctx) => handle(request, env, ctx), {");
  p("    // An editor never reads from, and never writes to, the shared entry.");
  p("    bypass: isEditRequest,");
  p("  }),");
  if (queues) {
    p("  // Queue consumer. `processBatch` acks or retries each message");
    p("  // INDEPENDENTLY, so one poisoned message can't block the rest of the");
    p("  // batch from acking; Cloudflare routes it to the DLQ once it exceeds");
    p("  // max_retries (see wrangler.jsonc).");
    p(
      "  queue: (batch, env) => processBatch(batch, (message) => handleQueueMessage(env, message)),",
    );
  }
  // ONE scheduled handler for every cron, dispatching on `controller.cron`.
  // Cloudflare gives no other way to tell them apart, and the strings here have
  // to match `astroidCrons` exactly — which is why both read the same constants
  // rather than repeating a literal.
  p("  // Cron. Cloudflare fires this for EVERY trigger in wrangler.jsonc and");
  p("  // identifies which by `controller.cron`, so dispatch on it.");
  p("  scheduled: (controller, env, ctx) => {");
  p(`    if (controller.cron === ${JSON.stringify(ASTROID_HEALTH_CRON)}) {`);
  p("      // Daily site-health scan. `waitUntil` because the crawl outlives the");
  p("      // handler's return, and a scan that throws must not retry the cron.");
  p("      ctx.waitUntil(runHealthScan(env).catch(() => {}));");
  p("      return;");
  p("    }");
  if (cron) {
    p(`    if (controller.cron === ${JSON.stringify(cron)}) {`);
    p("      // Catalog safety net. Webhooks get missed — a provider outage, a");
    p("      // deploy mid-delivery, a DLQ'd message — and without this the site");
    p("      // serves stale data until a human notices. Enqueued rather than run");
    p("      // inline so it takes the same retry + DLQ path as everything else.");
    p('      ctx.waitUntil(env.COMMERCE_QUEUE.send({ kind: "catalog_refresh" }));');
    p("    }");
  }
  p("  },");
  p("});");
  p();
  if (usesRealtime(config)) {
    // Re-exported from the ENTRY because wrangler resolves a Durable Object
    // binding's `class_name` against the worker's exports — the class living in
    // src/edit-session.ts is not enough on its own, and the failure is a deploy
    // error about an unresolvable class rather than anything pointing here.
    p("// The realtime edit-session Durable Object. Re-exported so wrangler can");
    p("// resolve the `class_name` in the durable_objects binding.");
    p(`export { ${ASTROID_EDIT_SESSION_CLASS} } from "./edit-session.js";`);
    p();
  }

  return lines.join("\n");
}

/**
 * Generate the Astro middleware (`middleware.ts`) from an Astroid config: the
 * shared Louise flow (rate-limit the unauthenticated POST surface → resolve editor
 * session + sticky `?louise` edit mode → content-freshness + security headers) via
 * `createLouiseMiddleware`.
 *
 * The rate rules are NOT emitted as literals here — the file calls
 * `astroidRateRules(astroidConfig)`, so the set stays real data in the package
 * (testable, and a `match` predicate survives, which a serialized literal could
 * not). Enabling a portal or commerce in the config adds that surface's rules
 * with no regeneration of this file at all.
 *
 * CSP: `astro.config.mjs` enables `security.csp` (via `astroidSecurity`), so
 * Astro emits a hash-based `content-security-policy` response header on every SSR
 * page and owns `script-src`. The `cspStyleSrc` below tells
 * `createLouiseMiddleware` to rewrite that header's `style-src` to
 * `'self' 'unsafe-inline'` — a hash-based `style-src` would, per spec, void the
 * `'unsafe-inline'` that Louise's data-driven `style=""` carriers and the
 * editor's runtime-injected `<style>` require. Script hashes are left verbatim,
 * and the inlined `data:` brand font is auto-allowed.
 */
export function generateAstroidMiddleware(config: AstroidConfig): string {
  // Louise's brand font is bundled + base64-inlined (no Google Fonts host to
  // allow); createLouiseMiddleware auto-allows `data:` fonts in the CSP, so the
  // inlined @font-face needs no manual `font-src` entry.
  const cspStyleSrc = "'self' 'unsafe-inline'";
  const portal = astroidPortal(config);
  return [
    "// Generated by astroidjs — do not hand-edit.",
    "// The shared Louise middleware: rate-limit the unauthenticated POST surfaces,",
    "// then resolve the editor session + sticky ?louise edit mode, then apply",
    "// content-freshness + transport-security headers, and rewrite the style-src of",
    "// the CSP header Astro's security.csp emits so Louise's data-driven inline",
    "// styles + inlined data: brand font are allowed.",
    'import { env } from "cloudflare:workers";',
    'import { createLouiseMiddleware } from "louise-toolkit/astro";',
    portal
      ? 'import { astroidPortalGuardConfig, astroidRateRules, guardResponse, portalGuard, resolvePortalSession } from "astroidjs";'
      : 'import { astroidRateRules } from "astroidjs";',
    'import astroidConfig from "../astroid.config.js";',
    "// TODO(astroid): your AUTH seam — same resolveEditor as the generated worker.ts.",
    'import { resolveEditor } from "./auth.js";',
    // The portal's resolver lives in its OWN module, not the editor's auth
    // seam — they're separate Better Auth instances and must not share a file.
    ...(portal ? ['import { resolvePortalUser } from "./portal-auth.js";'] : []),
    "",
    "// Rate-limit the public, unauthenticated POST surface, keyed by client IP",
    "// (fixed-window KV counter that fails open). Derived from your config: the",
    "// editor magic-link always, plus the portal credential surfaces and checkout",
    "// when those are enabled. Add your own via `security.rateRules` in the config —",
    "// they're matched first, so they can also override a default's budget.",
    "// `env.RL` is read per request (a getter) — a KV binding is only valid in",
    "// request scope.",
    "const RATE_RULES = astroidRateRules(astroidConfig);",
    ...(portal
      ? [
          "const PORTAL_GUARD = astroidPortalGuardConfig(astroidConfig)!;",
          "",
          "// The PORTAL session — a second, cookie- and table-isolated Better Auth",
          "// instance beside the editor's. `resolvePortalSession` shares the in-flight",
          "// lookup per request, so the guard here and the handler that runs next",
          "// don't each pay a session round-trip.",
        ]
      : []),
    "",
    "export const onRequest = createLouiseMiddleware({",
    "  resolveEditor: (request) => resolveEditor(request),",
    "  rateLimit: { rules: RATE_RULES, kv: () => env.RL },",
    ...(portal
      ? [
          "  extend: async (context) => {",
          "    const user = await resolvePortalSession(context.request, resolvePortalUser);",
          "    context.locals.portalUser = user;",
          "  },",
          "  // Route guard: the declarative prefix→roles table from your config.",
          "  // An /api/* route always answers in JSON — redirecting fetch() to an",
          "  // HTML login page returns 200 and markup, which reads as success.",
          "  guard: (context) => {",
          "    const decision = portalGuard(",
          "      context.url.pathname,",
          "      context.locals.portalUser,",
          "      PORTAL_GUARD,",
          "    );",
          "    if (!decision) return undefined;",
          '    if (decision.kind === "redirect") return context.redirect(decision.location);',
          "    return guardResponse(decision) ?? undefined;",
          "  },",
        ]
      : []),
    "  // Rewrite Astro's hash-based style-src (owned by astroidSecurity in",
    '  // astro.config.mjs) to permit Louise\'s data-driven style="" + editor styles.',
    `  cspStyleSrc: ${JSON.stringify(cspStyleSrc)},`,
    "});",
    "",
  ].join("\n");
}
