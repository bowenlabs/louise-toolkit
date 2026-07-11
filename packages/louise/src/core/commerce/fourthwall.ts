// louise/commerce/fourthwall — Fourthwall Storefront API client (Cycle 6).
//
// Fourthwall owns the merch catalog, cart, and hosted checkout. This is the
// read side: list collections + their products so the site can mirror them
// into D1 (with an editable overlay) and build a cart. Raw fetch only — no
// SDK. The Storefront token is public-safe (catalog + cart); the Platform
// token (orders, added in a later phase) is server-only.
//
// Auth is a `storefront_token` query param per Fourthwall's docs:
//   GET https://storefront-api.fourthwall.com/v1/collections?storefront_token=…
//
// NOTE: exact response envelopes (results vs bare array, paging cursor) and
// the money unit (major vs minor) are confirmed against a live store when the
// token is provisioned — the parsing below is defensive about both.

import { hmacSha256Base64, safeEqual } from "./index.js";

const STOREFRONT_API = "https://storefront-api.fourthwall.com/v1";

export interface FwMoney {
  /** Amount in the currency's major unit (e.g. 25 = $25.00) unless a live
   * store proves otherwise; mapped to products.price (whole dollars). */
  value: number;
  currency: string;
}

export interface FwImage {
  url: string;
  width?: number;
  height?: number;
}

export interface FwVariantAttributes {
  color?: { name?: string; swatch?: string };
  size?: { name?: string };
}

export interface FwStock {
  type?: "LIMITED" | "UNLIMITED";
  inStock?: number;
}

export interface FwVariant {
  id: string;
  name: string;
  sku?: string;
  unitPrice: FwMoney;
  compareAtPrice?: FwMoney | null;
  attributes?: FwVariantAttributes;
  stock?: FwStock;
  images?: FwImage[];
}

export interface FwProduct {
  id: string;
  name: string;
  slug: string;
  description?: string;
  images: FwImage[];
  variants: FwVariant[];
  state?: "AVAILABLE" | "SOLD_OUT";
  access?: string;
}

export interface FwCollection {
  id: string;
  name: string;
  slug: string;
}

/** Some endpoints wrap results as `{ results: [...] }`; others return a bare
 * array. Normalize both. */
function unwrap<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

