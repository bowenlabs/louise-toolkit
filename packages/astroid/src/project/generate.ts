// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Project generation — the config → files layer the `astroid` CLI writes.
//
// Two tiers of generated file, deliberately kept apart:
//
//   1. The REGENERATED trio (`generateAstroidProject`) — `src/schema.ts`,
//      `src/worker.ts`, `src/middleware.ts`. Pure functions of the config, marked
//      "do not hand-edit". `astroid generate` (and `dev`/`build`) rewrite these on
//      every run, and `astroid doctor` diffs them to catch drift.
//
//   2. The SCAFFOLD-ONCE files (`generateAstroidWrangler`, …) — `wrangler.jsonc`
//      and friends. `create-astroid` writes them once; the developer then owns
//      them (fills real binding ids, secrets, account). `astroid generate` must
//      NEVER clobber them, or it would wipe provisioned ids — so they live in a
//      separate function the regenerate path doesn't call.

import {
  ASTROID_VITALS_BINDING,
  astroidVitalsDataset,
} from "../analytics/index.js";
import { astroidCheckoutVars } from "../commerce/checkout-scaffold.js";
import { astroidCommerceProviders } from "../commerce/roles.js";
import {
  COMMERCE_PROVIDER_SECRETS,
  COMMERCE_PROVIDER_SETUP,
  commerceSecretNames,
} from "../commerce/secrets.js";
import type { AstroidConfig } from "../config.js";
import {
  ASTROID_QUEUE_BINDING,
  astroidCron,
  astroidCrons,
  astroidQueueNames,
  astroidUsesQueues,
} from "../queues/messages.js";
import {
  ASTROID_EDIT_SESSION_CLASS,
  ASTROID_REALTIME_BINDING,
  ASTROID_REALTIME_MIGRATION_TAG,
  usesRealtime,
} from "../realtime/scaffold.js";
import { ASTROID_SECRET_PLACEHOLDER } from "../secrets.js";
import { generateAstroidSchema } from "../schema/generate.js";
import { generateAstroidMiddleware, generateAstroidWorker } from "../worker/generate.js";

/** A generated file: a project-root-relative POSIX path + its full contents. */
export interface GeneratedFile {
  /** Path relative to the project root, POSIX-separated (e.g. `"src/worker.ts"`). */
  path: string;
  contents: string;
}

/**
 * The regenerated trio — the files that are a pure function of the Astroid config
 * and carry a "do not hand-edit" banner. `astroid generate` writes exactly these,
 * and `astroid doctor` regenerates them in-memory to diff against disk. Scaffold-
 * once files (wrangler.jsonc, astro.config, auth.ts) are NOT here by design.
 */
export function generateAstroidProject(config: AstroidConfig): GeneratedFile[] {
  return [
    { path: "src/schema.ts", contents: generateAstroidSchema(config) },
    { path: "src/worker.ts", contents: generateAstroidWorker(config) },
    { path: "src/middleware.ts", contents: generateAstroidMiddleware(config) },
  ];
}

/**
 * The module-secret block `create-astroid` substitutes into `.env.example`.
 *
 * Every name is seeded with the placeholder sentinel rather than left empty,
 * which is the whole trick behind a scaffold that runs with no accounts: the
 * bindings all EXIST and all read as unconfigured, so each module takes its
 * dormant path deliberately instead of hitting an undefined-binding error. The
 * names come from {@link commerceSecretNames}, the same declaration the runtime
 * gate and the generated `env.d.ts` read.
 *
 * Empty string when the project enables no module that needs credentials — the
 * core secrets (session, Turnstile, mail) are already in the template file, with
 * their own prose.
 */
