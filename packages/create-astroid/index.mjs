#!/usr/bin/env node
// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `create-astroid` — scaffold a new Astroid site in one command:
//
//   pnpm create astroid@latest my-site
//   pnpm create astroid@latest my-site --key coracle --name "Coracle Coffee" --color "#1f6f78" --host coracle.coffee
//
// It writes the floor: the `defineAstroid` config, the generated
// schema/worker/middleware trio + wrangler.jsonc (via astroidjs), the Better Auth
// migration (via louise-toolkit/auth), and the baseline Astro app from ./template.
// Binding ids are placeholders — provision them, then `astroid deploy` (or
// wrangler) fills them in. The generators are the SAME ones `astroid generate`
// uses, so a fresh project is already in sync.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  ASTROID_ARCHETYPE_SECTIONS,
  ASTROID_MAP_DEPENDENCIES,
  defineAstroid,
  generateAstroidEnvBindings,
  generateAstroidPortalLocals,
  generateAstroidProject,
  generateAstroidCheckoutEnv,
  generateAstroidRealtimeEnv,
  generateAstroidScaffoldFiles,
  generateAstroidSecretsEnv,
  generateAstroidWrangler,
} from "astroidjs";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "template");

// Files (and dirs) whose leading `_` is stripped on copy (npm strips real
// dotfiles from a published package, so they ship as `_gitignore` /
// `_env.example` / `_github/…`). Applied per entry in `copyTemplate`, so a
// directory renames too — `_github` becomes `.github` and its contents follow.
const DOTFILE_RENAMES = {
  _gitignore: ".gitignore",
  "_env.example": ".env.example",
  _github: ".github",
};

// Archetype → default editable home sections. Imported from astroidjs rather
// than duplicated here: as a literal in this file it could name a section that
// doesn't exist and nothing would say so (it did — `marquee`, `featured`,
// `story`, and `visit` had no component for months). Over there it's typed
// against the section catalog, so a stale name fails the build. See #277.
const ARCHETYPE_SECTIONS = ASTROID_ARCHETYPE_SECTIONS;
const ARCHETYPES = Object.keys(ARCHETYPE_SECTIONS);

// Commerce backends astroidjs knows how to wire (webhook verifier + catalog
// event filter). Opt-in via `--commerce`; it also switches on the queue
// consumer, the webhook receiver, and the cron safety net.
const COMMERCE_PROVIDERS = ["square", "stripe", "fourthwall"];

// --- args ------------------------------------------------------------------
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else flags[key] = argv[++i];
    } else positionals.push(a);
  }
  return { flags, positionals };
}

const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// --- toolkit versions ------------------------------------------------------

/**
 * The `astroidjs` + `louise-toolkit` ranges to write into the scaffold.
 *
 * DERIVED from this package's own resolved dependencies rather than hard-coded
 * in template/package.json. A literal there is a second place to remember on
 * every release, and when it rots the failure is silent and total: the template
 * imported `astroidjs/astro` while pinning `^0.1.0`, a range whose newest match
 * had no such export, so every scaffolded project died before Astro loaded its
 * config. CI could not see it — the clean-room smoke test pins both packages to
 * tarballs via pnpm `overrides`, which is exactly what erases these ranges.
 *
 * `pnpm pack` rewrites `workspace:*` to the concrete version, so in a PUBLISHED
 * create-astroid the declared dep is already exact and we just widen it to a
 * caret. Run from the workspace it is still `workspace:*`, so fall back to the
 * version of the copy actually resolved on disk — which is what the scaffold
 * would install anyway.
 *
 * Caret on a 0.x is minor-locked (`^0.2.0` := `>=0.2.0 <0.3.0`), which is the
 * behaviour we want while the toolkit is pre-1.0 and marks breaking changes as
 * minors: patches flow, a breaking minor does not.
 */
function toolkitRanges() {
  const req = createRequire(import.meta.url);
  const self = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const ranges = {};
  for (const name of ["astroidjs", "louise-toolkit"]) {
    const declared = self.dependencies?.[name];
    let version = declared && !declared.startsWith("workspace:") ? declared : undefined;
    if (!version) {
      // Both packages export `./package.json`, so this resolves the real copy.
      version = JSON.parse(readFileSync(req.resolve(`${name}/package.json`), "utf8")).version;
    }
    if (!version) {
      throw new Error(
        `create-astroid could not determine the ${name} version to scaffold with. ` +
          "This is a packaging fault — please file an issue rather than editing the scaffold by hand.",
      );
    }
    ranges[name] = `^${version}`;
  }
  return ranges;
}

