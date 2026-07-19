// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The PWA scaffold — a scoped service worker, a manifest, and the headers they
// need.
//
// The scoping is the whole design, not a detail. A Louise site is CMS-edited:
// an editor signs in, flips edit mode on, and edits the live page in place. A
// service worker that cached HTML across the whole origin would serve that
// editor a stale copy of the page they are trying to change — and the bug would
// present as "my edits don't save", which is about as far from the cause as a
// report can get.
//
// So the generated worker is scoped, and inside its scope it still refuses to
// touch anything dynamic:
//
//   • `/api/*`        never cached — checkout, auth, and every Louise write
//   • editor routes   never cached — the studio must always be live
//   • edit-mode URLs  never cached — `?louise` marks a request as an editing
//                     session, and caching one poisons it for everyone
//
// Everything else is the ordinary split: navigations network-first with a
// cached offline shell, hashed assets cache-first because their names change
// when their content does.

import type { AstroidConfig } from "../config.js";

/** Tuning for the PWA scaffold. Every field has a sensible derivation. */
export interface PwaConfig {
  /**
   * URL prefix the app is installed at. Default `"/"`.
   *
   * A narrower scope (`"/order"`) is usually right: it keeps the worker off the
   * marketing pages entirely, which is both safer and a smaller cache.
   */
  scope?: string;
  /** Home screen name. Defaults to the brand name. */
  shortName?: string;
  description?: string;
  /** `standalone` (default) hides browser chrome; `browser` opts out of it. */
  display?: "standalone" | "minimal-ui" | "fullscreen" | "browser";
  orientation?: "any" | "portrait" | "landscape";
  /** Splash background. Defaults to white. */
  backgroundColor?: string;
  /** Theme colour. Defaults to the brand colour. */
  themeColor?: string;
  /** Extra paths to precache alongside the scope root. */
  shell?: string[];
}

/** True when this project switched the PWA on. */
export const usesPwa = (config: AstroidConfig): boolean =>
  (config.modules ?? []).includes("pwa");

/** Resolved PWA settings — config over derivation over default. */
export function resolvePwa(config: AstroidConfig): Required<Omit<PwaConfig, "shell">> & {
  shell: string[];
} {
  const pwa = config.pwa ?? {};
  // Normalized to a leading slash and no trailing one (except root), because
  // scope comparison is a string prefix test and "/order/" vs "/order" would
  // silently exclude the scope root itself.
  const raw = pwa.scope ?? "/";
  const scope = raw === "/" ? "/" : `/${raw.replace(/^\/+|\/+$/g, "")}`;
  return {
    scope,
    shortName: pwa.shortName ?? config.theme.name,
    description: pwa.description ?? `${config.theme.name} — installable app.`,
    display: pwa.display ?? "standalone",
    orientation: pwa.orientation ?? "any",
    backgroundColor: pwa.backgroundColor ?? "#ffffff",
    themeColor: pwa.themeColor ?? config.theme.colors.brand,
    shell: [scope, "/manifest.webmanifest", ...(pwa.shell ?? [])],
  };
}

/**
 * `public/manifest.webmanifest`.
 *
 * Icons are declared but NOT generated — a brand's icon is not something a
 * scaffold can invent, and emitting placeholders would produce an installable
 * app with a grey square for a face. The generated README step says to add them.
 */
export function generateWebManifest(config: AstroidConfig): string | null {
  if (!usesPwa(config)) return null;
  const pwa = resolvePwa(config);

  return `${JSON.stringify(
    {
      name: config.theme.name,
      short_name: pwa.shortName,
      description: pwa.description,
      id: pwa.scope,
      start_url: pwa.scope,
      scope: pwa.scope,
      display: pwa.display,
      orientation: pwa.orientation,
      background_color: pwa.backgroundColor,
      theme_color: pwa.themeColor,
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        // A maskable icon is a separate asset, not a flag on the same file: the
        // platform crops it to its own shape, so the artwork needs padding the
        // `any` icon shouldn't have.
        { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  )}\n`;
}