export function generateAstroidSecretsEnv(config: AstroidConfig): string {
  const providers = astroidCommerceProviders(config.commerce);
  if (providers.length === 0) return "";

  const lines: string[] = [
    "",
    "# --- commerce -------------------------------------------------------------",
    "#",
    "# Seeded with the DUMMY_REPLACE_ME sentinel, which reads as NOT CONFIGURED.",
    "# Commerce is dormant until every value below is real: the D1 catalog mirror",
    "# still serves whatever it last synced, the webhook receiver answers 503 (so",
    "# the provider retries rather than dropping events), and checkout is",
    "# simulated. Nothing calls the provider with a placeholder credential.",
  ];

  for (const provider of providers) {
    const spec = COMMERCE_PROVIDER_SECRETS[provider];
    lines.push("#", `# ${provider}: ${COMMERCE_PROVIDER_SETUP[provider]}`);
    for (const name of [...spec.credentials, spec.webhook]) {
      lines.push(`${name}=${ASTROID_SECRET_PLACEHOLDER}`);
    }
  }

  return lines.join("\n");
}

// Pinned compatibility date for the emitted Worker. A literal (Astroid's
// generators are pure — no `Date.now()`), bumped deliberately when the runtime
// baseline moves; matches the reference site's wrangler.jsonc.
const COMPATIBILITY_DATE = "2026-06-20";

/**
 * Generate a floor `wrangler.jsonc` from the config: the Worker name + editable
 * bindings a baseline Louise site needs (D1, R2 media, the rate-limit + autosave
 * KV, Cloudflare Images), custom-domain routes from `hosts`, and the `vars` the
 * media route + editor read. Binding ids are placeholders — real ids are filled by
 * `wrangler … create` (or, later, `astroid deploy`); `astroid doctor` flags any
 * still-unresolved placeholder.
 *
 * This is a SCAFFOLD-ONCE file: emitted by `create-astroid`, then owned by the
 * developer. It is intentionally not part of {@link generateAstroidProject}.
 */