async function prompt(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question}${fallback ? ` (${fallback})` : ""}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

// --- scaffold --------------------------------------------------------------
function copyTemplate(srcDir, destDir, tokens) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const renamed = DOTFILE_RENAMES[entry] ?? entry;
    const dest = join(destDir, renamed);
    if (statSync(src).isDirectory()) {
      copyTemplate(src, dest, tokens);
    } else {
      const raw = readFileSync(src, "utf8");
      writeFileSync(dest, applyTokens(raw, tokens));
    }
  }
}

function applyTokens(text, tokens) {
  return text.replace(/__([A-Z0-9_]+)__/g, (m, key) => (key in tokens ? tokens[key] : m));
}

function astroidConfigSource(config) {
  const parts = [
    'import { defineAstroid } from "astroidjs";',
    "",
    "// The whole shape of this site — one typed config. `astroid generate` (run by",
    "// `astroid dev`/`build`) turns it into src/schema.ts, src/worker.ts, and",
    "// src/middleware.ts; `astroid doctor` keeps them honest.",
    "export default defineAstroid({",
    `  key: ${JSON.stringify(config.key)},`,
    `  archetype: ${JSON.stringify(config.archetype)},`,
    ...(config.hosts?.length ? [`  hosts: ${JSON.stringify(config.hosts)},`] : []),
    "  theme: {",
    `    name: ${JSON.stringify(config.theme.name)},`,
    `    colors: { brand: ${JSON.stringify(config.theme.colors.brand)} },`,
    "  },",
    `  sections: ${JSON.stringify(config.sections)},`,
    ...(config.commerce
      ? [`  commerce: { provider: ${JSON.stringify(config.commerce.provider)} },`]
      : []),
    // Must be emitted, for the same reason the portal is: `astroid generate`
    // rebuilds the middleware and CSP from THIS file, so a config that dropped
    // `modules` would regenerate a project missing whatever they contribute —
    // for the map, a policy without `worker-src blob:`, which renders an empty
    // canvas with no obvious cause.
    ...(config.modules?.length ? [`  modules: ${JSON.stringify(config.modules)},`] : []),
    // Must be emitted: `astroid generate` rebuilds the middleware from THIS
    // file, so a config that omitted the portal would regenerate a middleware
    // with no guard while src/portal-auth.ts sat there unused. And the FULL shape
    // (tablePrefix, signUp) — not a bare `{ enabled: true }` — so a regenerate
    // reproduces the SAME unprefixed `user`/`session` seam the 0002_portal_auth
    // migration created, rather than defaulting the prefix back to `portal_`.
    ...(config.portal?.enabled
      ? [
          "  portal: {",
          "    enabled: true,",
          ...(config.portal.tablePrefix !== undefined
            ? [`    tablePrefix: ${JSON.stringify(config.portal.tablePrefix)},`]
            : []),
          ...(config.portal.signUp !== undefined
            ? [`    signUp: ${JSON.stringify(config.portal.signUp)},`]
            : []),
          "  },",
        ]
      : []),
    '  deploy: { platform: "cloudflare" },',
    "});",
    "",
  ];
  return parts.join("\n");
}

