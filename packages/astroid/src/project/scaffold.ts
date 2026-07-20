// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Every SCAFFOLD-ONCE file a config implies, in one list.
//
// This exists because the split between "generated" and "scaffolded" was drawn
// in the wrong place. `generateAstroidProject` returns the regenerated trio, and
// that trio emits STATIC IMPORTS of scaffold-once modules:
//
//   src/worker.ts      → import { handleQueueMessage } from "./queue.js"
//   src/middleware.ts  → import { resolvePortalUser } from "./portal-auth.js"
//
// The files behind those imports were written in exactly one place —
// `create-astroid`'s CLI — and nothing else could produce them. So turning a
// module on AFTER scaffold, by editing the one typed config the framework is
// built around, regenerated a trio importing files that did not exist. `astroid
// doctor` reported "healthy" and the project failed in Vite.
//
// Aggregating them here makes `astroid generate` able to complete a config
// change, `astroid doctor` able to notice one it hasn't, and `create-astroid`
// stop hand-listing the same nine files a third time.
//
// SCAFFOLD-ONCE means what it says: every file here is written only when ABSENT.
// Each one exists to be edited (what a catalog refresh means, which events
// matter, what a reset email says), so regenerating over it would destroy the
// work the seam exists to hold.

import {
  generateAstroidCheckoutRoute,
  generateAstroidSquareCard,
} from "../commerce/checkout-scaffold.js";
import { generateCatalogMigrationSql } from "../commerce/mirror.js";
import { generateAstroidVitalsBeacon } from "../analytics/index.js";
import { generateAstroidActions } from "./actions.js";
import { cwvBeaconScript } from "louise-toolkit/analytics";

import type { AstroidConfig } from "../config.js";
import { generateMapEmbedComponent, generateMapTileRoute } from "../map/scaffold.js";
import { generateAstroidGalleryPage } from "../portfolio/scaffold.js";
import { generateAstroidPortalAuth, generateAstroidPortalAuthRoute } from "../portal/scaffold.js";
import { generateAstroidEditSession } from "../realtime/scaffold.js";
import { generatePwaHeaders, generateServiceWorker, generateWebManifest } from "../pwa/generate.js";
import { astroidUsesQueues } from "../queues/messages.js";
import { generateAstroidQueueSeam, generateAstroidWebhookRoutes } from "../queues/scaffold.js";

/**
 * A file written once, then owned by the project.
 *
 * `apply` is the whole contract. `"skip"` (the default) leaves an existing file
 * alone. `"append-once"` is for the files a project accumulates into rather than
 * owns outright — `public/_headers` gets a stanza per module, and a second
 * module must not erase the first one's.
 */
export interface ScaffoldFile {
  /** Path relative to the project root, POSIX-separated. */
  path: string;
  contents: string;
  /** What to do when the path already exists. Default `"skip"`. */
  apply?: "skip" | "append-once";
  /**
   * For `"append-once"`: a substring that proves this stanza is already there.
   * Without it a re-run would append a duplicate every time.
   */
  marker?: string;
}

/**
 * Every scaffold-once file this config implies.
 *
 * Ordered by module so a `generate` that writes several prints them in a stable
 * sequence. Returns `[]` for a plain marketing site with no modules — the
 * baseline floor is entirely the regenerated trio plus the static template.
 */
