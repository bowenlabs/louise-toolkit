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