function write(destDir, relPath, contents) {
  const abs = join(destDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

const USAGE = `Scaffold a new Astroid site — an editable Astro app on Cloudflare Workers.

Usage:
  pnpm create astroid [directory] [options]

Options:
  --dir <path>          Target directory (also accepted as the first positional)
  --name <name>         Brand / site name
  --key <slug>          Project key (slug); defaults to a slug of --name
  --archetype <type>    ${ARCHETYPES.join(" | ")}   (default: marketing)
  --color <hex>         Brand color (default: #5b4bff)
  --host <domain>       Primary domain, e.g. example.com
  --commerce <provider> ${COMMERCE_PROVIDERS.join(" | ")}
                        Also adds the queue consumer, webhook receiver, and cron
  --map                 Add the self-hosted PMTiles/MapLibre location map
  --pwa                 Add an installable PWA: a scoped service worker that
                        never caches /api/* or the editor, plus a manifest
  --realtime            Add live multi-editor editing: a per-page Durable Object
                        with presence, field sync, and a rich-text soft-lock
  --portal              Add a customer/member portal: a second, isolated auth
                        instance plus role-gated routes
  -h, --help            Show this help
  -v, --version         Show the create-astroid version

Anything not passed as a flag is prompted for; in a non-TTY every prompt takes
its default, so the command is CI-safe. The target directory must be empty.
`;

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positionals } = parseArgs(argv);

  // Handle these before any prompting — otherwise `--help` reads as a truthy
  // flag and drops the user into the interactive scaffold instead. The short
  // forms are read off argv directly: parseArgs only treats `--` as a flag, so
  // a bare `-h` would otherwise be taken as the target directory.
  if (flags.help || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  if (flags.version || argv.includes("-v")) {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const dirArg = positionals[0] ?? flags.dir;
  const rawName = flags.name || (dirArg ? basename(resolve(dirArg)) : undefined);
  const name = await prompt("Brand / site name", rawName || "My Astroid Site");
  const key = slugify(flags.key || (await prompt("Project key (slug)", slugify(name) || "my-site")));
  const dir = resolve(dirArg || (await prompt("Directory", key)) || key);
  const archetypeRaw = (flags.archetype || (await prompt(`Archetype (${ARCHETYPES.join("/")})`, "marketing"))).toLowerCase();
  const archetype = ARCHETYPES.includes(archetypeRaw) ? archetypeRaw : "marketing";
  const color = flags.color || (await prompt("Brand color (hex)", "#5b4bff"));
  const host = flags.host && flags.host !== true ? flags.host : undefined;
  // The customer PORTAL is opt-in via --portal, but a storefront IMPLIES one — a
  // shop has customers who sign in, reorder, and track orders — so enable it there
  // by default. (Commerce below stays opt-in: infra a marketing site shouldn't carry.)
  const portal =
    flags.portal === true || flags.portal === "true" || archetype === "storefront";
  // The map module is opt-in and pulls real weight (maplibre-gl is ~1 MB), so
  // it is never on by default.
  const map = flags.map === true || flags.map === "true";
  // Opt-in: a service worker is a caching layer over a CMS-edited site, so it
  // is never on unless asked for.
  const pwa = flags.pwa === true || flags.pwa === "true";
  // Opt-in: realtime provisions a Durable Object, which is real infrastructure a
  // single-editor site has no use for.
  const realtime = flags.realtime === true || flags.realtime === "true";
  const modules = [
    ...(map ? ["map"] : []),
    ...(pwa ? ["pwa"] : []),
    ...(realtime ? ["realtime"] : []),
  ];
  // Commerce is opt-in and unprompted: it pulls in a queue consumer, a webhook
  // receiver, and a cron, none of which a plain marketing site should carry.
  const commerceRaw = typeof flags.commerce === "string" ? flags.commerce.toLowerCase() : undefined;
  const commerce = COMMERCE_PROVIDERS.includes(commerceRaw) ? commerceRaw : undefined;
  if (commerceRaw && !commerce) {
    process.stderr.write(
      `create-astroid: unknown --commerce provider "${commerceRaw}" (expected ${COMMERCE_PROVIDERS.join(" | ")})\n`,
    );
    process.exit(1);
  }

  if (existsSync(dir) && readdirSync(dir).length > 0) {
    process.stderr.write(`create-astroid: target directory is not empty: ${dir}\n`);
    process.exit(1);
  }

  // Validate + normalize through the real config surface (throws on a bad shape).
  const config = defineAstroid({
    key,
    archetype,
    ...(host ? { hosts: [host] } : {}),
    theme: { name, colors: { brand: color } },
    sections: ARCHETYPE_SECTIONS[archetype],
    ...(commerce ? { commerce: { provider: commerce } } : {}),
    // Unprefixed `user`/`session` (customers — email + password), so the studio's
    // `louise_`-prefixed tables and the portal's never collide (mirrors the
    // reference storefront). `signUp: true` because a shop lets customers register.
    ...(portal ? { portal: { enabled: true, tablePrefix: "", signUp: true } } : {}),
    // ONE array, built from every enabled flag. Two separate `...(x ? {modules}
    // : {})` spreads would let the later one overwrite the earlier, silently
    // dropping a module whenever both were passed.
    ...(modules.length > 0 ? { modules } : {}),
    deploy: { platform: "cloudflare" },
  });

  const siteUrl = host ? `https://${host}` : `https://${key}.workers.dev`;
  const envBindings = generateAstroidEnvBindings(config);
  const portalLocals = generateAstroidPortalLocals(config);
  // The realtime DO namespace, or nothing — same rule as the queue bindings: a
  // declaration is a promise, so never type a binding wrangler.jsonc won't create.
  const realtimeEnv = generateAstroidRealtimeEnv(config);
  // The Square Web Payments public vars, or nothing.
  const checkoutEnv = generateAstroidCheckoutEnv(config);
  const tokens = {
    KEY: key,
    BRAND_NAME: name,
    BRAND_COLOR: color,
    ARCHETYPE: archetype,
    SITE_URL: siteUrl,
    // Extra CloudflareEnv members the queue pipeline needs, or nothing. A
    // declaration is a promise — a marketing site must not claim a binding its
    // wrangler.jsonc never creates.
    ASTROID_ENV_BINDINGS: [envBindings, realtimeEnv, checkoutEnv].filter(Boolean).join("\n")
      ? `\n${[envBindings, realtimeEnv, checkoutEnv].filter(Boolean).join("\n")}`
      : "",
    // The portal session on App.Locals, or nothing — a project that types a
    // local it never sets invites a null-check nobody needs.
    ASTROID_PORTAL_LOCALS: portalLocals ? `\n${portalLocals}` : "",
    // Placeholder-seeded secrets for whichever modules this project enabled, so
    // a fresh clone has a COMPLETE binding set that all reads as unconfigured —
    // every module takes its dormant path deliberately rather than tripping over
    // an undefined binding. Empty for a project with no credentialed module.
    ASTROID_MODULE_SECRETS: generateAstroidSecretsEnv(config),
  };

  // 1. The static floor (Astro app, auth seam, config files) with tokens filled.
  copyTemplate(TEMPLATE_DIR, dir, tokens);

  // 1b. Toolkit versions + module dependencies, merged into the copied package.json.
  //
  //     Merged by PARSING the file rather than substituting a token into it:
  //     a `__TOKEN__` inside a JSON object makes template/package.json invalid
  //     JSON, and everything that scans a repo for manifests — Snyk, Dependabot,
  //     editors, workspace tooling — parses it and fails. (It did.)
  //
  //     The `astroidjs` / `louise-toolkit` ranges are DERIVED (see
  //     `toolkitRanges`), never taken from template/package.json — a hand-written
  //     range there silently rots into a scaffold that can't build. The literals
  //     it still carries are placeholders that keep the file valid JSON.
  //
  //     Only the enabled modules contribute the rest: nobody installs a megabyte
  //     of mapping library for a site with no map.
  const extraDeps = { ...toolkitRanges(), ...(map ? ASTROID_MAP_DEPENDENCIES : {}) };
  {
    const pkgPath = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.dependencies = Object.fromEntries(
      Object.entries({ ...pkg.dependencies, ...extraDeps }).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // 2. The typed config the generators + the app read.
  write(dir, "astroid.config.ts", astroidConfigSource(config));

  // 3. The generated trio + the scaffold-once wrangler.jsonc (astroidjs).
  for (const file of generateAstroidProject(config)) write(dir, file.path, file.contents);
  write(dir, "wrangler.jsonc", generateAstroidWrangler(config));

  // 3b. Every scaffold-once module file this config implies — the queue seam and
  //     webhook receivers, the portfolio gallery page, the PWA service worker +
  //     manifest + headers, the map tile route + embed, the portal's second auth
  //     instance and its mounted catch-all.
  //
  //     ONE list, imported from astroidjs, because `astroid generate` writes the
  //     same files when a config gains a module after scaffold. Hand-listing them
  //     here was the only way to produce them, so editing the config — the entire
  //     premise of the framework — regenerated a trio importing `./queue.js` and
  //     `./portal-auth.js` that nothing had written, and `astroid doctor` called
  //     it healthy. Sharing the list is what keeps the two paths honest.
  for (const file of generateAstroidScaffoldFiles(config)) {
    if (file.apply === "append-once") {
      // `public/_headers` accumulates a stanza per module rather than being owned
      // by one, so append instead of overwriting a sibling module's block.
      const abs = join(dir, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      const current = existsSync(abs) ? readFileSync(abs, "utf8") : "";
      if (file.marker && current.includes(file.marker)) continue;
      writeFileSync(abs, current + file.contents);
      continue;
    }
    write(dir, file.path, file.contents);
  }

  // 4. The Better Auth migration (louise-toolkit) — auth tables are fenced out of
  //    drizzle-kit, so they're generated rather than diffed from schema.ts. Loaded
  //    dynamically: it pulls in `better-auth` (an optional peer), which may not be
  //    resolvable at scaffold time. If not, leave a stub + a one-liner to generate
  //    it after install (the project has `louise` on its path then).
  let authMigrationOk = false;
  try {
    const { generateAuthSchemaSql } = await import("louise-toolkit/auth");
    // The EDITOR instance's tables — `louise_`-prefixed (the editor convention),
    // leaving the unprefixed `user`/`session` names free for a second/portal
    // instance. Must match the `tablePrefix` in src/auth.ts and the `louise_user`
    // table the generated `editorsRoute` reads.
    write(dir, "migrations/0001_auth.sql", generateAuthSchemaSql({ tablePrefix: "louise_" }));
    // The portal's own auth tables — a SECOND Better Auth instance sharing one D1
    // but never a row, so a portal account can't sign into the studio and an
    // editor doesn't appear in the portal. `customers: true` (email + password)
    // and the config's tablePrefix, so this schema matches the scaffolded
    // portal-auth.ts exactly. Without this migration the portal builds fine and
    // fails on the first sign-in with a missing table.
    if (config.portal?.enabled) {
      write(
        dir,
        "migrations/0002_portal_auth.sql",
        generateAuthSchemaSql({ customers: true, tablePrefix: config.portal.tablePrefix ?? "" }),
      );
    }
    authMigrationOk = true;
  } catch {
    write(
      dir,
      "migrations/0001_auth.sql",
      "-- Better Auth tables (editor, louise_ prefix) — generate after install:\n--   pnpm exec louise gen-auth-schema --table-prefix louise_ --out migrations/0001_auth.sql\n",
    );
    // Same stub for the portal's prefixed set. Without it a portal scaffold
    // looks complete, builds, and fails on the first sign-in with a missing
    // table — the one failure mode a stub exists to prevent.
    if (config.portal?.enabled) {
      write(
        dir,
        "migrations/0002_portal_auth.sql",
        "-- Portal Better Auth tables (customers, unprefixed) — generate after install:\n" +
          "--   pnpm exec louise gen-auth-schema --out migrations/0002_portal_auth.sql\n",
      );
    }
  }

  const rel = dir === process.cwd() ? "." : basename(dir);
  process.stdout.write(
    [
      "",
      `✓ Scaffolded ${name} → ${rel}`,
      "",
      "Next steps:",
      `  cd ${rel}`,
      "  pnpm install",
      // The auth-migration fallback belongs HERE, in sequence, not in a note
      // printed after the list. It has to run before `d1 migrations apply`, and
      // a correction that appears below an ordered list is a correction most
      // people execute the list without reading: the stub left no `user` table,
      // so `seed:editors` failed with `no such table: user` and the very first
      // instruction anyone follows was the one that broke.
      ...(authMigrationOk
        ? []
        : [
            "  # generate the Better Auth migration (it could not be written at scaffold",
            "  # time — `louise` is on your path once the install above finishes):",
            "  pnpm exec louise gen-auth-schema --table-prefix louise_ --out migrations/0001_auth.sql",
            ...(config.portal?.enabled
              ? [
                  "  pnpm exec louise gen-auth-schema --table-prefix portal_ \\",
                  "    --out migrations/0002_portal_auth.sql",
                ]
              : []),
          ]),
      "  # provision the Cloudflare bindings, then fill the ids in wrangler.jsonc:",
      "  wrangler d1 create " + key,
      "  wrangler r2 bucket create " + key + "-media",
      "  wrangler kv namespace create RL && wrangler kv namespace create DRAFTS",
      "  # apply migrations, seed the home page + your first editor:",
      "  wrangler d1 migrations apply DB --remote",
      "  wrangler d1 execute DB --remote --file seed/home.seed.sql",
      "  OWNER_EMAIL=you@example.com pnpm seed:editors",
      "  # develop / ship:",
      "  pnpm dev            # astroid dev (regenerates, then astro dev)",
      "  pnpm doctor         # validate config + bindings",
      "  wrangler deploy",
      "",
    ].join("\n"),
  );
  if (!authMigrationOk) {
    process.stdout.write(
      "Note: the Better Auth migration is a stub — the `gen-auth-schema` step above\n" +
        "fills it in. Skipping it leaves no `user` table, and `seed:editors` will fail.\n\n",
    );
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
