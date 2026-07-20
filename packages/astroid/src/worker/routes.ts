// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The editor route plan — which louise-toolkit/editor routes a project needs, in
// the ONE order that avoids matcher collisions. This is where the "versionsRoute
// and searchRoute MUST precede pagesRoute" tribal knowledge lives: encoded once,
// as data, instead of re-derived by hand (and mis-ordered) in every site's
// worker.ts. The generator turns this plan into source; tests assert the order.

import type { AstroidConfig } from "../config.js";
import { usesRealtime } from "../realtime/scaffold.js";
import { capturesInquiries } from "../schema/framework.js";

export type AstroidEditorRouteName =
  | "ai"
  | "health"
  | "realtime"
  | "vitals"
  | "overview"
  | "seoFix"
  | "versions"
  | "search"
  | "pages"
  | "save"
  | "settings"
  | "media"
  | "editors"
  | "form"
  | "inquiries"
  | "seed";

export interface AstroidEditorRoute {
  /** Stable key for this route. */
  name: AstroidEditorRouteName;
  /** The `louise-toolkit/editor` factory that builds it. */
  factory: string;
  /** Why it's here, and any ordering constraint that pins its position. */
  note: string;
}

/**
 * The ordered editor route plan for a project. Order is load-bearing: the two
 * routes with `/pages/:id/...` sub-paths (`versions`, `search`) come first, so
 * `pages`' catch-all `/:id` matcher can't swallow them. Inquiry routes are
 * included only when a brand captures inquiries; `seed` is always last.
 */
export function astroidEditorRoutePlan(config: AstroidConfig): AstroidEditorRoute[] {
  const routes: AstroidEditorRoute[] = [
    {
      name: "overview",
      factory: "overviewRoute",
      note: "The Home dashboard's one aggregate read. NOT optional: `mountSettings` defaults `home: true` and Home is the drawer's initial panel, so without this route the FIRST screen an owner sees after opening the editor is an empty panel fetching a 404.",
    },
    {
      name: "versions",
      factory: "versionsRoute",
      note: "Draft/publish + version history for pages. MUST precede pagesRoute — pagesRoute's /:id matcher would otherwise claim /pages/:id/versions and 400 on the non-integer id.",
    },
    {
      name: "search",
      factory: "searchRoute",
      note: "Full-text search over pages (/search + /reindex). Before pagesRoute, whose /:id matcher would else claim those non-integer segments.",
    },
    {
      name: "seoFix",
      factory: "seoFixRoute",
      note: "One-click SEO backfill for published pages missing a title/description. MUST precede pagesRoute for the same reason versions/search do: it mounts at /api/louise/pages/generate-seo, and pagesRoute claims EVERY path under /api/louise/pages/ as an item id — so mounted after, it would never be reached and the request would 400 on the non-integer id `generate-seo`.",
    },
    {
      name: "pages",
      factory: "pagesRoute",
      note: "Page CRUD, including the structured sections column.",
    },
    {
      name: "save",
      factory: "saveRoute",
      note: "Live field saves (title, SEO) — the versioned body stages drafts via versionsRoute instead.",
    },
    {
      name: "settings",
      factory: "settingsRoute",
      note: "Editable site settings (brand, nav, contact, SEO defaults).",
    },
    {
      name: "media",
      factory: "mediaRoute",
      note: "Media library — list, upload, delete, reference checks.",
    },
    {
      name: "editors",
      factory: "editorsRoute",
      note: "Editor roster (the Users panel) over Better Auth's `user` table — a row IS an editor, and the same table is the magic-link allowlist (resolveAdmins).",
    },
  ];

  // AI assists that own their own path prefix. `/api/louise/ai/*` collides with
  // nothing, so this one's position is genuinely free.
  //
  // Mounted unconditionally: `louise-toolkit/ai` degrades by design (a missing
  // binding or a model error yields null, never a throw) and the route answers
  // 503 when `ai(env)` is undefined, which the client reads as "hide the
  // button". So mounting it on a project that never uses AI costs nothing, while
  // NOT mounting it left buttons that ship in the editor drawer permanently
  // dead.
  if (usesRealtime(config)) {
    routes.push({
      name: "realtime",
      factory: "realtimeRoute",
      note: "WebSocket upgrade for the per-page live editing session (ADR 0002). Owns /api/louise/realtime/*. Guards the handshake as a same-origin, session-gated mutation, then forwards to the per-page Durable Object with the SERVER-resolved editor identity — presence is never taken from the client.",
    });
  }

  routes.push({
    name: "vitals",
    factory: "vitalsRoute",
    note: "Public CWV ingestion (POST /api/louise/vitals). NOT session-gated — these are anonymous visitor beacons — but same-origin only, and it accepts-and-drops without the dataset binding. Always 204.",
  });

  routes.push({
    name: "health",
    factory: "healthRoute",
    note: "The site-health panel's read of the persisted scan summary. Owns /api/louise/health. Like overviewRoute, its client half already ships in the editor drawer — unmounted, the Health card was dead UI. Returns `{ summary: null }` (a 200) until the daily cron writes the first scan, which the panel renders as 'not checked yet'.",
  });

  routes.push({
    name: "ai",
    factory: "aiRoute",
    note: "Editor AI assists — rewrite/expand/shorten a selection, suggest SEO for a page. Owns /api/louise/ai/*, so it collides with nothing. POST-only and editor-gated, since each call spends AI budget.",
  });

  if (capturesInquiries(config)) {
    routes.push(
      {
        name: "form",
        factory: "formRoute",
        note: "Public inquiry capture (the contact form) + silent spam heuristics.",
      },
      {
        name: "inquiries",
        factory: "inquiriesRoute",
        note: "Editor-gated inquiry review, over the same inquiries table.",
      },
    );
  }

  routes.push({
    name: "seed",
    factory: "seedRoute",
    note: "First-run site_settings seed. Last — it's a one-shot bootstrap, not a hot path.",
  });

  return routes;
}
