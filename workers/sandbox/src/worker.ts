// Sandbox worker (sandbox.louisetoolkit.com). The checkout is an Astro endpoint
// (src/pages/api/checkout.ts) so astro:env resolves the Square secret + config;
// this entry is just the Astro SSR fallback plus a nightly reset cron that keeps
// this public, write-capable surface from retaining visitors' data.
import { handle } from "@astrojs/cloudflare/handler";
import { db } from "louise/db";
import { composeWorker } from "louise/worker";
import { demoOrders } from "./schema.js";

type Env = CloudflareEnv;

export default composeWorker<Env>({
  fetch: (request, env, ctx) => handle(request, env, ctx),
  // Nightly reset (06:00 UTC): drop demo orders so the sandbox starts fresh and
  // never retains visitors' email addresses. KV rate-limit keys expire on TTL.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        await db(env.SANDBOX_DB).delete(demoOrders);
        console.log("[sandbox-reset] demo_orders cleared");
      })(),
    );
  },
});