export function generateAstroidScaffoldFiles(config: AstroidConfig): ScaffoldFile[] {
  const files: ScaffoldFile[] = [];

  // --- commerce: the catalog table's migration ------------------------------
  // Numbered 0003 so it lands after the template's 0000_content and the auth
  // pair (0001, 0002) that `create-astroid` writes. Without it `--commerce`
  // scaffolded a `products` table into src/schema.ts that no migration ever
  // created, and the first sync wrote nothing while reporting success.
  const catalogSql = generateCatalogMigrationSql(config);
  if (catalogSql) files.push({ path: "migrations/0003_catalog.sql", contents: catalogSql });

  // --- the CWV beacon -------------------------------------------------------
  // A static file under public/, so it is same-origin and covered by
  // `script-src 'self'` — an inline script carrying generated content could not
  // be hashed into the CSP and would be blocked.
  const beacon = generateAstroidVitalsBeacon(config, cwvBeaconScript());
  files.push({ path: beacon.path, contents: beacon.contents });

  // --- the typed Astro Actions surface --------------------------------------
  // Always: every project has editable pages, and the routes alone leave the
  // Astro-native half of ADR 0001 unbuilt. Scaffold-once because it is meant to
  // be added to.
  files.push({ path: "src/actions/index.ts", contents: generateAstroidActions(config) });

  // --- commerce: the server-authoritative payment seam ----------------------
  // Scaffold-once: a real store adds shipping, tax, an order row, a receipt.
  // What's fixed is the sequence that keeps a charge correct.
  const checkoutRoute = generateAstroidCheckoutRoute(config);
  if (checkoutRoute) files.push({ path: "src/pages/api/checkout.ts", contents: checkoutRoute });
  const squareCard = generateAstroidSquareCard(config);
  if (squareCard) files.push({ path: "src/components/SquareCard.astro", contents: squareCard });

  // --- queues: the consumer seam + one receiver per commerce provider --------
  // Both exist to be edited (what a refresh means; which events matter), which
  // is why `astroid generate` must never rewrite them.
  if (astroidUsesQueues(config)) {
    files.push({ path: "src/queue.ts", contents: generateAstroidQueueSeam(config) });
    // One receiver per provider — a site can run two (invoicing + storefront).
    for (const route of generateAstroidWebhookRoutes(config)) {
      files.push({ path: route.path, contents: route.contents });
    }
  }

  // --- portfolio: the gallery page -----------------------------------------
  // "Which assets appear, in what order" is the first thing a portfolio changes.
  const gallery = generateAstroidGalleryPage(config);
  if (gallery) files.push({ path: "src/pages/work.astro", contents: gallery });

  // --- pwa: the service worker, manifest, and its headers -------------------
  // Static files under public/, not generated source — a service worker is not
  // bundled, and `_headers` is shared with whatever else writes to it.
  const sw = generateServiceWorker(config);
  if (sw) {
    files.push({ path: "public/sw.js", contents: sw });
    const manifest = generateWebManifest(config);
    if (manifest) files.push({ path: "public/manifest.webmanifest", contents: manifest });
    const headers = generatePwaHeaders(config);
    if (headers) {
      files.push({
        path: "public/_headers",
        contents: headers,
        apply: "append-once",
        // The service-worker path is the one token this stanza always contains
        // and nothing else in a `_headers` file would.
        marker: "/sw.js",
      });
    }
  }

  // --- map: the tile route + embed component --------------------------------
  // Generated into the project rather than shipped in astroidjs so maplibre-gl
  // stays a dependency of the projects that actually draw a map.
  const tileRoute = generateMapTileRoute(config);
  if (tileRoute) files.push({ path: "src/pages/map/basemap.pmtiles.ts", contents: tileRoute });
  const mapEmbed = generateMapEmbedComponent(config);
  if (mapEmbed) files.push({ path: "src/components/MapEmbed.astro", contents: mapEmbed });

  // --- realtime: the per-page edit-session Durable Object -------------------
  // Scaffold-once because it must import `cloudflare:workers` (runtime-only) and
  // because `persist` is the seam a project tunes.
  const editSession = generateAstroidEditSession(config);
  if (editSession) files.push({ path: "src/edit-session.ts", contents: editSession });

  // --- portal: the second auth instance + its mounted catch-all -------------
  // A site edits the reset email and the role a new account gets, but not the
  // mount/cookie/table prefixes that keep the two instances isolated.
  const portalAuth = generateAstroidPortalAuth(config);
  if (portalAuth) {
    files.push({ path: "src/portal-auth.ts", contents: portalAuth });
    const route = generateAstroidPortalAuthRoute(config);
    // Always non-null alongside portalAuth (same `astroidPortal` gate), but the
    // types don't know that and a silent drop here is a portal that cannot
    // authenticate — so assert it rather than `?.`-ing it away.
    if (route) files.push({ path: "src/pages/api/portal-auth/[...all].ts", contents: route });
  }

  return files;
}
