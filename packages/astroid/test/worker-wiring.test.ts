// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The generated worker's route WIRING — not that a route is mounted, but that
// it's handed the options it needs to actually do its job.
//
// This is the gap these tests exist for: every route below was already mounted
// and already worked, in the sense that it returned 200. Each was also missing
// one option, and in each case the failure was invisible — a dashboard that
// renders empty, a KV namespace nothing writes to, a delete-safety scan with
// nothing to scan. "The route is in the plan" was never the property worth
// asserting.

import { describe, expect, it } from "vitest";
import type { AstroidConfig } from "../src/config.js";
import { ASTROID_HEALTH_CRON, astroidCrons } from "../src/queues/messages.js";
import { generateAstroidWrangler } from "../src/project/generate.js";
import { generateAstroidWorker } from "../src/worker/generate.js";
import { type AstroidEditorRouteName, astroidEditorRoutePlan } from "../src/worker/routes.js";

/**
 * The generated line that mounts `factory`.
 *
 * Line-based rather than a braces regex: every option we care about here is an
 * arrow function, so `\(\{[^)]*\}\)` terminates on the `)` of `(env)` and
 * silently matches nothing — which reads as a passing assertion against "".
 */
function routeLine(worker: string, factory: string): string {
  const line = worker.split("\n").find((l) => l.trim().startsWith(`${factory}({`));
  if (!line) throw new Error(`no mounted ${factory} in the generated worker`);
  return line;
}

const base: AstroidConfig = {
  key: "acme",
  archetype: "marketing",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};

describe("overview route", () => {
  it("is mounted — the drawer's Home panel is the first thing an owner sees", () => {
    // `mountSettings` defaults `home: true` and Home is the initial overlay, so
    // without this route the editor opens on an empty panel fetching a 404.
    expect(astroidEditorRoutePlan(base).map((r) => r.name)).toContain("overview");
    const worker = generateAstroidWorker(base);
    expect(worker).toContain("overviewRoute({");
    expect(worker).toContain("overviewRoute,"); // imported
  });

  it("supplies a content resolver, not just the route", () => {
    // An overviewRoute with no resolvers returns `{}` and every card hides —
    // indistinguishable from the route being absent.
    const worker = generateAstroidWorker(base);
    expect(worker).toContain("content: overviewContent");
    expect(worker).toContain("const overviewContent = async");
  });

  it("counts drafts, unpublished changes, and the last edit", () => {
    const worker = generateAstroidWorker(base);
    expect(worker).toContain("FROM pages WHERE status = 'draft'");
    expect(worker).toContain("FROM pages_versions WHERE status = 'draft'");
    expect(worker).toContain("MAX(updated_at) FROM pages");
  });

  it("omits the inbox slice rather than reporting a fake unread count", () => {
    // The inquiries table has no read-state column, so "unread" could only be
    // the total — a number that never goes down. An absent slice hides its card,
    // which is the honest outcome.
    const worker = generateAstroidWorker({ ...base, archetype: "storefront" });
    expect(worker).toContain("overviewRoute({");
    expect(worker).not.toContain("inbox:");
  });
});

describe("autosave draft buffer", () => {
  it("passes DRAFTS to versionsRoute, which stages the drafts", () => {
    // wrangler.jsonc provisions a DRAFTS KV and the setup instructions tell you
    // to create it, but the route was never given `bufferKv` — so every autosave
    // keystroke went straight to D1 and the namespace was never written to.
    expect(routeLine(generateAstroidWorker(base), "versionsRoute")).toContain(
      "bufferKv: (env) => env.DRAFTS",
    );
  });

  it("does NOT pass it to saveRoute, which has no such option", () => {
    // `SaveRouteConfig` has no `bufferKv` — saveRoute writes live field saves
    // (title, SEO) straight through, and only the versioned body is buffered.
    // Passing it anyway is a type error in the SCAFFOLD, not in this package,
    // so nothing here would catch it; that's what the clean-room `astro check`
    // is for, and it did.
    expect(routeLine(generateAstroidWorker(base), "saveRoute")).not.toContain("bufferKv");
  });
});

describe("media delete-safety", () => {
  it("gives mediaRoute somewhere to look for references", () => {
    // Without `referenceSources` the scan reads nothing and every delete reports
    // "no references" — an editor can remove an image that's live on the home
    // page with no warning.
    const worker = generateAstroidWorker(base);
    expect(routeLine(worker, "mediaRoute")).toContain(
      "referenceSources: MEDIA_REFERENCE_SOURCES",
    );
    expect(worker).toContain("const MEDIA_REFERENCE_SOURCES = [");
  });

  it("scans the columns a media URL can actually be embedded in", () => {
    const worker = generateAstroidWorker(base);
    // `body` is rich-text HTML, `sections` is the structured JSON, `og_image` is
    // a direct reference. All three are SQL names — the scan is raw SQL.
    for (const column of ["body", "sections", "og_image"]) {
      expect(worker).toContain(`"${column}"`);
    }
    expect(worker).toContain('table: "site_settings"');
  });
});

