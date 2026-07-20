// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The checkout SEAM — the piece that made `archetype: "storefront"` a storefront
// that couldn't take a card.
//
// Everything around this already existed: `verifyCheckout` re-prices server-side,
// `checkoutIdempotencyKey` dedupes a double-clicked Pay button, the rate rule on
// `/api/checkout` was in the middleware, `/checkout` and `/cart` were in the
// noindex list, and the CSP already allowed Square's Web Payments hosts. What was
// missing was the route in the middle, so none of it was reachable.
//
// SCOPE, deliberately narrow. This generates the server-authoritative PAYMENT
// path and a card input — not a cart, not a checkout page, not shipping or tax.
// Where a cart lives (localStorage, D1, a portal session), what it holds, and how
// it renders are project decisions Astroid has no business making, and a
// half-opinionated cart is worse than none. What is NOT a project decision is the
// order of operations that keeps a charge correct, and that is what lives here.
//
// Square only, for now, and named rather than pretended-generic: Fourthwall
// redirects to its own hosted checkout (no card token to charge) and Stripe has
// no catalog API, so it fills the `invoicing` role rather than `storefront`.

import type { AstroidConfig } from "../config.js";
import { astroidCatalogMirror } from "./mirror.js";
import { astroidCommerceRoles } from "./roles.js";

/** Does this project take card payments in-page? Square storefront only. */
export function usesCardCheckout(config: AstroidConfig): boolean {
  return astroidCommerceRoles(config.commerce).storefront === "square";
}

/**
 * `src/pages/api/checkout.ts` — the server-authoritative payment route.
 *
 * Scaffold-once: a real store adds shipping, tax, an order record, a receipt
 * email. What Astroid fixes is the sequence, because every step of it is a place
 * where getting it wrong costs money rather than throwing an error.
 *
 * Returns null unless this project takes card payments.
 */
