// louise/commerce/square — Square API client (V8-native). Raw fetch +
// crypto.subtle only, no `square` Node SDK (it assumes Node and won't run on
// Workers). Square exposes a single versioned REST surface — everything lives
// under the /v2/* namespace and the release is pinned with the `Square-Version`
// header (there is no /v1 vs /v2 split like Stripe's; date-versioning rides on
// top of v2). Mirrors the shape of commerce/index.ts (Stripe) and
// commerce/fourthwall.ts.
//
// Read-first: this site treats Square as the source of truth for commerce, so
// the bulk here is catalog/orders/customers/loyalty/subscriptions reads. The
// one write path is checkout — verify prices against the live catalog, create
// an Order, then charge it with a Web Payments SDK card token via /v2/payments
// (card data is tokenized in the browser and never reaches the Worker).

import { centsToMajor, hmacSha256Base64, safeEqual, type Money } from "./index.js";

export type SquareEnvironment = "sandbox" | "production";

export interface SquareConfig {
  /** Square access token (server-only secret). */
  accessToken: string;
  /** Defaults to "sandbox". Selects the API host. */
  environment?: SquareEnvironment;
  /** Pinned Square-Version. Bump deliberately (response shapes are stable per
   * version). Defaults to SQUARE_VERSION. */
  version?: string;
}

// Pin the API version so an account-default upgrade can't silently change
// response shapes (Square best practice — mirrors what the SDKs pin at
// release). This matches the default baked into the square@44 SDK
// (BaseClient sends `Square-Version: 2026-01-22`). Bump deliberately.
export const SQUARE_VERSION = "2026-01-22";

const HOSTS: Record<SquareEnvironment, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

function host(config: SquareConfig): string {
  return HOSTS[config.environment ?? "sandbox"];
}

function headers(config: SquareConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "square-version": config.version ?? SQUARE_VERSION,
  };
}

interface SquareErrorBody {
  errors?: { code?: string; detail?: string; category?: string }[];
}

function squareError(path: string, status: number, body: SquareErrorBody): Error {
  const first = body.errors?.[0];
  const detail = first?.detail ?? first?.code ?? "error";
  return new Error(`Square ${path} ${status}: ${detail}`);
}

async function sqGet<T>(config: SquareConfig, path: string): Promise<T> {
  const res = await fetch(`${host(config)}${path}`, { headers: headers(config) });
  const data = (await res.json()) as T & SquareErrorBody;
  if (!res.ok) throw squareError(path, res.status, data);
  return data;
}

