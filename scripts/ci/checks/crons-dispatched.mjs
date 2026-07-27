// Every cron declared in wrangler.jsonc must be dispatched by the generated
// scheduled handler. Cloudflare fires ONE handler for all triggers and
// identifies which by `controller.cron`, so a string that appears in one and not
// the other is a job that silently never runs — no error, no log, just a scan or
// a re-sync that quietly stopped.
//
// Usage: node crons-dispatched.mjs <scaffold-dir>
import fs from "node:fs";

const scaffold = process.argv[2];
if (!scaffold) {
  console.error("usage: crons-dispatched.mjs <scaffold-dir>");
  process.exit(1);
}

const cfg = fs.readFileSync(`${scaffold}/wrangler.jsonc`, "utf8");
const worker = fs.readFileSync(`${scaffold}/src/worker.ts`, "utf8");

const crons = [
  ...(cfg.match(/"triggers":\s*\{\s*"crons":\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(
    /"([^"]+)"/g,
  ),
].map((m) => m[1]);

if (crons.length === 0) {
  console.error("no crons declared");
  process.exit(1);
}

let bad = 0;
for (const cron of crons) {
  if (!worker.includes(`controller.cron === "${cron}"`)) {
    console.error(`cron "${cron}" is declared but the handler never dispatches it`);
    bad++;
  }
}

if (bad) process.exit(1);
console.log(`all ${crons.length} cron(s) declared and dispatched: ${crons.join(", ")}`);
