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
import { astroidVitalsDataset } from "../src/analytics/index.js";
import { generateAstroidCheckoutEnv } from "../src/commerce/checkout-scaffold.js";
import { generateAstroidScaffoldFiles } from "../src/project/scaffold.js";
import { generateAstroidRealtimeEnv } from "../src/realtime/scaffold.js";
import { generateAstroidWorker } from "../src/worker/generate.js";
import { astroidSecretNames } from "../src/status.js";
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

  it("counts UNHANDLED inquiries — the whole table, deliberately", () => {
    // There is no read/unread column because the Inquiries tab reviews and
    // CLEARS submissions: GET lists, DELETE removes, and deletion IS the
    // acknowledgement. So a surviving row is a message still waiting, and the
    // number goes down as you work through them rather than only climbing.
    const worker = generateAstroidWorker({ ...base, sections: ["hero", "contact"] });
    expect(routeLine(worker, "overviewRoute")).toContain("inbox: overviewInbox");
    expect(worker).toContain("SELECT COUNT(*) AS n FROM inquiries");
  });

  it("omits the inbox slice when the project captures no inquiries", () => {
    // No contact section and no wholesaleInquiry module → no inquiries table,
    // so the slice would query something that doesn't exist. Absent hides the
    // card, which is right for a site with no contact form.
    const worker = generateAstroidWorker({ ...base, sections: ["hero", "cta"] });
    expect(routeLine(worker, "overviewRoute")).not.toContain("inbox:");
    expect(worker).not.toContain("overviewInbox");
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

describe("realtime (ADR 0002)", () => {
  const rt: AstroidConfig = { ...base, modules: ["realtime"] };

  it("is entirely absent without the module", () => {
    const worker = generateAstroidWorker(base);
    expect(worker).not.toContain("realtimeRoute");
    expect(worker).not.toContain("EditSessionDO");
    expect(generateAstroidWrangler(base)).not.toContain("durable_objects");
    expect(generateAstroidScaffoldFiles(base).map((f) => f.path)).not.toContain(
      "src/edit-session.ts",
    );
  });

  it("mounts the upgrade route against the DO namespace", () => {
    expect(routeLine(generateAstroidWorker(rt), "realtimeRoute")).toContain(
      "namespace: (env) => env.EDIT_SESSION",
    );
  });

  it("imports realtimeRoute from /realtime, not /editor", () => {
    // It is the one factory in the route plan that is not an editor route.
    // Bundling it into the editor import block type-checks in THIS package (the
    // plan is only strings) and fails in the scaffold — clean-room `astro check`
    // is the only thing that sees it.
    const worker = generateAstroidWorker(rt);
    expect(worker).toContain('import { realtimeRoute } from "louise-toolkit/realtime";');
    const editorBlock = worker.slice(0, worker.indexOf('} from "louise-toolkit/editor";'));
    expect(editorBlock).not.toContain("realtimeRoute,");
  });

  it("re-exports the DO class from the worker ENTRY", () => {
    // wrangler resolves a binding's `class_name` against the worker's exports.
    // The class living in src/edit-session.ts is not enough on its own, and the
    // failure is a deploy error about an unresolvable class that points nowhere
    // near this wiring.
    expect(generateAstroidWorker(rt)).toContain(
      'export { EditSessionDO } from "./edit-session.js";',
    );
  });

  it("declares the binding AND a migration, with the SQLite backend", () => {
    const wrangler = generateAstroidWrangler(rt);
    expect(wrangler).toContain('"name": "EDIT_SESSION", "class_name": "EditSessionDO"');
    // A DO class with no migration tag is a deploy error. And it must be
    // `new_sqlite_classes`, not `new_classes`: the session keeps authoritative
    // state in `ctx.storage`, and the storage backend cannot be changed after
    // the class is first deployed — so getting this wrong is not fixable later.
    expect(wrangler).toContain('"tag": "v1", "new_sqlite_classes": ["EditSessionDO"]');
    expect(wrangler).not.toContain('"new_classes"');
  });

  it("scaffolds the DO subclass, delegating every hibernation handler", () => {
    const file = generateAstroidScaffoldFiles(rt).find((f) => f.path === "src/edit-session.ts");
    expect(file).toBeDefined();
    const src = file?.contents ?? "";
    // Miss one and the failure is silent: no `webSocketClose` leaks presence
    // forever, no `alarm` never flushes a draft.
    for (const handler of ["fetch", "webSocketMessage", "webSocketClose", "webSocketError", "alarm"]) {
      expect(src, `DO does not delegate ${handler}`).toContain(`${handler}(`);
    }
    // Lazy: a DO is re-instantiated after a hibernation wake.
    expect(src).toContain("#session ??=");
  });

  it("persists through applySaveDraft — one write path, no KV double-coalesce", () => {
    const src =
      generateAstroidScaffoldFiles(rt).find((f) => f.path === "src/edit-session.ts")?.contents ?? "";
    expect(src).toContain("applySaveDraft");
    // The DO's alarm IS the coalescer for the page, so routing through the KV
    // write-buffer as well would be two layers of coalescing over one stream.
    // Assert on the deps object actually passed, not the file text — the comment
    // above it in the generated source legitimately names `bufferKv`.
    expect(src).toContain("{ table: pages, versionsTable: pagesVersions, config: pagesCollection }");
    // Guard the collection so a stray target can't write the wrong table.
    expect(src).toContain('target.slug !== "pages"');
  });

  it("types the namespace only when the module is on", () => {
    expect(generateAstroidRealtimeEnv(rt)).toContain("EDIT_SESSION: DurableObjectNamespace;");
    expect(generateAstroidRealtimeEnv(base)).toBe("");
  });
});

describe("card checkout", () => {
  const square: AstroidConfig = { ...base, commerce: { provider: "square" } };
  const fourthwall: AstroidConfig = { ...base, commerce: { provider: "fourthwall" } };
  const paths = (c: AstroidConfig) => generateAstroidScaffoldFiles(c).map((f) => f.path);

  it("scaffolds the payment seam for a Square storefront", () => {
    expect(paths(square)).toContain("src/pages/api/checkout.ts");
    expect(paths(square)).toContain("src/components/SquareCard.astro");
  });

  it("is absent for providers that don't take an in-page card", () => {
    // Fourthwall redirects to its own hosted checkout (no token to charge);
    // Stripe has no catalog API so it fills `invoicing`, not `storefront`.
    expect(paths(fourthwall)).not.toContain("src/pages/api/checkout.ts");
    expect(paths(base)).not.toContain("src/pages/api/checkout.ts");
    expect(generateAstroidWrangler(fourthwall)).not.toContain("SQUARE_APP_ID");
  });

  it("charges the SERVER's total, never the client's", () => {
    const route = generateAstroidScaffoldFiles(square).find(
      (f) => f.path === "src/pages/api/checkout.ts",
    )?.contents;
    expect(route).toContain("verifyCheckout(body.lines, serverPrices)");
    expect(route).toContain("amount: check.subtotalCents");
    // Prices come from the mirror, and the conversion rounds: 19.99 * 100 is
    // 1998.9999999999998, which would fail the exact-equality staleness check
    // on every single checkout.
    expect(route).toContain("Math.round(item.price * 100)");
  });

  it("requires a high-entropy cartId for the idempotency key", () => {
    const route = generateAstroidScaffoldFiles(square).find(
      (f) => f.path === "src/pages/api/checkout.ts",
    )?.contents;
    expect(route).toContain('checkoutIdempotencyKey(check, "order", cartId)');
    // Guessable ids let someone else's identical cart dedupe into your charge.
    expect(route).toContain("/^[0-9a-f-]{36}$/i.test(cartId)");
  });

  it("simulates rather than calling Square with a dummy credential", () => {
    const route = generateAstroidScaffoldFiles(square).find(
      (f) => f.path === "src/pages/api/checkout.ts",
    )?.contents ?? "";
    expect(route).toContain("resolveCommerceStatus");
    // The dormancy check must come BEFORE the charge, or an unprovisioned store
    // calls the payments API with DUMMY_REPLACE_ME.
    expect(route.indexOf("status.configured")).toBeLessThan(route.indexOf("createPayment("));
  });

  it("declares the public Square vars, and keeps them out of the secret roster", () => {
    // The app id ships to the browser by design; folding it into `credentials`
    // would also fold it into the dormancy gate, which asks a different question.
    const wrangler = generateAstroidWrangler(square);
    expect(wrangler).toContain('"SQUARE_APP_ID": ""');
    expect(wrangler).toContain('"SQUARE_ENVIRONMENT": "sandbox"');
    expect(generateAstroidCheckoutEnv(square)).toContain("SQUARE_APP_ID: string;");
    expect(generateAstroidCheckoutEnv(base)).toBe("");
  });
});

describe("core web vitals", () => {
  it("closes the loop: ingest, store, and read back", () => {
    // `HealthSummary.cwv` existed and the Health panel rendered a "not measured
    // yet" badge for it — permanently accurate and permanently useless, because
    // nothing collected the data. All three parts are needed for the badge to
    // ever change.
    const worker = generateAstroidWorker(base);
    expect(routeLine(worker, "vitalsRoute")).toContain("dataset: (env) => env.VITALS");
    expect(generateAstroidWrangler(base)).toContain('"binding": "VITALS"');
    expect(worker).toContain("async function queryCwv(");
    expect(worker).toContain("if (cwv) summary.cwv = cwv;");
  });

  it("imports vitalsRoute from /analytics, not /editor", () => {
    // Same trap as realtimeRoute — it isn't an editor route, and bundling it
    // into that import block only fails in a scaffolded project.
    const worker = generateAstroidWorker(base);
    expect(worker).toContain('} from "louise-toolkit/analytics";');
    const editorBlock = worker.slice(0, worker.indexOf('} from "louise-toolkit/editor";'));
    expect(editorBlock).not.toContain("vitalsRoute,");
  });

  it("names the dataset per project", () => {
    // Two Astroid sites on one Cloudflare account must not write into the same
    // table, or their p75s blend.
    expect(astroidVitalsDataset({ ...base, key: "acme" })).toBe("acme_web_vitals");
    expect(generateAstroidWrangler({ ...base, key: "other" })).toContain('"other_web_vitals"');
  });

  it("ships the beacon as a STATIC file, not an inline script", () => {
    // Astro hashes processed scripts into script-src; an is:inline script with
    // generated content can't be hashed and would be CSP-blocked. From public/
    // it is same-origin and covered by `script-src 'self'`.
    const beacon = generateAstroidScaffoldFiles(base).find((f) => f.path === "public/vitals.js");
    expect(beacon).toBeDefined();
    expect(beacon?.contents).toContain("navigator.sendBeacon");
  });

  it("keeps the read-back credentials dormant by default", () => {
    // The SQL API is account-scoped and has no binding, so it needs a token.
    // Unprovisioned must skip the query, not fail the whole health scan.
    const worker = generateAstroidWorker(base);
    expect(worker).toContain("readModuleSecret(env.CF_ACCOUNT_ID)");
    expect(worker).toContain("if (!accountId || !token) return undefined;");
    expect(astroidSecretNames(base).vitals).toEqual(["CF_ACCOUNT_ID", "CF_API_TOKEN"]);
  });
});