async function sqPost<T>(config: SquareConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${host(config)}${path}`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & SquareErrorBody;
  if (!res.ok) throw squareError(path, res.status, data);
  return data;
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Square money is an integer amount in the currency's minor unit (cents) —
 *  the shared {@link Money} shape. */
export type SquareMoney = Money;

// `centsToMajor` is a shared commerce helper (louisecms/commerce); re-exported
// so `louisecms/commerce/square` keeps exposing it.
export { centsToMajor };

// ── Catalog ──────────────────────────────────────────────────────────────────

interface RawCatalogObject {
  id: string;
  type: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    description?: string;
    image_ids?: string[];
    variations?: {
      id: string;
      type: string;
      item_variation_data?: {
        name?: string;
        sku?: string;
        price_money?: { amount?: number; currency?: string };
      };
    }[];
  };
  image_data?: { url?: string };
}

interface CatalogSearchResponse {
  objects?: RawCatalogObject[];
  related_objects?: RawCatalogObject[];
  cursor?: string;
}

export interface SquareVariation {
  id: string;
  name: string;
  sku: string | null;
  priceCents: number;
  currency: string;
}

export interface SquareCatalogItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  variations: SquareVariation[];
}

/** Resolve IMAGE object urls from a related-objects list, keyed by image id. */
function imageUrlMap(related: RawCatalogObject[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of related ?? []) {
    if (obj.type === "IMAGE" && obj.image_data?.url) map.set(obj.id, obj.image_data.url);
  }
  return map;
}

/** Map a raw ITEM object (+ resolved images) to the normalized shape. */
export function mapCatalogItem(
  obj: RawCatalogObject,
  images: Map<string, string>,
): SquareCatalogItem {
  const data = obj.item_data ?? {};
  const firstImageId = data.image_ids?.[0];
  const variations: SquareVariation[] = (data.variations ?? [])
    .filter((v) => v.type === "ITEM_VARIATION")
    .map((v) => ({
      id: v.id,
      name: v.item_variation_data?.name ?? "",
      sku: v.item_variation_data?.sku ?? null,
      priceCents: v.item_variation_data?.price_money?.amount ?? 0,
      currency: v.item_variation_data?.price_money?.currency ?? "USD",
    }));
  return {
    id: obj.id,
    name: data.name ?? "",
    description: data.description ?? "",
    imageUrl: firstImageId ? (images.get(firstImageId) ?? null) : null,
    variations,
  };
}

/**
 * List every non-deleted catalog ITEM with its variations and primary image.
 * Walks the search cursor (coffee catalogs are small; a safety cap bounds it).
 * POST /v2/catalog/search.
 */
export async function listCatalogItems(config: SquareConfig): Promise<SquareCatalogItem[]> {
  const items: SquareCatalogItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await sqPost<CatalogSearchResponse>(config, "/v2/catalog/search", {
      object_types: ["ITEM"],
      include_related_objects: true,
      include_deleted_objects: false,
      ...(cursor ? { cursor } : {}),
    });
    const images = imageUrlMap(res.related_objects);
    for (const obj of res.objects ?? []) {
      if (obj.type === "ITEM" && !obj.is_deleted) items.push(mapCatalogItem(obj, images));
    }
    cursor = res.cursor;
    if (!cursor) break;
  }
  return items;
}

/** Retrieve a single catalog object (+ related images). GET /v2/catalog/object/{id}. */
export async function retrieveCatalogItem(
  config: SquareConfig,
  objectId: string,
): Promise<SquareCatalogItem | null> {
  const res = await sqGet<{ object?: RawCatalogObject; related_objects?: RawCatalogObject[] }>(
    config,
    `/v2/catalog/object/${encodeURIComponent(objectId)}?include_related_objects=true`,
  );
  if (!res.object || res.object.type !== "ITEM") return null;
  return mapCatalogItem(res.object, imageUrlMap(res.related_objects));
}

/**
 * Batch-retrieve catalog objects by id — used at checkout to verify cart prices
 * against the live catalog before charging. POST /v2/catalog/batch-retrieve.
 * Returns a map of variationId → priceCents for the ITEM_VARIATION objects.
 */
export async function retrieveVariationPrices(
  config: SquareConfig,
  variationIds: string[],
): Promise<Map<string, SquareMoney>> {
  const res = await sqPost<{ objects?: RawCatalogObject[] }>(config, "/v2/catalog/batch-retrieve", {
    object_ids: variationIds,
  });
  const prices = new Map<string, SquareMoney>();
  for (const obj of res.objects ?? []) {
    if (obj.type === "ITEM_VARIATION") {
      // batch-retrieve returns variations as top-level objects with
      // item_variation_data on the object itself.
      const price = (
        obj as unknown as {
          item_variation_data?: { price_money?: { amount?: number; currency?: string } };
        }
      ).item_variation_data?.price_money;
      prices.set(obj.id, { amount: price?.amount ?? 0, currency: price?.currency ?? "USD" });
    }
  }
  return prices;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface SquareInventoryCount {
  catalogObjectId: string;
  state: string;
  quantity: number;
  locationId: string;
}

/** POST /v2/inventory/counts/batch-retrieve. */
export async function retrieveInventoryCounts(
  config: SquareConfig,
  catalogObjectIds: string[],
  locationIds?: string[],
): Promise<SquareInventoryCount[]> {
  const res = await sqPost<{
    counts?: {
      catalog_object_id?: string;
      state?: string;
      quantity?: string;
      location_id?: string;
    }[];
  }>(config, "/v2/inventory/counts/batch-retrieve", {
    catalog_object_ids: catalogObjectIds,
    ...(locationIds ? { location_ids: locationIds } : {}),
  });
  return (res.counts ?? []).map((c) => ({
    catalogObjectId: c.catalog_object_id ?? "",
    state: c.state ?? "",
    quantity: Number(c.quantity ?? 0),
    locationId: c.location_id ?? "",
  }));
}

// ── Orders ────────────────────────────────────────────────────────────────────

export interface SquareOrderLineItem {
  /** Catalog variation id to charge (lets Square apply catalog price + taxes). */
  catalogObjectId: string;
  quantity: number;
}

export interface SquareOrder {
  id: string;
  locationId: string;
  state: string;
  totalMoney: SquareMoney;
  totalTaxMoney: SquareMoney;
  referenceId: string | null;
  customerId: string | null;
  createdAt: string | null;
  lineItems: {
    name: string;
    quantity: string;
    catalogObjectId: string | null;
    grossSalesMoney: SquareMoney;
  }[];
}

interface RawOrder {
  id?: string;
  location_id?: string;
  state?: string;
  reference_id?: string;
  customer_id?: string;
  created_at?: string;
  total_money?: { amount?: number; currency?: string };
  total_tax_money?: { amount?: number; currency?: string };
  line_items?: {
    name?: string;
    quantity?: string;
    catalog_object_id?: string;
    gross_sales_money?: { amount?: number; currency?: string };
  }[];
}

function money(m?: { amount?: number; currency?: string }): SquareMoney {
  return { amount: m?.amount ?? 0, currency: m?.currency ?? "USD" };
}

function mapOrder(o: RawOrder): SquareOrder {
  return {
    id: o.id ?? "",
    locationId: o.location_id ?? "",
    state: o.state ?? "",
    totalMoney: money(o.total_money),
    totalTaxMoney: money(o.total_tax_money),
    referenceId: o.reference_id ?? null,
    customerId: o.customer_id ?? null,
    createdAt: o.created_at ?? null,
    lineItems: (o.line_items ?? []).map((li) => ({
      name: li.name ?? "",
      quantity: li.quantity ?? "0",
      catalogObjectId: li.catalog_object_id ?? null,
      grossSalesMoney: money(li.gross_sales_money),
    })),
  };
}

/**
 * Create an Order from cart line items (catalog references, so Square computes
 * the authoritative total + taxes). POST /v2/orders.
 */
export async function createOrder(
  config: SquareConfig,
  input: {
    locationId: string;
    lineItems: SquareOrderLineItem[];
    customerId?: string;
    referenceId?: string;
    idempotencyKey?: string;
  },
): Promise<SquareOrder> {
  const res = await sqPost<{ order?: RawOrder }>(config, "/v2/orders", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    order: {
      location_id: input.locationId,
      customer_id: input.customerId,
      reference_id: input.referenceId,
      line_items: input.lineItems.map((li) => ({
        catalog_object_id: li.catalogObjectId,
        quantity: String(li.quantity),
      })),
    },
  });
  if (!res.order) throw new Error("Square order creation returned no order");
  return mapOrder(res.order);
}

/** Retrieve one order. GET /v2/orders/{id}. */
export async function retrieveOrder(config: SquareConfig, orderId: string): Promise<SquareOrder> {
  const res = await sqGet<{ order?: RawOrder }>(
    config,
    `/v2/orders/${encodeURIComponent(orderId)}`,
  );
  if (!res.order) throw new Error(`Square order ${orderId} not found`);
  return mapOrder(res.order);
}

/**
 * Search orders for a customer (account order history). Returns full orders,
 * newest first. POST /v2/orders/search.
 */
export async function searchOrdersByCustomer(
  config: SquareConfig,
  input: { locationIds: string[]; customerId: string; limit?: number },
): Promise<SquareOrder[]> {
  const res = await sqPost<{ orders?: RawOrder[] }>(config, "/v2/orders/search", {
    location_ids: input.locationIds,
    return_entries: false,
    limit: input.limit ?? 50,
    query: {
      filter: { customer_filter: { customer_ids: [input.customerId] } },
      sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
    },
  });
  return (res.orders ?? []).map(mapOrder);
}

// ── Payments ──────────────────────────────────────────────────────────────────

export interface SquarePayment {
  id: string;
  status: string;
  orderId: string | null;
  amountMoney: SquareMoney;
  receiptUrl: string | null;
}

interface RawPayment {
  id?: string;
  status?: string;
  order_id?: string;
  receipt_url?: string;
  amount_money?: { amount?: number; currency?: string };
}

/**
 * Charge a payment with a Web Payments SDK card token (`sourceId`). Attach the
 * order so the amount matches Square's computed total. POST /v2/payments.
 */
export async function createPayment(
  config: SquareConfig,
  input: {
    sourceId: string;
    amountMoney: SquareMoney;
    locationId: string;
    orderId?: string;
    customerId?: string;
    /** Web Payments SCA verification token (verifyBuyer) when present. */
    verificationToken?: string;
    buyerEmailAddress?: string;
    referenceId?: string;
    idempotencyKey?: string;
  },
): Promise<SquarePayment> {
  const res = await sqPost<{ payment?: RawPayment }>(config, "/v2/payments", {
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    amount_money: { amount: input.amountMoney.amount, currency: input.amountMoney.currency },
    location_id: input.locationId,
    order_id: input.orderId,
    customer_id: input.customerId,
    verification_token: input.verificationToken,
    buyer_email_address: input.buyerEmailAddress,
    reference_id: input.referenceId,
  });
  if (!res.payment) throw new Error("Square payment creation returned no payment");
  const p = res.payment;
  return {
    id: p.id ?? "",
    status: p.status ?? "",
    orderId: p.order_id ?? null,
    amountMoney: money(p.amount_money),
    receiptUrl: p.receipt_url ?? null,
  };
}

// ── Customers ─────────────────────────────────────────────────────────────────

export interface SquareCustomer {
  id: string;
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  phoneNumber: string | null;
}

interface RawCustomer {
  id?: string;
  email_address?: string;
  given_name?: string;
  family_name?: string;
  phone_number?: string;
}

function mapCustomer(c: RawCustomer): SquareCustomer {
  return {
    id: c.id ?? "",
    email: c.email_address ?? null,
    givenName: c.given_name ?? null,
    familyName: c.family_name ?? null,
    phoneNumber: c.phone_number ?? null,
  };
}

/** Find customers by exact email. POST /v2/customers/search. */
export async function searchCustomersByEmail(
  config: SquareConfig,
  email: string,
): Promise<SquareCustomer[]> {
  const res = await sqPost<{ customers?: RawCustomer[] }>(config, "/v2/customers/search", {
    query: { filter: { email_address: { exact: email } } },
    limit: 1,
  });
  return (res.customers ?? []).map(mapCustomer);
}

/** Retrieve one customer. GET /v2/customers/{id}. */
export async function retrieveCustomer(
  config: SquareConfig,
  customerId: string,
): Promise<SquareCustomer> {
  const res = await sqGet<{ customer?: RawCustomer }>(
    config,
    `/v2/customers/${encodeURIComponent(customerId)}`,
  );
  if (!res.customer) throw new Error(`Square customer ${customerId} not found`);
  return mapCustomer(res.customer);
}

/** Create a customer. POST /v2/customers. */
export async function createCustomer(
  config: SquareConfig,
  input: { email: string; givenName?: string; familyName?: string; phoneNumber?: string },
): Promise<SquareCustomer> {
  const res = await sqPost<{ customer?: RawCustomer }>(config, "/v2/customers", {
    email_address: input.email,
    given_name: input.givenName,
    family_name: input.familyName,
    phone_number: input.phoneNumber,
  });
  if (!res.customer) throw new Error("Square customer creation returned no customer");
  return mapCustomer(res.customer);
}

/**
 * Find-or-create a Square customer by email — used to (optionally) link a
 * coracle account to Square. Returns the customer and whether it was created.
 */
export async function ensureCustomer(
  config: SquareConfig,
  input: { email: string; givenName?: string; familyName?: string },
): Promise<{ customer: SquareCustomer; created: boolean }> {
  const existing = await searchCustomersByEmail(config, input.email);
  if (existing[0]) return { customer: existing[0], created: false };
  return { customer: await createCustomer(config, input), created: true };
}

// ── Cards on file (for subscriptions) ─────────────────────────────────────────

export interface SquareCard {
  id: string;
  last4: string | null;
  cardBrand: string | null;
  expMonth: number | null;
  expYear: number | null;
}

/**
 * Save a card on file from a Web Payments token, attached to a customer — the
 * card id then seeds a subscription. POST /v2/cards.
 */
export async function createCard(
  config: SquareConfig,
  input: {
    sourceId: string;
    customerId: string;
    idempotencyKey?: string;
    verificationToken?: string;
  },
): Promise<SquareCard> {
  const res = await sqPost<{
    card?: {
      id?: string;
      last_4?: string;
      card_brand?: string;
      exp_month?: number;
      exp_year?: number;
    };
  }>(config, "/v2/cards", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    source_id: input.sourceId,
    verification_token: input.verificationToken,
    card: { customer_id: input.customerId },
  });
  if (!res.card) throw new Error("Square card creation returned no card");
  return {
    id: res.card.id ?? "",
    last4: res.card.last_4 ?? null,
    cardBrand: res.card.card_brand ?? null,
    expMonth: res.card.exp_month ?? null,
    expYear: res.card.exp_year ?? null,
  };
}

// ── Loyalty ───────────────────────────────────────────────────────────────────

export interface SquareLoyaltyAccount {
  id: string;
  programId: string | null;
  balance: number;
  lifetimePoints: number;
  customerId: string | null;
}

interface RawLoyaltyAccount {
  id?: string;
  program_id?: string;
  balance?: number;
  lifetime_points?: number;
  customer_id?: string;
}

function mapLoyalty(a: RawLoyaltyAccount): SquareLoyaltyAccount {
  return {
    id: a.id ?? "",
    programId: a.program_id ?? null,
    balance: a.balance ?? 0,
    lifetimePoints: a.lifetime_points ?? 0,
    customerId: a.customer_id ?? null,
  };
}

/**
 * The loyalty account for a Square customer (points balance / lifetime), or
 * null if they have none. POST /v2/loyalty/accounts/search.
 */
export async function retrieveLoyaltyAccountByCustomer(
  config: SquareConfig,
  customerId: string,
): Promise<SquareLoyaltyAccount | null> {
  const res = await sqPost<{ loyalty_accounts?: RawLoyaltyAccount[] }>(
    config,
    "/v2/loyalty/accounts/search",
    { query: { customer_ids: [customerId] }, limit: 1 },
  );
  const account = res.loyalty_accounts?.[0];
  return account ? mapLoyalty(account) : null;
}

// ── Subscriptions (Coracle Club) ───────────────────────────────────────────────

export interface SquareSubscription {
  id: string;
  status: string;
  planVariationId: string | null;
  customerId: string | null;
  cardId: string | null;
  startDate: string | null;
  chargedThroughDate: string | null;
}

interface RawSubscription {
  id?: string;
  status?: string;
  plan_variation_id?: string;
  customer_id?: string;
  card_id?: string;
  start_date?: string;
  charged_through_date?: string;
}

function mapSubscription(s: RawSubscription): SquareSubscription {
  return {
    id: s.id ?? "",
    status: s.status ?? "",
    planVariationId: s.plan_variation_id ?? null,
    customerId: s.customer_id ?? null,
    cardId: s.card_id ?? null,
    startDate: s.start_date ?? null,
    chargedThroughDate: s.charged_through_date ?? null,
  };
}

/** Active/past subscriptions for a customer. POST /v2/subscriptions/search. */
export async function searchSubscriptionsByCustomer(
  config: SquareConfig,
  input: { customerId: string; locationIds?: string[] },
): Promise<SquareSubscription[]> {
  const res = await sqPost<{ subscriptions?: RawSubscription[] }>(
    config,
    "/v2/subscriptions/search",
    {
      query: {
        filter: {
          customer_ids: [input.customerId],
          ...(input.locationIds ? { location_ids: input.locationIds } : {}),
        },
      },
    },
  );
  return (res.subscriptions ?? []).map(mapSubscription);
}

/**
 * Enroll a customer in a subscription plan variation, billed to a saved card.
 * POST /v2/subscriptions.
 */
export async function createSubscription(
  config: SquareConfig,
  input: {
    locationId: string;
    planVariationId: string;
    customerId: string;
    cardId: string;
    idempotencyKey?: string;
  },
): Promise<SquareSubscription> {
  const res = await sqPost<{ subscription?: RawSubscription }>(config, "/v2/subscriptions", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    location_id: input.locationId,
    plan_variation_id: input.planVariationId,
    customer_id: input.customerId,
    card_id: input.cardId,
  });
  if (!res.subscription) throw new Error("Square subscription creation returned no subscription");
  return mapSubscription(res.subscription);
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

/**
 * Verify a Square webhook signature. Square signs the concatenation of the
 * exact notification URL you configured and the raw request body with
 * HMAC-SHA256, base64-encoded, delivered in the `x-square-hmacsha256-signature`
 * header (this reproduces the SDK's WebhooksHelper.verifySignature). `body`
 * must be the raw request text.
 */
export async function verifySquareSignature(
  notificationUrl: string,
  body: string,
  signatureHeader: string | null,
  signatureKey: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await hmacSha256Base64(signatureKey, notificationUrl + body);
  return safeEqual(expected, signatureHeader.trim());
}
