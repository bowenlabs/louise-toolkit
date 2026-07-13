// A minimal Square checkout on Cloudflare Workers, built on louise/commerce/square.
// This is the real handler pattern a shop route uses: price the item from the live
// catalog, then charge the card token the browser tokenized. It targets the current
// louise/commerce/square API. It isn't mounted on this marketing site — a live charge
// needs your Square secret + location — so /examples/commerce simulates the same flow.
// The code below is sliced verbatim into that page's "checkout.ts" tab.

// #region example:square-server
import { createPayment, listCatalogItems, type SquareConfig } from "louise/commerce/square";

interface CheckoutEnv {
  SQUARE_TOKEN: string; // server-only access token (secret)
  SQUARE_LOCATION: string; // your Square location id
  SQUARE_ENV: "sandbox" | "production"; // sandbox honors test cards, moves no real money
}

// POST { sourceId, variationId } — charge the tokenized card for one catalog item.
export async function handleCheckout(request: Request, env: CheckoutEnv): Promise<Response> {
  const { sourceId, variationId } = (await request.json()) as {
    sourceId: string;
    variationId: string;
  };

  const config: SquareConfig = { accessToken: env.SQUARE_TOKEN, environment: env.SQUARE_ENV };

  // Price server-side from the live catalog — never trust an amount from the client.
  const catalog = await listCatalogItems(config);
  const variation = catalog.flatMap((item) => item.variations).find((v) => v.id === variationId);
  if (!variation) return Response.json({ error: "Unknown item" }, { status: 404 });

  // Charge the card token. `amountMoney` is the smallest unit (cents for USD); in
  // sandbox, Square's test cards approve instantly and no real money moves.
  const payment = await createPayment(config, {
    sourceId,
    locationId: env.SQUARE_LOCATION,
    amountMoney: { amount: variation.priceCents, currency: variation.currency },
  });

  return Response.json({ status: payment.status, id: payment.id, receipt: payment.receiptUrl });
}
// #endregion example:square-server