/** `public/sw.js`. Plain JS — a service worker is not bundled. */
export function generateServiceWorker(config: AstroidConfig): string | null {
  if (!usesPwa(config)) return null;
  const pwa = resolvePwa(config);
  // Cache name carries the project key so two Astroid apps on one origin (a
  // preview deploy, say) can't read each other's entries.
  const cacheName = `${config.key}-pwa-v1`;

  return [
    `// Service worker for the ${config.theme.name} PWA, scoped to ${pwa.scope}.`,
    "//",
    "// Generated by Astroid. Safe to edit — bump CACHE to invalidate everything",
    "// on the next visit.",
    "//",
    "// What it deliberately never caches, and why:",
    "//   /api/*        checkout, auth, and every Louise write — a cached POST",
    "//                 response or a stale session is worse than being offline",
    "//   editor routes the studio must always be live",
    "//   ?louise URLs  an edit-mode request; caching one would serve an editor a",
    "//                 stale copy of the page they're editing, and the bug would",
    "//                 present as 'my changes don't save'",
    `const CACHE = ${JSON.stringify(cacheName)};`,
    `const SCOPE = ${JSON.stringify(pwa.scope)};`,
    `const SHELL = ${JSON.stringify([...new Set(pwa.shell)])};`,
    "",
    "self.addEventListener('install', (event) => {",
    "  event.waitUntil(",
    "    caches",
    "      .open(CACHE)",
    "      // Best-effort: one 404 or redirect in the shell must not fail the",
    "      // whole install and leave the app without a worker.",
    "      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))",
    "      .then(() => self.skipWaiting()),",
    "  );",
    "});",
    "",
    "self.addEventListener('activate', (event) => {",
    "  event.waitUntil(",
    "    caches",
    "      .keys()",
    "      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))",
    "      .then(() => self.clients.claim()),",
    "  );",
    "});",
    "",
    "/** Requests that must always hit the network. */",
    "function isDynamic(url) {",
    "  return (",
    "    url.pathname.startsWith('/api/') ||",
    "    url.pathname.startsWith('/login') ||",
    "    url.pathname.startsWith('/admin') ||",
    "    // Louise's edit mode. `has()` rather than a value check: `?louise` with",
    "    // no value is the usual form.",
    "    url.searchParams.has('louise')",
    "  );",
    "}",
    "",
    "/** Hashed build output — the filename changes when the content does, so it",
    " *  can be cached forever without a staleness risk. */",
    "function isImmutable(url) {",
    "  return url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/icons/');",
    "}",
    "",
    "self.addEventListener('fetch', (event) => {",
    "  const req = event.request;",
    "  // Only GET: a cached POST response would be a correctness bug, not a",
    "  // speedup.",
    "  if (req.method !== 'GET') return;",
    "",
    "  const url = new URL(req.url);",
    "  // Cross-origin requests belong to whoever serves them.",
    "  if (url.origin !== self.location.origin) return;",
    "  if (isDynamic(url)) return;",
    "  // Outside the scope this worker has no business intercepting — the rest of",
    "  // the site is CMS-edited and must stay live.",
    "  if (SCOPE !== '/' && !url.pathname.startsWith(SCOPE)) return;",
    "",
    "  if (req.mode === 'navigate') {",
    "    // Network-first: a page is only worth serving from cache when the network",
    "    // failed, since the content behind it changes.",
    "    event.respondWith(",
    "      fetch(req)",
    "        .then((res) => {",
    "          const copy = res.clone();",
    "          caches",
    "            .open(CACHE)",
    "            .then((c) => c.put(req, copy))",
    "            .catch(() => {});",
    "          return res;",
    "        })",
    "        .catch(() => caches.match(req).then((r) => r || caches.match(SCOPE))),",
    "    );",
    "    return;",
    "  }",
    "",
    "  if (isImmutable(url)) {",
    "    event.respondWith(",
    "      caches.match(req).then(",
    "        (cached) =>",
    "          cached ||",
    "          fetch(req).then((res) => {",
    "            const copy = res.clone();",
    "            caches",
    "              .open(CACHE)",
    "              .then((c) => c.put(req, copy))",
    "              .catch(() => {});",
    "            return res;",
    "          }),",
    "      ),",
    "    );",
    "  }",
    "  // Everything else falls through to the browser's own handling.",
    "});",
    "",
  ].join("\n");
}

/**
 * The `public/_headers` block the PWA needs.
 *
 * `Service-Worker-Allowed` is emitted ONLY when the scope is broader than the
 * script's own location — which, with `sw.js` at the root, never is. Emitting it
 * unconditionally (as the reference does) is harmless but misleading: it implies
 * a requirement that isn't there, and someone later moving the script will trust
 * a header that no longer says what they need.
 */
export function generatePwaHeaders(config: AstroidConfig): string | null {
  if (!usesPwa(config)) return null;

  return [
    "",
    "# The service worker must revalidate on every load, or a bad worker sticks",
    "# around until its cache entry expires — and it controls every page in scope.",
    "/sw.js",
    "  Cache-Control: no-cache",
    "",
    "/manifest.webmanifest",
    "  Content-Type: application/manifest+json",
    "  Cache-Control: public, max-age=3600",
    "",
  ].join("\n");
}