export function generateAstroidCheckoutRoute(config: AstroidConfig): string | null {
  if (!usesCardCheckout(config)) return null;
  const { table } = astroidCatalogMirror(config);

  return [
    "// Server-authoritative checkout (POST /api/checkout).",
    "//",
    "// Scaffolded once and yours to extend — shipping, tax, an order row, a",
    "// receipt email all belong here. What should NOT change is the ORDER of the",
    "// steps below; each one is load-bearing:",
    "//",
    "//   1. Re-price every line from the D1 catalog mirror. The client's price is",
    "//      a STALENESS CHECK, never an input to the charge. Accept `unitPrice`",
    "//      from the request body and anyone can buy anything for a penny.",
    "//   2. Refuse on mismatch rather than charging the server's number silently.",
    "//      Being charged more than the page said is worse than being asked to",
    "//      review the cart.",
    "//   3. Derive the idempotency key from the verified cart AND the cart id, so",
    "//      a double-clicked Pay button charges once while two customers buying",
    "//      the same thing stay two charges.",
    "//   4. Charge only when commerce is actually provisioned. With placeholder",
    "//      secrets this simulates instead — it must never call Square with a",
    "//      dummy credential.",
    'import type { APIRoute } from "astro";',
    'import { env } from "cloudflare:workers";',
    "import {",
    "  checkoutIdempotencyKey,",
    "  readCatalog,",
    "  resolveCommerceStatus,",
    "  type SecretSource,",
    "  verifyCheckout,",
    "} from \"astroidjs\";",
    'import { createPayment } from "louise-toolkit/commerce/square";',
    'import { isSameOrigin } from "louise-toolkit/security";',
    'import astroidConfig from "../../../astroid.config.js";',
    "",
    "export const prerender = false;",
    "",
    "/** Server-side prices, in minor units, straight from the catalog mirror. */",
    "async function serverPrices(variantIds: string[]): Promise<Map<string, number>> {",
    "  // `readCatalog` returns the product ARRAY (published only by default).",
    "  const items = await readCatalog({",
    "    db: env.DB,",
    `    table: ${JSON.stringify(table)},`,
    "  });",
    "  const prices = new Map<string, number>();",
    "  for (const item of items) {",
    "    // The mirror stores MAJOR units (dollars); the charge is in minor units.",
    "    // `Math.round` is not decoration — 19.99 * 100 is 1998.9999999999998, and",
    "    // a float cent here fails the exact-equality staleness check on every",
    "    // single checkout.",
    "    if (variantIds.includes(item.externalId)) {",
    "      prices.set(item.externalId, Math.round(item.price * 100));",
    "    }",
    "  }",
    "  return prices;",
    "}",
    "",
    "const json = (body: unknown, status = 200) =>",
    "  new Response(JSON.stringify(body), {",
    "    status,",
    '    headers: { "content-type": "application/json" },',
    "  });",
    "",
    "export const POST: APIRoute = async ({ request }) => {",
    "  // Same-origin only. Checkout is the one public POST that moves money, so it",
    "  // gets the CSRF gate every other public write already has (the contact form,",
    "  // the vitals beacon): a cross-origin page must not be able to drive a charge",
    "  // or probe prices, even though the card token itself is single-use. Requires",
    "  // an Origin/Referer matching the host; a non-browser caller (a stripped",
    "  // header) is refused. If you deliberately serve checkout from another origin,",
    "  // this is the line to relax — it's yours.",
    "  if (!isSameOrigin(request)) return json({ error: \"Forbidden\" }, 403);",
    "",
    "  const body = (await request.json().catch(() => null)) as {",
    "    lines?: unknown;",
    "    cartId?: unknown;",
    "    sourceId?: unknown;",
    "    verificationToken?: unknown;",
    "    email?: unknown;",
    "  } | null;",
    "  if (!body) return json({ error: \"Invalid JSON\" }, 400);",
    "",
    "  // The cart id is the identity half of the idempotency key. It must be high",
    "  // entropy and client-generated ONCE per cart (a v4 uuid in localStorage):",
    "  // regenerate it per request and a double-click charges twice; make it",
    "  // guessable and someone else's identical cart can dedupe into your charge.",
    "  const cartId = typeof body.cartId === \"string\" ? body.cartId : \"\";",
    "  if (!/^[0-9a-f-]{36}$/i.test(cartId)) {",
    "    return json({ error: \"A uuid `cartId` is required\" }, 400);",
    "  }",
    "",
    "  // 1 + 2: re-price and refuse on mismatch.",
    "  const check = await verifyCheckout(body.lines, serverPrices);",
    "  if (!check.ok) return json({ error: check.message, reason: check.reason }, 409);",
    "",
    "  // 3: stable per cart, distinct per customer.",
    '  const idempotencyKey = await checkoutIdempotencyKey(check, "order", cartId);',
    "",
    "  // 4: dormant until provisioned. An unconfigured store still re-prices and",
    "  // still refuses a stale cart — it just doesn't move money.",
    "  // Cast as the toolkit's own `astroidModuleStatus` does: `readSecret`",
    "  // accepts a plain string OR a Secrets Store binding, which CloudflareEnv",
    "  // types more narrowly than the resolver's `SecretSource` map.",
    "  const status = await resolveCommerceStatus(",
    "    astroidConfig.commerce,",
    "    env as unknown as Record<string, SecretSource>,",
    "  );",
    "  if (!status.configured) {",
    "    console.info(",
    '      `[astroid:commerce] simulated checkout — unprovisioned: ${status.missing.join(", ")}`,',
    "    );",
    "    return json({",
    "      simulated: true,",
    "      subtotalCents: check.subtotalCents,",
    "      idempotencyKey,",
    "    });",
    "  }",
    "",
    "  const sourceId = typeof body.sourceId === \"string\" ? body.sourceId : \"\";",
    '  if (!sourceId) return json({ error: "A card token (`sourceId`) is required" }, 400);',
    "",
    "  // Both are guaranteed real by the dormancy gate above; the narrowing here",
    "  // is for the type system, which can't know that. `environment` is a UNION",
    "  // (\"sandbox\" | \"production\"), not a free string — an unrecognised value",
    "  // would otherwise silently select the sandbox host in production.",
    '  const environment = env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";',
    "  const payment = await createPayment(",
    "    {",
    '      accessToken: env.SQUARE_ACCESS_TOKEN ?? "",',
    "      environment,",
    "    },",
    "    {",
    "      sourceId,",
    "      // The SERVER's number, never the client's.",
    '      amountMoney: { amount: check.subtotalCents, currency: "USD" },',
    '      locationId: env.SQUARE_LOCATION_ID ?? "",',
    "      idempotencyKey,",
    "      ...(typeof body.verificationToken === \"string\"",
    "        ? { verificationToken: body.verificationToken }",
    "        : {}),",
    '      ...(typeof body.email === "string" ? { buyerEmailAddress: body.email } : {}),',
    "    },",
    "  );",
    "",
    "  // TODO(you): persist an order row, send a receipt, clear the cart.",
    "  return json({",
    "    paymentId: payment.id,",
    "    status: payment.status,",
    "    receiptUrl: payment.receiptUrl,",
    "  });",
    "};",
    "",
  ].join("\n");
}