async function sfGet(
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${STOREFRONT_API}${path}`);
  url.searchParams.set("storefront_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fourthwall GET ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** All storefront collections (Prints, Totes, Buttons, Stickers, …). */
export async function listCollections(token: string): Promise<FwCollection[]> {
  return unwrap<FwCollection>(await sfGet(token, "/collections"));
}

/** Products within one collection, by collection slug. */
export async function getCollectionProducts(
  token: string,
  collectionSlug: string,
): Promise<FwProduct[]> {
  return unwrap<FwProduct>(
    await sfGet(token, `/collections/${encodeURIComponent(collectionSlug)}/products`),
  );
}

export interface FwCartItem {
  variantId: string;
  quantity: number;
}

/**
 * Create a Fourthwall cart from variant+quantity items. Returns the cart id,
 * which the checkout redirect carries: `${checkout}/checkout/?cartCurrency=…&cartId=…`.
 * POST /v1/carts { items: [{ variantId, quantity }] } → { id }.
 */
export async function createCart(token: string, items: FwCartItem[]): Promise<{ id: string }> {
  const url = new URL(`${STOREFRONT_API}/carts`);
  url.searchParams.set("storefront_token", token);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fourthwall POST /carts ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Fourthwall cart create returned no id");
  return { id: data.id };
}

/** A single product by slug (authoritative pricing for import). */
export async function getProduct(token: string, slug: string): Promise<FwProduct | null> {
  try {
    const data = await sfGet(token, `/products/${encodeURIComponent(slug)}`);
    return (data ?? null) as FwProduct | null;
  } catch {
    return null;
  }
}

/** Walk every collection and return its products together with the collection
 * they came from (Fourthwall does not put collection membership on the product,
 * so category has to come from the collection). */
export async function listCatalog(
  token: string,
): Promise<{ collection: FwCollection; products: FwProduct[] }[]> {
  const collections = await listCollections(token);
  const out: { collection: FwCollection; products: FwProduct[] }[] = [];
  for (const collection of collections) {
    const products = await getCollectionProducts(token, collection.slug);
    out.push({ collection, products });
  }
  return out;
}

/** Lowest variant price, in whole dollars, for the catalog "from" price. */
export function lowestPrice(product: FwProduct): number {
  const prices = product.variants.map((v) => v.unitPrice?.value ?? 0).filter((n) => n > 0);
  return prices.length ? Math.min(...prices) : 0;
}

/**
 * Verify a Fourthwall webhook signature. Fourthwall sends the base64-encoded
 * HMAC-SHA256 of the raw request body in the `X-Fourthwall-Hmac-SHA256` header,
 * keyed by the webhook's signing secret. `payload` must be the raw body text.
 */
export async function verifyFourthwallSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const expected = await hmacSha256Base64(secret, payload);
  return safeEqual(expected, header.trim());
}

// ── order webhook mapping ─────────────────────────────────────────────────────
// Fourthwall order.* webhooks are verified (above) then enqueued; the consumer
// maps the event to a normalized, storage-ready order and upserts it into the
// site's own `orders` table. The mapping is framework-agnostic and defensive
// (Fourthwall payload shapes vary across order/offer aliases), so it lives here;
// the D1 write stays in the site (its own `orders` schema).

/** A Fourthwall `order.*` webhook event, thinned to what the mapper reads. */
export interface FourthwallOrderEvent {
  id?: string;
  type?: string;
  testMode?: boolean;
  data?: Record<string, unknown>;
}

/** One line item on a normalized Fourthwall order. */
export interface FourthwallOrderItem {
  slug: string | null;
  name: string;
  qty: number;
  /** Unit price in cents, or null when the payload omits it. */
  unitPrice: number | null;
}

/** A coarse order lifecycle state derived from Fourthwall's status string. */
export type FourthwallOrderStatus = "paid" | "fulfilled" | "canceled";

/** A Fourthwall order mapped to a normalized, storage-ready shape. The site
 *  upserts this into its own `orders` table (idempotent on `fourthwallOrderId`). */
export interface FourthwallOrder {
  fourthwallOrderId: string;
  orderNumber: string | null;
  email: string | null;
  /** Order total in cents. */
  amount: number | null;
  currency: string | null;
  items: FourthwallOrderItem[];
  shippingAddress: unknown;
  orderStatus: FourthwallOrderStatus;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Fourthwall money is `{ value, currency }` in major units (or a bare number);
 *  normalize to integer cents. */
export function fourthwallMoneyToCents(m: unknown): number | null {
  const value = (asObj(m).value ?? (typeof m === "number" ? m : undefined)) as unknown;
  return typeof value === "number" ? Math.round(value * 100) : null;
}

/** Map a Fourthwall status string to a coarse lifecycle state. */
export function mapFourthwallOrderStatus(status: string | null): FourthwallOrderStatus {
  const v = (status ?? "").toLowerCase();
  if (v.includes("cancel") || v.includes("refund")) return "canceled";
  if (v.includes("fulfil") || v.includes("ship") || v.includes("deliver")) return "fulfilled";
  return "paid";
}

/** Extract line items from a Fourthwall order payload, tolerating the
 *  offers/items/lineItems aliases and nested variant names. */
function mapFourthwallItems(data: Record<string, unknown>): FourthwallOrderItem[] {
  const raw = (data.offers ?? data.items ?? data.lineItems ?? []) as unknown[];
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => {
    const o = asObj(it);
    return {
      slug: str(o.slug) ?? str(o.productSlug),
      name: str(o.name) ?? str(asObj(o.variant).name) ?? str(o.productName) ?? "Item",
      qty: typeof o.quantity === "number" ? o.quantity : 1,
      unitPrice: fourthwallMoneyToCents(o.price ?? o.unitPrice),
    };
  });
}

/**
 * Parse a Fourthwall `order.*` webhook event into a normalized {@link
 * FourthwallOrder}, or `null` when it carries no order id (nothing to record).
 * Defensive: Fourthwall payload shapes vary, so it reads several field aliases
 * (`id`/`orderId`, `friendlyId`/`number`, `total`/`amounts.total`/`amount`,
 * top-level or nested `customer.email`). The site upserts the result into its
 * own `orders` table, adding any site-schema columns (e.g. `raw`, `fulfillment`).
 */
export function mapFourthwallOrder(event: FourthwallOrderEvent): FourthwallOrder | null {
  const data = asObj(event.data);
  const fourthwallOrderId = str(data.id) ?? str(data.orderId);
  if (!fourthwallOrderId) return null;
  const total = data.total ?? asObj(data.amounts).total ?? data.amount;
  return {
    fourthwallOrderId,
    orderNumber: str(data.friendlyId) ?? str(data.number) ?? str(data.orderNumber),
    email: str(data.email) ?? str(asObj(data.customer).email),
    amount: fourthwallMoneyToCents(total),
    currency: str(asObj(total).currency) ?? str(data.currency),
    items: mapFourthwallItems(data),
    shippingAddress: asObj(data.shipping).address ?? data.shippingAddress ?? null,
    orderStatus: mapFourthwallOrderStatus(str(data.status)),
  };
}
