#!/usr/bin/env node
// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `create-astroid` — scaffold a new Astroid site in one command:
//
//   npm create astroid@latest my-site
//   npm create astroid@latest my-site -- --key coracle --name "Coracle Coffee" --color "#1f6f78" --host coracle.coffee
//
// It writes the floor: the `defineAstroid` config, the generated
// schema/worker/middleware trio + wrangler.jsonc (via astroidjs), the Better Auth
// migration (via louise-toolkit/auth), and the baseline Astro app from ./template.
// Binding ids are placeholders — provision them, then `astroid deploy` (or
// wrangler) fills them in. The generators are the SAME ones `astroid generate`
// uses, so a fresh project is already in sync.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { defineAstroid, generateAstroidProject, generateAstroidWrangler } from "astroidjs";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "template");

// Files whose leading `_` is stripped on copy (npm strips real dotfiles from a
// published package, so they ship as `_gitignore` / `_env.example`).
const DOTFILE_RENAMES = { _gitignore: ".gitignore", "_env.example": ".env.example" };

// Archetype → default editable home sections, when the user doesn't override.
const ARCHETYPE_SECTIONS = {
  marketing: ["hero", "featureGrid", "cta", "contact"],
  storefront: ["hero", "marquee", "featured", "productGrid", "visit", "contact"],
  wholesale: ["hero", "featureGrid", "story", "contact"],
  portfolio: ["hero", "gallery", "story", "contact"],
};
const ARCHETYPES = Object.keys(ARCHETYPE_SECTIONS);

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

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2));

  const dirArg = positionals[0] ?? flags.dir;
  const rawName = flags.name || (dirArg ? basename(resolve(dirArg)) : undefined);
  const name = await prompt("Brand / site name", rawName || "My Astroid Site");
  const key = slugify(flags.key || (await prompt("Project key (slug)", slugify(name) || "my-site")));
  const dir = resolve(dirArg || (await prompt("Directory", key)) || key);
  const archetypeRaw = (flags.archetype || (await prompt(`Archetype (${ARCHETYPES.join("/")})`, "marketing"))).toLowerCase();
  const archetype = ARCHETYPES.includes(archetypeRaw) ? archetypeRaw : "marketing";
  const color = flags.color || (await prompt("Brand color (hex)", "#5b4bff"));
  const host = flags.host && flags.host !== true ? flags.host : undefined;

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
    deploy: { platform: "cloudflare" },
  });

  const siteUrl = host ? `https://${host}` : `https://${key}.workers.dev`;
  const tokens = {
    KEY: key,
    BRAND_NAME: name,
    BRAND_COLOR: color,
    ARCHETYPE: archetype,
    SITE_URL: siteUrl,
  };

  // 1. The static floor (Astro app, auth seam, config files) with tokens filled.
  copyTemplate(TEMPLATE_DIR, dir, tokens);

  // 2. The typed config the generators + the app read.
  write(dir, "astroid.config.ts", astroidConfigSource(config));

  // 3. The generated trio + the scaffold-once wrangler.jsonc (astroidjs).
  for (const file of generateAstroidProject(config)) write(dir, file.path, file.contents);
  write(dir, "wrangler.jsonc", generateAstroidWrangler(config));

  // 4. The Better Auth migration (louise-toolkit) — auth tables are fenced out of
  //    drizzle-kit, so they're generated rather than diffed from schema.ts. Loaded
  //    dynamically: it pulls in `better-auth` (an optional peer), which may not be
  //    resolvable at scaffold time. If not, leave a stub + a one-liner to generate
  //    it after install (the project has `louise` on its path then).
  let authMigrationOk = false;
  try {
    const { generateAuthSchemaSql } = await import("louise-toolkit/auth");
    write(dir, "migrations/0001_auth.sql", generateAuthSchemaSql());
    authMigrationOk = true;
  } catch {
    write(
      dir,
      "migrations/0001_auth.sql",
      "-- Better Auth tables — generate after install:\n--   npx louise gen-auth-schema --out migrations/0001_auth.sql\n",
    );
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
      "  # provision the Cloudflare bindings, then fill the ids in wrangler.jsonc:",
      "  wrangler d1 create " + key,
      "  wrangler r2 bucket create " + key + "-media",
      "  wrangler kv namespace create RL && wrangler kv namespace create DRAFTS",
      "  # apply migrations + seed your first editor:",
      "  wrangler d1 migrations apply DB --remote",
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
      "Note: generate the Better Auth migration after install:\n" +
        "  npx louise gen-auth-schema --out migrations/0001_auth.sql\n\n",
    );
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