export function generateAstroidWrangler(config: AstroidConfig): string {
  const key = config.key;
  const mediaBase = config.deploy?.mediaBase ?? "/media";
  const hosts = config.hosts ?? [];
  const primaryHost = hosts[0];

  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p("{");
  p('  "$schema": "node_modules/wrangler/config-schema.json",');
  p("  // The Cloudflare Worker name — also the default *.workers.dev subdomain.");
  p(`  "name": ${JSON.stringify(key)},`);
  p("  // Pin your account so deploys don't prompt (or set CLOUDFLARE_ACCOUNT_ID).");
  p('  // "account_id": "<your-cloudflare-account-id>",');
  p(`  "compatibility_date": ${JSON.stringify(COMPATIBILITY_DATE)},`);
  p('  "compatibility_flags": ["nodejs_compat"],');
  p("  // @astrojs/cloudflare builds this entry and wires the static assets under dist/.");
  p('  "main": "src/worker.ts",');
  if (primaryHost) {
    p("  // Custom domains this Worker serves (from your defineAstroid `hosts`).");
    p('  "routes": [');
    for (const host of hosts) {
      p(`    { "pattern": ${JSON.stringify(host)}, "custom_domain": true },`);
    }
    p("  ],");
  } else {
    p("  // No `hosts` in your config → deploys to <name>.workers.dev. Add a");
    p('  // "routes" block with a custom_domain pattern to serve a real domain.');
  }
  if (usesRealtime(config)) {
    // The per-page live editing session (ADR 0002). Two halves, and BOTH are
    // required — a binding with no migration is a deploy error, and the class
    // must also be exported from the worker entry (the generated src/worker.ts
    // re-exports it) or wrangler can't resolve `class_name`.
    p("  // Durable Object: the per-page live editing session (realtime module).");
    p('  "durable_objects": {');
    p(
      `    "bindings": [{ "name": ${JSON.stringify(ASTROID_REALTIME_BINDING)}, "class_name": ${JSON.stringify(ASTROID_EDIT_SESSION_CLASS)} }]`,
    );
    p("  },");
    p("  // A DO class needs a migration tag. `new_sqlite_classes` (NOT");
    p("  // `new_classes`) because the session keeps its authoritative state in");
    p("  // `ctx.storage`, which is the SQLite-backed store — and the storage");
    p("  // backend cannot be changed after the class is first deployed.");
    p("  \"migrations\": [");
    p(
      `    { "tag": ${JSON.stringify(ASTROID_REALTIME_MIGRATION_TAG)}, "new_sqlite_classes": [${JSON.stringify(ASTROID_EDIT_SESSION_CLASS)}] }`,
    );
    p("  ],");
  }
  // Crons. ONE `scheduled` handler receives all of them and tells them apart by
  // `controller.cron`, so this list and the handler's dispatch must agree
  // exactly — both come from `astroidCrons`, which is why it exists.
  //
  // Daily: the site-health scan (broken links, missing alt text, SEO gaps).
  // Hourly (commerce only): the catalog re-sync safety net, so a missed or DLQ'd
  // webhook can only leave the site stale until the next tick.
  p(`  "triggers": { "crons": ${JSON.stringify(astroidCrons(config))} },`);
  if (astroidUsesQueues(config)) {
    const { queue, dlq } = astroidQueueNames(config);
    p("  // Provider webhooks are verified at the edge, then enqueued here so the");
    p("  // receiver can return fast. Retries + DLQ routing are Cloudflare's, not");
    p("  // the consumer's — set them here, not in code.");
    p(`  // Create both: \`wrangler queues create ${queue}\` and \`… ${dlq}\`.`);
    p('  "queues": {');
    p(
      `    "producers": [{ "queue": ${JSON.stringify(queue)}, "binding": ${JSON.stringify(ASTROID_QUEUE_BINDING)} }],`,
    );
    p('    "consumers": [');
    p("      {");
    p(`        "queue": ${JSON.stringify(queue)},`);
    p(`        "max_batch_size": ${config.queues?.maxBatchSize ?? 10},`);
    p(`        "max_batch_timeout": ${config.queues?.maxBatchTimeout ?? 30},`);
    p(`        "max_retries": ${config.queues?.maxRetries ?? 5},`);
    p(`        "dead_letter_queue": ${JSON.stringify(dlq)},`);
    p("      },");
    p("    ],");
    p("  },");
  }
  p("  // D1 holds pages / site_settings / media / inquiries (schema in src/schema.ts,");
  p("  // migrations in ./migrations). Create it: `wrangler d1 create <name>`.");
  p('  "d1_databases": [');
  p("    {");
  p('      "binding": "DB",');
  p(`      "database_name": ${JSON.stringify(key)},`);
  p('      "database_id": "<run: wrangler d1 create ' + key + '>",');
  p('      "migrations_dir": "migrations",');
  p("    },");
  p("  ],");
  p("  // R2 bucket for uploaded media, streamed back through the Worker at MEDIA_URL");
  p("  // (no public bucket). Create it: `wrangler r2 bucket create <name>-media`.");
  p(`  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": ${JSON.stringify(`${key}-media`)} }],`);
  p("  // Cloudflare Images: the media route reads upload dimensions + backs server-");
  p("  // side re-encode. Also @astrojs/cloudflare's production image service.");
  p('  "images": { "binding": "IMAGES" },');
  p("  // Analytics Engine: real-visitor Core Web Vitals. Free, and the ingest");
  p("  // route accepts-and-drops without it, so it costs nothing unused. Reading");
  p("  // the p75 back out needs CF_ACCOUNT_ID + CF_API_TOKEN (see .env.example) —");
  p("  // until those are real the Health badge reads 'not measured yet'.");
  p(
    `  "analytics_engine_datasets": [{ "binding": ${JSON.stringify(ASTROID_VITALS_BINDING)}, "dataset": ${JSON.stringify(astroidVitalsDataset(config))} }],`,
  );
  p("  // Workers AI. Powers the editor's rewrite + SEO-suggest buttons and alt-text");
  p("  // generation on upload — all of which SHIP IN THE EDITOR DRAWER already and,");
  p("  // without this binding, were permanently invisible: their routes answer 503");
  p("  // and the client hides the button. No account setup beyond the binding, and");
  p("  // every call is editor-gated, so a visitor can never spend your AI budget.");
  p('  "ai": { "binding": "AI" },');
  p("  // KV: RL = the security rate limiter (it also holds the daily site-health");
  p("  // summary under its own key — one small singleton blob, not worth a binding");
  p("  // someone has to remember to provision); DRAFTS = the autosave write-buffer.");
  p("  // Create each: `wrangler kv namespace create <RL|DRAFTS>`.");
  p('  "kv_namespaces": [');
  p('    { "binding": "RL", "id": "<run: wrangler kv namespace create RL>" },');
  p('    { "binding": "DRAFTS", "id": "<run: wrangler kv namespace create DRAFTS>" },');
  p("  ],");
  // Email Sending. NOT optional decoration: `src/env.d.ts` declares EMAIL as a
  // required member, and Better Auth's magic-link path console-logs the link in
  // dev but calls `env.EMAIL.send(...)` unconditionally in production. Without
  // this binding that call is a TypeError on a binding that was never created —
  // so sign-in was impossible on every DEPLOYED site, while every local build
  // and every CI scaffold passed. Nothing in this repo runs a deployed scaffold,
  // which is why it survived.
  p("  // Cloudflare Email Sending — magic-link sign-in + inquiry notifications.");
  p("  // Sign-in DEPENDS on this: in production the magic link is emailed, not logged.");
  p("  // Enable Email Sending for your zone, then verify the address in MAIL_FROM.");
  p('  "send_email": [{ "name": "EMAIL" }],');
  p("  // Public base for media URLs; same-origin keeps media self-contained. Read off");
  p("  // the runtime env by the framework-agnostic media route, so it stays a `var`.");
  p('  "vars": {');
  p(`    "MEDIA_URL": ${JSON.stringify(mediaBase)},`);
  p(
    `    "SITE_URL": ${JSON.stringify(primaryHost ? `https://${primaryHost}` : `https://${key}.workers.dev`)},`,
  );
  p("    // The editor allowlist / owner. Wire this into your auth seam (src/auth.ts).");
  p('    "OWNER_EMAIL": "",');
  p("    // Edge caching for published pages (ADR 0004). OFF by default, and the");
  p("    // default is the safe state: with it off every render is `no-store` and");
  p("    // the Worker cache layer stores nothing.");
  p("    //");
  p("    // Turn it on for a PREVIEW deploy first and walk the activation runbook");
  p("    // (docs/adr/0004-edge-caching.md). `caches.default` is not cleared by");
  p("    // Cloudflare Dev Mode or Purge Everything, so a bad prod flip is hard to");
  p("    // undo — this feature was reverted twice for exactly that.");
  p('    "ASTROID_EDGE_CACHE": "false",');
  for (const v of astroidCheckoutVars(config)) {
    // Public, not secret — the app id ships to the browser to mount the card
    // field, and the environment is a choice. Keeping them out of the secret
    // roster also keeps them out of the dormancy gate, which asks whether we can
    // safely CALL Square, not whether a card field can render.
    p(`    ${JSON.stringify(v.name)}: ${JSON.stringify(v.value)},`);
  }
  p("  },");
  // Secrets are NOT vars: they belong in .dev.vars locally and in `wrangler
  // secret put` / Secrets Store when deployed. Listing the names here is
  // deliberate — this is the file someone opens when provisioning, and the list
  // is generated from the same declaration the runtime dormancy gate reads.
  const secretNames = commerceSecretNames(config.commerce);
  if (secretNames.length > 0) {
    p("  // Commerce secrets — set OUTSIDE this file (it's committed):");
    p("  //   local:    .dev.vars (see .env.example, seeded with DUMMY_REPLACE_ME)");
    p("  //   deployed: `wrangler secret put <NAME>`, or a Secrets Store binding");
    p("  // Until each is real, commerce stays dormant: the D1 mirror serves, the");
    p("  // webhook receiver answers 503, and nothing calls the provider.");
    for (const name of secretNames) p(`  //   ${name}`);
  }
  p('  "observability": { "enabled": true },');
  p("}");
  p();

  return lines.join("\n");
}