/**
 * `src/components/SquareCard.astro` — the card input.
 *
 * Square's Web Payments SDK renders the field in an iframe from their CDN and
 * hands back a single-use token, so the raw card number never touches the Worker
 * and the site stays out of PCI scope. That is the entire reason this is a
 * component and not an `<input>`.
 *
 * Returns null unless this project takes card payments.
 */
export function generateAstroidSquareCard(config: AstroidConfig): string | null {
  if (!usesCardCheckout(config)) return null;

  return [
    "---",
    "// Square Web Payments card input.",
    "//",
    "// The card field is an IFRAME served by Square's CDN — the raw number never",
    "// enters this page's DOM and never reaches the Worker, which is what keeps the",
    "// site out of PCI scope. `tokenize()` returns a single-use token; POST it to",
    "// /api/checkout, which re-prices server-side before charging.",
    "//",
    "// The CSP already allows Square's hosts (astroidSecurity adds them when",
    "// commerce is on), so no policy change is needed.",
    'import { env } from "cloudflare:workers";',
    "",
    "// The PUBLIC application id — safe in the browser, unlike the access token.",
    "// Absent (an unprovisioned store) → render nothing rather than a dead form.",
    "const appId = env.SQUARE_APP_ID;",
    "const locationId = env.SQUARE_LOCATION_ID;",
    'const environment = env.SQUARE_ENVIRONMENT ?? "sandbox";',
    "const ready = Boolean(appId && locationId);",
    "---",
    "",
    "{",
    "  ready ? (",
    "    <div",
    '      id="square-card-host"',
    "      data-app-id={appId}",
    "      data-location-id={locationId}",
    "      data-environment={environment}",
    "    >",
    '      <div id="square-card" />',
    "    </div>",
    "  ) : (",
    '    <p class="text-sm opacity-70">',
    "      Card payments are not configured yet — set SQUARE_APP_ID and",
    "      SQUARE_LOCATION_ID.",
    "    </p>",
    "  )",
    "}",
    "",
    "{/* Processed (NOT is:inline) so Astro's security.csp hashes it into",
    "    script-src. Per-request values ride on the host element's data-* rather",
    "    than a define:vars script, which could not be hashed. */}",
    "<script>",
    '  import { mountCard } from "louise-toolkit/commerce/square-web";',
    "",
    '  const host = document.getElementById("square-card-host");',
    "  if (host) {",
    "    mountCard(",
    '      host.dataset.appId ?? "",',
    '      host.dataset.locationId ?? "",',
    '      host.dataset.environment ?? "sandbox",',
    '      "#square-card",',
    "    )",
    "      .then((card) => {",
    "        // Expose the handle so your checkout form can tokenize on submit:",
    "        //   const token = await window.__squareCard.tokenize();",
    "        // then POST { lines, cartId, sourceId: token } to /api/checkout.",
    "        (window as unknown as { __squareCard?: unknown }).__squareCard = card;",
    '        host.dispatchEvent(new CustomEvent("square-card-ready", { bubbles: true }));',
    "      })",
    "      .catch((err) => {",
    '        console.error("[astroid:commerce] card input failed to mount", err);',
    "      });",
    "  }",
    "</script>",
    "",
  ].join("\n");
}

/**
 * The wrangler `vars` the card input needs, or `[]`.
 *
 * PUBLIC values, so they are vars rather than entries in the secret roster: the
 * application id is shipped to the browser by design, and the environment is a
 * choice, not a credential. Putting them in `credentials` would also fold them
 * into the dormancy gate, which is about whether the module can safely CALL
 * Square — a different question from whether the card field can render.
 */
export function astroidCheckoutVars(config: AstroidConfig): { name: string; value: string }[] {
  if (!usesCardCheckout(config)) return [];
  return [
    // Public app id from the Square dashboard (Developer → Credentials).
    { name: "SQUARE_APP_ID", value: "" },
    // "sandbox" until you have tested a real card end to end.
    { name: "SQUARE_ENVIRONMENT", value: "sandbox" },
  ];
}

/**
 * The `CloudflareEnv` members the card input adds, as a block `create-astroid`
 * substitutes into `src/env.d.ts`. Empty without card checkout.
 */
export function generateAstroidCheckoutEnv(config: AstroidConfig): string {
  if (!usesCardCheckout(config)) return "";
  return [
    "  /** Square's PUBLIC application id — shipped to the browser to mount the",
    "   *  Web Payments card field. Not a secret; see wrangler.jsonc `vars`. */",
    "  SQUARE_APP_ID: string;",
    '  /** Square API environment: "sandbox" or "production". */',
    "  SQUARE_ENVIRONMENT: string;",
  ].join("\n");
}
