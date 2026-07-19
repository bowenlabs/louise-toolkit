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

import type { AstroidConfig } from "../config.js";
import {
  ASTROID_QUEUE_BINDING,
  astroidCron,
  astroidQueueNames,
  astroidUsesQueues,
} from "../queues/messages.js";
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
  if (astroidUsesQueues(config)) {
    const { queue, dlq } = astroidQueueNames(config);
    const cron = astroidCron(config);
    if (cron) {
      p("  // Cron safety net: re-sync on a schedule so a missed or DLQ'd webhook");
      p("  // can only leave the site stale until the next tick.");
      p(`  "triggers": { "crons": [${JSON.stringify(cron)}] },`);
    }
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
  p("  // KV: RL = the security rate limiter; DRAFTS = the autosave write-buffer.");
  p("  // Create each: `wrangler kv namespace create <RL|DRAFTS>`.");
  p('  "kv_namespaces": [');
  p('    { "binding": "RL", "id": "<run: wrangler kv namespace create RL>" },');
  p('    { "binding": "DRAFTS", "id": "<run: wrangler kv namespace create DRAFTS>" },');
  p("  ],");
  p("  // Public base for media URLs; same-origin keeps media self-contained. Read off");
  p("  // the runtime env by the framework-agnostic media route, so it stays a `var`.");
  p('  "vars": {');
  p(`    "MEDIA_URL": ${JSON.stringify(mediaBase)},`);
  p(
    `    "SITE_URL": ${JSON.stringify(primaryHost ? `https://${primaryHost}` : `https://${key}.workers.dev`)},`,
  );
  p("    // The editor allowlist / owner. Wire this into your auth seam (src/auth.ts).");
  p('    "OWNER_EMAIL": "",');
  p("  },");
  p('  "observability": { "enabled": true },');
  p("}");
  p();

  return lines.join("\n");
}
