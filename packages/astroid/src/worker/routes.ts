// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The editor route plan — which louise-toolkit/editor routes a project needs, in
// the ONE order that avoids matcher collisions. This is where the "versionsRoute
// and searchRoute MUST precede pagesRoute" tribal knowledge lives: encoded once,
// as data, instead of re-derived by hand (and mis-ordered) in every site's
// worker.ts. The generator turns this plan into source; tests assert the order.

import type { AstroidConfig } from "../config.js";
import { capturesInquiries } from "../schema/framework.js";

export type AstroidEditorRouteName =
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