describe("AI assists", () => {
  it("mounts the AI routes and hands them the binding", () => {
    // The rewrite and SEO-suggest buttons ship in the editor drawer already.
    // Without these routes they 404; without `ai` they 503 — either way the
    // client hides them, so they were permanently invisible.
    const worker = generateAstroidWorker(base);
    expect(routeLine(worker, "aiRoute")).toContain("ai: (env) => env.AI");
    expect(routeLine(worker, "seoFixRoute")).toContain("ai: (env) => env.AI");
    expect(routeLine(worker, "mediaRoute")).toContain("altText: (env) => env.AI");
  });

  it("mounts seoFixRoute BEFORE pagesRoute", () => {
    // seoFixRoute lives at /api/louise/pages/generate-seo, and pagesRoute claims
    // EVERY path under /api/louise/pages/ as an item id (`path.startsWith`).
    // Mounted after, it is unreachable and the request 400s on the non-integer
    // id "generate-seo" — the same collision the versions/search ordering exists
    // to prevent, and invisible until someone clicks the button.
    const names = astroidEditorRoutePlan(base).map((r) => r.name);
    expect(names.indexOf("seoFix")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("seoFix")).toBeLessThan(names.indexOf("pages"));
  });

  it("keeps every /api/louise/pages/<word> route ahead of pagesRoute", () => {
    // The general form of the rule, so a future sibling can't reintroduce it.
    const names = astroidEditorRoutePlan(base).map((r) => r.name);
    const pages = names.indexOf("pages");
    const subPaths: AstroidEditorRouteName[] = ["versions", "search", "seoFix"];
    for (const sub of subPaths) {
      expect(names.indexOf(sub), `${sub} must precede pagesRoute`).toBeLessThan(pages);
    }
  });
});

describe("site health", () => {
  it("mounts healthRoute and lights up the overview health card", () => {
    // Same shape as the overview bug: the Health PANEL already ships in the
    // editor drawer (BUILTIN_CARDS includes it), so leaving the route unmounted
    // meant rendering UI for a subsystem that was never provisioned.
    const worker = generateAstroidWorker(base);
    expect(routeLine(worker, "healthRoute")).toContain("read: readSiteHealth");
    expect(routeLine(worker, "overviewRoute")).toContain("health: overviewHealth");
    // `readHealthSummary` yields null for "no scan yet"; a slice resolver signals
    // absence with undefined. The clean-room `astro check` caught the mismatch.
    expect(worker).toContain("(await readSiteHealth(env)) ?? undefined");
  });

  it("stores the summary in the EXISTING RL namespace, not a new binding", () => {
    // A binding you must provision before the dashboard works is a binding
    // people don't provision. It's one small singleton blob under its own key.
    expect(generateAstroidWorker(base)).toContain("readHealthSummary(env.RL)");
  });

  it("always schedules the daily scan, with or without queues", () => {
    for (const config of [base, { ...base, commerce: { provider: "square" as const } }]) {
      expect(astroidCrons(config)).toContain(ASTROID_HEALTH_CRON);
      expect(generateAstroidWorker(config)).toContain("runHealthScan");
    }
  });

  it("dispatches on controller.cron, and the strings match wrangler's list", () => {
    // Cloudflare fires ONE scheduled handler for every trigger and identifies
    // which by `controller.cron`. If wrangler.jsonc and this dispatch disagree,
    // the job silently never runs — so both must come from `astroidCrons`.
    const config: AstroidConfig = { ...base, commerce: { provider: "square" } };
    const worker = generateAstroidWorker(config);
    const wrangler = generateAstroidWrangler(config);
    const crons = astroidCrons(config);
    expect(crons).toHaveLength(2);
    for (const cron of crons) {
      expect(worker, `handler does not dispatch ${cron}`).toContain(
        `controller.cron === ${JSON.stringify(cron)}`,
      );
      expect(wrangler, `wrangler does not declare ${cron}`).toContain(JSON.stringify(cron));
    }
  });

  it("degrades each part of the scan independently", () => {
    // A failed crawl or a missing table must not abort the whole scan — a
    // partial health report is worth strictly more than none.
    const worker = generateAstroidWorker(base);
    expect(worker).toContain("checkLinks({ base: origin, paths: [\"/\"] }).catch(() => [])");
    expect(worker).toContain("return 0;");
  });
});

describe("edge cache (ADR 0004)", () => {
  it("wraps the SSR fallback with the cookie-aware Worker cache", () => {
    const worker = generateAstroidWorker(base);
    expect(worker).toContain("fetch: withEdgeCache(");
    expect(worker).toContain(
      'import { composeWorker, isEditRequest, type WorkerRoute, withEdgeCache } from "louise-toolkit/worker";',
    );
  });

  it("bypasses on an edit request, using the shipped predicate", () => {
    // Not a hand-rolled cookie check: `isEditRequest` reads the same constant
    // `createLouiseMiddleware` uses to SET the cookie, so the two can't drift.
    // Drift here means an editor served a cached public page — the exact bug
    // that got this feature reverted twice (#163, #165).
    expect(generateAstroidWorker(base)).toContain("bypass: isEditRequest");
  });

  it("ships the flag OFF, which is the safe state", () => {
    // Off ⇒ every render is `Astro.cache.set(false)` ⇒ `no-store` ⇒ the layer
    // stores nothing and is a transparent pass-through. `caches.default` is not
    // cleared by Dev Mode or Purge Everything, so on-by-default would make a
    // mistake very hard to walk back.
    expect(generateAstroidWrangler(base)).toContain('"ASTROID_EDGE_CACHE": "false"');
  });

  it("points at the activation runbook rather than just enabling it", () => {
    const wrangler = generateAstroidWrangler(base);
    expect(wrangler).toContain("0004-edge-caching.md");
    expect(wrangler.toLowerCase()).toContain("preview");
  });
});
