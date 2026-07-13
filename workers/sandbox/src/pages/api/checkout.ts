// POST /api/checkout — takes a REAL Square sandbox payment and sends a REAL
// confirmation email. An Astro endpoint (not a raw worker route) so astro:env's
// server config + secret (SQUARE_TOKEN) resolve at runtime; Cloudflare bindings
// (EMAIL/D1/KV) come from `cloudflare:workers`. Priced server-side so the client
// can't set the amount; per-IP rate-limited; nightly-reset in worker.ts.
import { FROM_EMAIL, SQUARE_ENV, SQUARE_LOCATION, SQUARE_TOKEN } from "astro:env/server";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createPayment } from "louise/commerce/square";
import { db } from "louise/db";
import { sendEmail } from "louise/email";
import { demoOrders } from "../../schema.js";

export const prerender = false;

const bindings = env as unknown as CloudflareEnv;

// The one demo product — priced here on the SERVER (the rule holds even in a
// sandbox). Square test cards approve this for free.
const DEMO = { name: "Cortado", amountCents: 450, currency: "USD" as const };
const RATE_LIMIT_PER_DAY = 8;

async function rateLimited(ip: string): Promise<boolean> {
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const count = Number((await bindings.RL.get(key)) ?? "0");
  if (count >= RATE_LIMIT_PER_DAY) return true;
  await bindings.RL.put(key, String(count + 1), { expirationTtl: 86_400 });
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

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  if (await rateLimited(ip)) {
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

  if (!SQUARE_LOCATION || !SQUARE_TOKEN) {
    return Response.json({ error: "Sandbox not configured yet." }, { status: 503 });
  }

  // Real Square sandbox charge — config from astro:env/server.
  let payment: { id: string; status: string };
  try {
    payment = await createPayment(
      { accessToken: SQUARE_TOKEN, environment: SQUARE_ENV },
      {
        sourceId,
        locationId: SQUARE_LOCATION,
        amountMoney: { amount: DEMO.amountCents, currency: DEMO.currency },
        verificationToken: body?.verificationToken,
        buyerEmailAddress: email,
      },
    );
  } catch (cause) {
    return Response.json({ error: `Payment failed: ${(cause as Error).message}` }, { status: 502 });
  }

  await db(bindings.SANDBOX_DB).insert(demoOrders).values({
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
    await sendEmail(bindings.EMAIL, { from: FROM_EMAIL, to: email, subject, html });
  } catch {
    emailed = false;
  }

  return Response.json({ status: payment.status, paymentId: payment.id, emailed });
};
