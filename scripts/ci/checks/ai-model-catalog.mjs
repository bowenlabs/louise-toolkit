// Every default Workers AI model the toolkit names must still be in the catalog,
// with no retirement date.
//
// The AI helpers are best-effort, so when Workers AI retired the old Llama 3.1
// text default, every call came back as a plain "unavailable" and only a
// person debugging found the cause (docs/LESSONS.md, "A retired AI model looks
// like a generic 502"). This asks the catalog directly, on a schedule, so the
// next retirement fails a job weeks ahead instead of a site in production.
//
// The defaults are read from source, every `export const DEFAULT_…_MODEL`
// under `core/ai`, so a new default is checked without editing this file.
//
// Needs a Cloudflare API token with Workers AI Read, and the account ID:
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/ci/checks/ai-model-catalog.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = "packages/louise/src/core/ai";
const DEFAULT = /export const (DEFAULT_\w+_MODEL)\s*=\s*"([^"]+)"/g;

const defaults = [];
for (const file of fs.readdirSync(ROOT, { recursive: true })) {
  if (!String(file).endsWith(".ts")) continue;
  const full = path.join(ROOT, String(file));
  for (const [, name, model] of fs.readFileSync(full, "utf8").matchAll(DEFAULT)) {
    defaults.push({ name, model, file: full });
  }
}
if (defaults.length === 0) {
  console.error(`ai-model-catalog: no DEFAULT_…_MODEL constants found under ${ROOT}.`);
  process.exit(1);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  const message =
    "ai-model-catalog: set CLOUDFLARE_API_TOKEN (Workers AI Read) and CLOUDFLARE_ACCOUNT_ID.";
  // A pull request from a fork gets no secrets. Say so, and leave the verdict
  // to the scheduled run, which always has them.
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    console.log(`::warning::${message} Skipped.`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

/** The catalog entry named exactly `model`, or `undefined`. */
async function lookup(model) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/models/search`);
  url.searchParams.set("search", model);
  url.searchParams.set("per_page", "100");
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const errors = body?.errors?.map((e) => e.message).join("; ") ?? response.statusText;
    throw new Error(`catalog search for ${model} failed: HTTP ${response.status}, ${errors}`);
  }
  return body.result.find((entry) => entry.name === model);
}

const failures = [];
for (const { name, model, file } of defaults) {
  const entry = await lookup(model);
  if (!entry) {
    failures.push(`${name} (${file}): ${model} isn't in the Workers AI catalog.`);
    continue;
  }
  const retires = entry.properties?.find((p) => p.property_id === "planned_deprecation_date");
  if (retires) {
    failures.push(`${name} (${file}): ${model} is set to retire on ${retires.value}.`);
    continue;
  }
  console.log(`ok  ${name}: ${model}`);
}

if (failures.length > 0) {
  console.error("\nA default Workers AI model is retired or retiring. Pick a replacement,");
  console.error("measure it, and ship the new default before the date:\n");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
