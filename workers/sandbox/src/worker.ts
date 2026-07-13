// Playground worker (sandbox.louisetoolkit.com). One POST route takes a REAL
// Square sandbox payment and sends a REAL confirmation email; everything else
// falls through to Astro SSR. Isolated bindings (own D1/KV/EMAIL) + a per-IP
// rate limit + a nightly reset keep this public, write-capable surface safe.
import { handle } from "@astrojs/cloudflare/handler";
import { createPayment } from "louise/commerce/square";
import { db } from "louise/db";
import { sendEmail } from "louise/email";
import { composeWorker, type WorkerRoute } from "louise/worker";
import { demoOrders } from "./schema.js";

type Env = CloudflareEnv;

// The one demo product — priced on the SERVER so the client can't set the amount
// (the rule holds even in a sandbox). Square test cards approve this for free.
const DEMO = { name: "Cortado", amountCents: 450, currency: "USD" as const };

// Abuse control: cap pay+email attempts per IP per day. Counter lives in KV with
// a 24h TTL, so it also self-clears (the nightly reset is belt-and-suspenders).
const RATE_LIMIT_PER_DAY = 8;

async function rateLimited(env: Env, ip: string): Promise<boolean> {
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const count = Number((await env.RL.get(key)) ?? "0");
  if (count >= RATE_LIMIT_PER_DAY) return true;
  await env.RL.put(key, String(count + 1), { expirationTtl: 86_400 });
  return false;
}

function confirmationEmail(paymentId: string): { subject: string; html: string } {
  const amount = `$${(DEMO.amountCents / 100).toFixed(2)}`;
  return {
    subject: `Your Louise sandbox order — ${DEMO.name}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px">
      <h1 style="font-size:20px">Order confirmed ✓</h1>
      <p>Thanks for kicking the wheels on the Louise Toolkit sandbox.</p>
      <table style="margin:16px 0;font-size:14px">
        <tr><td style="color:#666;padding:2px 12px 2px 0">Item</td><td>${DEMO.name}</td></tr>
        <tr><td style="color:#666;padding:2px 12px 2px 0">Amount</td><td>${amount}</td></tr>
        <tr><td style="color:#666;padding:2px 12px 2px 0">Payment</td><td>${paymentId}</td></tr>
      </table>
      <p style="color:#888;font-size:12px">This was a Square <b>sandbox</b> payment — no real
        money moved, and this email was sent by louise/email over Cloudflare Email Sending.</p>
    </div>`,
  };
}

// POST /api/checkout { sourceId, email, verificationToken? }
const checkoutRoute: WorkerRoute<Env> = async (request, env) => {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/checkout") return undefined;

  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  if (await rateLimited(env, ip)) {
    return Response.json({ error: "Rate limit reached — try again tomorrow." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    sourceId?: string;
    email?: string;
    verificationToken?: string;
  } | null;
  const sourceId = body?.sourceId;
  const email = body?.email?.trim();
  if (!sourceId) return Response.json({ error: "Missing card token." }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email." }, { status: 422 });
  }

  // Real Square sandbox charge.
  let payment: { id: string; status: string };
  try {
    payment = await createPayment(
      { accessToken: env.SQUARE_TOKEN, environment: env.SQUARE_ENV },
      {
        sourceId,
        locationId: env.SQUARE_LOCATION,
        amountMoney: { amount: DEMO.amountCents, currency: DEMO.currency },
        verificationToken: body?.verificationToken,
        buyerEmailAddress: email,
      },
    );
  } catch (cause) {
    return Response.json({ error: `Payment failed: ${(cause as Error).message}` }, { status: 502 });
  }

  await db(env.SANDBOX_DB).insert(demoOrders).values({
    email,
    paymentId: payment.id,
    amountCents: DEMO.amountCents,
    status: payment.status,
    createdAt: Date.now(),
  });

  // Real confirmation email. A send failure must not fail an already-taken
  // payment, so report it rather than throw.
  let emailed = true;
  try {
    const { subject, html } = confirmationEmail(payment.id);
    await sendEmail(env.EMAIL, { from: env.FROM_EMAIL, to: email, subject, html });
  } catch {
    emailed = false;
  }

  return Response.json({ status: payment.status, paymentId: payment.id, emailed });
};

export default composeWorker<Env>({
  routes: [checkoutRoute],
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
