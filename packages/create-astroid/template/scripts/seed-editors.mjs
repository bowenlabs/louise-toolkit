#!/usr/bin/env node
// Seed the first editor(s) — an admin `user` row per OWNER_EMAIL / ENGINEER_EMAIL.
// A row here IS an editor and IS the magic-link allowlist, so this bootstraps
// access before anyone can sign in. Idempotent (INSERT OR IGNORE on unique email).
// After this, add more editors from the Users panel (never by editing env).
//
//   OWNER_EMAIL=you@example.com pnpm seed:editors            # seeds the remote D1
//   OWNER_EMAIL=you@example.com pnpm seed:editors --local    # seeds the local dev D1
//
// Mirrors the INSERT louise-toolkit's editorsRoute uses (ISO-string dates,
// emailVerified = 1, role 'admin').

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emails = [process.env.OWNER_EMAIL, process.env.ENGINEER_EMAIL]
  .map((e) => e?.trim().toLowerCase())
  .filter((e) => !!e);

if (emails.length === 0) {
  console.error("Set OWNER_EMAIL (optionally ENGINEER_EMAIL) first, e.g.:");
  console.error("  OWNER_EMAIL=you@example.com pnpm seed:editors");
  process.exit(1);
}
for (const email of emails) {
  if (!EMAIL_RE.test(email)) {
    console.error(`Refusing to seed a malformed email: ${email}`);
    process.exit(1);
  }
}

const target = process.argv.includes("--local") ? "--local" : "--remote";
const now = new Date().toISOString();

for (const email of emails) {
  const id = randomUUID();
  const name = email.split("@")[0];
  const sql =
    "INSERT OR IGNORE INTO user " +
    "(id, name, email, emailVerified, createdAt, updatedAt, role, firstName, lastName) VALUES " +
    `('${id}', '${name}', '${email}', 1, '${now}', '${now}', 'admin', NULL, NULL);`;
  console.log(`Seeding editor ${email} (${target}) …`);
  execFileSync("wrangler", ["d1", "execute", "DB", target, "--command", sql], { stdio: "inherit" });
}
console.log("Done — these emails can now request a magic-link sign-in.");
