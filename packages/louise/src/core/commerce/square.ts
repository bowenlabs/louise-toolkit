// louise-toolkit/commerce/square — Square API client (V8-native). Raw fetch +
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

async function sqPut<T>(config: SquareConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${host(config)}${path}`, {
    method: "PUT",
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

// `centsToMajor` is a shared commerce helper (louise-toolkit/commerce); re-exported
// so `louise-toolkit/commerce/square` keeps exposing it.
export { centsToMajor };

// ── Catalog ──────────────────────────────────────────────────────────────────

interface RawCatalogObject {
  id: string;
  type: string;
  version?: number;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    description?: string;
    image_ids?: string[];
    variations?: {
      id: string;
      type: string;
      version?: number;
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
  /** Object version — pass back to {@link upsertCatalogItem} when updating. */
  version: number;
}

export interface SquareCatalogItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  variations: SquareVariation[];
  /** Object version — pass back to {@link upsertCatalogItem} when updating. */
  version: number;
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
      version: v.version ?? 0,
    }));
  return {
    id: obj.id,
    name: data.name ?? "",
    description: data.description ?? "",
    imageUrl: firstImageId ? (images.get(firstImageId) ?? null) : null,
    variations,
    version: obj.version ?? 0,
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

export interface CatalogVariationInput {
  /** Existing Square variation id — pass to update; omit to create a new one. */
  id?: string;
  /** Stable client key for a NEW variation, echoed back in `idMappings` so the
   *  caller can persist the id Square assigns (ignored when `id` is set). */
  clientId?: string;
  name: string;
  sku?: string;
  priceCents: number;
  currency?: string;
  /** Current Square version — required when UPDATING an existing variation
   *  (Square uses optimistic concurrency; a stale/absent version is rejected). */
  version?: number;
}

/**
 * Create or update a catalog ITEM with its ITEM_VARIATIONs (fixed pricing).
 * POST /v2/catalog/object. This is the one catalog WRITE — sites where D1 owns
 * the product and pushes it up (vs. Square-as-source-of-truth reads above) call
 * this to mirror an item and its size/price variations into Square.
 *
 * Omit `id`s to create (Square assigns real ids, returned in `idMappings` keyed
 * by each variation's `clientId`/`#temp` id). To UPDATE, pass the item `id` +
 * each variation `id` AND its current `version` (from a prior retrieve) — Square
 * rejects a write with a stale version. Returns the normalized item with the
 * real ids resolved.
 */
export async function upsertCatalogItem(
  config: SquareConfig,
  input: {
    id?: string;
    name: string;
    description?: string;
    variations: CatalogVariationInput[];
    /** Current item version — required when updating an existing ITEM. */
    version?: number;
    idempotencyKey?: string;
  },
): Promise<{ item: SquareCatalogItem; idMappings: Record<string, string> }> {
  const itemId = input.id ?? "#item";
  const res = await sqPost<{
    catalog_object?: RawCatalogObject;
    id_mappings?: { client_object_id?: string; object_id?: string }[];
  }>(config, "/v2/catalog/object", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    object: {
      type: "ITEM",
      id: itemId,
      ...(input.version != null ? { version: input.version } : {}),
      item_data: {
        name: input.name,
        description: input.description,
        variations: input.variations.map((v, i) => ({
          type: "ITEM_VARIATION",
          id: v.id ?? v.clientId ?? `#var-${i}`,
          ...(v.version != null ? { version: v.version } : {}),
          item_variation_data: {
            item_id: itemId,
            name: v.name,
            sku: v.sku,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: v.priceCents, currency: v.currency ?? "USD" },
          },
        })),
      },
    },
  });
  if (!res.catalog_object) throw new Error("Square catalog upsert returned no object");
  const idMappings: Record<string, string> = {};
  for (const m of res.id_mappings ?? []) {
    if (m.client_object_id && m.object_id) idMappings[m.client_object_id] = m.object_id;
  }
  return { item: mapCatalogItem(res.catalog_object, new Map()), idMappings };
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

/**
 * An order line item — either a catalog variation reference (Square applies the
 * catalog price + taxes) OR an ad-hoc line (explicit name + price), for charges
 * with no catalog object behind them (e.g. a manufacturing deposit).
 */
export type SquareOrderLineItem =
  | { catalogObjectId: string; quantity: number }
  | { name: string; priceCents: number; quantity: number; currency?: string };

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
      line_items: input.lineItems.map((li) =>
        "catalogObjectId" in li
          ? { catalog_object_id: li.catalogObjectId, quantity: String(li.quantity) }
          : {
              name: li.name,
              quantity: String(li.quantity),
              base_price_money: { amount: li.priceCents, currency: li.currency ?? "USD" },
            },
      ),
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

// ── Team (employees) ────────────────────────────────────────────────────────────

export interface SquareTeamMember {
  id: string;
  referenceId: string | null;
  givenName: string | null;
  familyName: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  status: string;
  isOwner: boolean;
}

interface RawTeamMember {
  id?: string;
  reference_id?: string;
  given_name?: string;
  family_name?: string;
  email_address?: string;
  phone_number?: string;
  status?: string;
  is_owner?: boolean;
}

function mapTeamMember(m: RawTeamMember): SquareTeamMember {
  return {
    id: m.id ?? "",
    referenceId: m.reference_id ?? null,
    givenName: m.given_name ?? null,
    familyName: m.family_name ?? null,
    emailAddress: m.email_address ?? null,
    phoneNumber: m.phone_number ?? null,
    status: m.status ?? "",
    isOwner: m.is_owner ?? false,
  };
}

export interface TeamMemberInput {
  givenName?: string;
  familyName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  /** Your own id for this person (e.g. a portal_user id) — round-trips on the
   *  Square record so you can correlate without a separate lookup. */
  referenceId?: string;
  status?: "ACTIVE" | "INACTIVE";
  /** Assign to all current + future locations (the common default). Omit and
   *  Square assigns none — you manage locations yourself. */
  assignAllLocations?: boolean;
}

function teamMemberBody(input: TeamMemberInput) {
  return {
    given_name: input.givenName,
    family_name: input.familyName,
    email_address: input.emailAddress,
    phone_number: input.phoneNumber,
    reference_id: input.referenceId,
    status: input.status ?? "ACTIVE",
    ...(input.assignAllLocations
      ? { assigned_locations: { assignment_type: "ALL_CURRENT_AND_FUTURE_LOCATIONS" } }
      : {}),
  };
}

/** Create a team member (employee). POST /v2/team-members. */
export async function createTeamMember(
  config: SquareConfig,
  input: TeamMemberInput & { idempotencyKey?: string },
): Promise<SquareTeamMember> {
  const res = await sqPost<{ team_member?: RawTeamMember }>(config, "/v2/team-members", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    team_member: teamMemberBody(input),
  });
  if (!res.team_member) throw new Error("Square team member creation returned no member");
  return mapTeamMember(res.team_member);
}

/** Update a team member. PUT /v2/team-members/{id}. */
export async function updateTeamMember(
  config: SquareConfig,
  teamMemberId: string,
  input: TeamMemberInput,
): Promise<SquareTeamMember> {
  const res = await sqPut<{ team_member?: RawTeamMember }>(
    config,
    `/v2/team-members/${encodeURIComponent(teamMemberId)}`,
    { team_member: teamMemberBody(input) },
  );
  if (!res.team_member) throw new Error(`Square team member ${teamMemberId} update returned none`);
  return mapTeamMember(res.team_member);
}

/** Retrieve one team member. GET /v2/team-members/{id}. */
export async function retrieveTeamMember(
  config: SquareConfig,
  teamMemberId: string,
): Promise<SquareTeamMember | null> {
  const res = await sqGet<{ team_member?: RawTeamMember }>(
    config,
    `/v2/team-members/${encodeURIComponent(teamMemberId)}`,
  );
  return res.team_member ? mapTeamMember(res.team_member) : null;
}

/**
 * Search team members. POST /v2/team-members/search. The Team API has no email
 * filter, so pass `status`/`locationIds` and match the rest client-side (by
 * `referenceId` or `emailAddress`). Coffee teams are small — one page suffices,
 * so this returns the first page (up to `limit`, default 200).
 */
export async function searchTeamMembers(
  config: SquareConfig,
  input: { locationIds?: string[]; status?: "ACTIVE" | "INACTIVE"; limit?: number } = {},
): Promise<SquareTeamMember[]> {
  const filter: Record<string, unknown> = { status: input.status ?? "ACTIVE" };
  if (input.locationIds) filter.location_ids = input.locationIds;
  const res = await sqPost<{ team_members?: RawTeamMember[] }>(config, "/v2/team-members/search", {
    query: { filter },
    limit: input.limit ?? 200,
  });
  return (res.team_members ?? []).map(mapTeamMember);
}

// ── Labor (timecards / time tracking) ───────────────────────────────────────────

export interface SquareTimecard {
  id: string;
  locationId: string;
  teamMemberId: string;
  startAt: string;
  endAt: string | null;
  status: string;
  /** Optimistic-concurrency version — pass it back to update/close the card. */
  version: number;
  /** Wage on the card (Square defaults it from the team member). An update is a
   *  full replace and Square requires a wage, so pass this back when closing. */
  wage: { title: string | null; hourlyRateCents: number; currency: string } | null;
}

interface RawTimecard {
  id?: string;
  location_id?: string;
  team_member_id?: string;
  start_at?: string;
  end_at?: string;
  status?: string;
  version?: number;
  wage?: { title?: string; hourly_rate?: { amount?: number; currency?: string } };
}

function mapTimecard(t: RawTimecard): SquareTimecard {
  return {
    id: t.id ?? "",
    locationId: t.location_id ?? "",
    teamMemberId: t.team_member_id ?? "",
    startAt: t.start_at ?? "",
    endAt: t.end_at ?? null,
    status: t.status ?? "",
    version: t.version ?? 0,
    wage: t.wage
      ? {
          title: t.wage.title ?? null,
          hourlyRateCents: t.wage.hourly_rate?.amount ?? 0,
          currency: t.wage.hourly_rate?.currency ?? "USD",
        }
      : null,
  };
}

export interface TimecardWage {
  title?: string;
  hourlyRateCents: number;
  currency?: string;
}

function wageBody(wage?: TimecardWage) {
  return wage
    ? {
        wage: {
          title: wage.title,
          hourly_rate: { amount: wage.hourlyRateCents, currency: wage.currency ?? "USD" },
        },
      }
    : {};
}

/**
 * Open a timecard (clock in). POST /v2/labor/timecards. A team member can hold
 * only ONE open timecard at a time. `startAt` is an RFC 3339 timestamp; pass a
 * `wage` (hourly rate) for Square to compute labor cost. Returns the timecard
 * incl. its `version`, which you need to close it later. Requires Square-Version
 * ≥ 2025-05-21 (the default pinned {@link SQUARE_VERSION} satisfies this).
 */
export async function createTimecard(
  config: SquareConfig,
  input: {
    locationId: string;
    teamMemberId: string;
    startAt: string;
    wage?: TimecardWage;
    idempotencyKey?: string;
  },
): Promise<SquareTimecard> {
  const res = await sqPost<{ timecard?: RawTimecard }>(config, "/v2/labor/timecards", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    timecard: {
      location_id: input.locationId,
      team_member_id: input.teamMemberId,
      start_at: input.startAt,
      ...wageBody(input.wage),
    },
  });
  if (!res.timecard) throw new Error("Square timecard creation returned no timecard");
  return mapTimecard(res.timecard);
}

/**
 * Update a timecard — typically to close it (clock out) by setting `endAt`.
 * PUT /v2/labor/timecards/{id} REPLACES the record, so pass its full state
 * (location, team member, start) plus the current `version` from the prior
 * create/retrieve (Square rejects a stale version).
 */
export async function updateTimecard(
  config: SquareConfig,
  timecardId: string,
  input: {
    locationId: string;
    teamMemberId: string;
    startAt: string;
    endAt?: string;
    version: number;
    wage?: TimecardWage;
  },
): Promise<SquareTimecard> {
  const res = await sqPut<{ timecard?: RawTimecard }>(
    config,
    `/v2/labor/timecards/${encodeURIComponent(timecardId)}`,
    {
      timecard: {
        location_id: input.locationId,
        team_member_id: input.teamMemberId,
        start_at: input.startAt,
        end_at: input.endAt,
        version: input.version,
        ...wageBody(input.wage),
      },
    },
  );
  if (!res.timecard) throw new Error(`Square timecard ${timecardId} update returned none`);
  return mapTimecard(res.timecard);
}

/** Retrieve one timecard (e.g. to read its current version before closing).
 *  GET /v2/labor/timecards/{id}. */
export async function retrieveTimecard(
  config: SquareConfig,
  timecardId: string,
): Promise<SquareTimecard | null> {
  const res = await sqGet<{ timecard?: RawTimecard }>(
    config,
    `/v2/labor/timecards/${encodeURIComponent(timecardId)}`,
  );
  return res.timecard ? mapTimecard(res.timecard) : null;
}

/**
 * Search timecards (labor reporting). POST /v2/labor/timecards/search. Filter
 * by team member(s), location(s), and/or a start-time window (RFC 3339).
 * Returns the first page newest-first (up to `limit`, default 200).
 */
export async function searchTimecards(
  config: SquareConfig,
  input: {
    teamMemberIds?: string[];
    locationIds?: string[];
    startAtMin?: string;
    startAtMax?: string;
    limit?: number;
  } = {},
): Promise<SquareTimecard[]> {
  const filter: Record<string, unknown> = {};
  if (input.teamMemberIds) filter.team_member_ids = input.teamMemberIds;
  if (input.locationIds) filter.location_ids = input.locationIds;
  if (input.startAtMin || input.startAtMax) {
    filter.start = { start_at: input.startAtMin, end_at: input.startAtMax };
  }
  const res = await sqPost<{ timecards?: RawTimecard[] }>(config, "/v2/labor/timecards/search", {
    query: { filter, sort: { field: "START_AT", order: "DESC" } },
    limit: input.limit ?? 200,
  });
  return (res.timecards ?? []).map(mapTimecard);
}

// ── Invoices ────────────────────────────────────────────────────────────────────

export interface SquareInvoicePaymentRequest {
  uid: string | null;
  requestType: string;
  dueDate: string | null;
  status: string | null;
  computedAmountCents: number;
  totalCompletedAmountCents: number;
}

export interface SquareInvoice {
  id: string;
  version: number;
  status: string;
  orderId: string | null;
  /** Square-hosted pay page — present after publishing with SHARE_MANUALLY. */
  publicUrl: string | null;
  paymentRequests: SquareInvoicePaymentRequest[];
}

interface RawInvoice {
  id?: string;
  version?: number;
  status?: string;
  order_id?: string;
  public_url?: string;
  payment_requests?: {
    uid?: string;
    request_type?: string;
    due_date?: string;
    status?: string;
    computed_amount_money?: { amount?: number; currency?: string };
    total_completed_amount_money?: { amount?: number; currency?: string };
  }[];
}

function mapInvoice(i: RawInvoice): SquareInvoice {
  return {
    id: i.id ?? "",
    version: i.version ?? 0,
    status: i.status ?? "",
    orderId: i.order_id ?? null,
    publicUrl: i.public_url ?? null,
    paymentRequests: (i.payment_requests ?? []).map((r) => ({
      uid: r.uid ?? null,
      requestType: r.request_type ?? "",
      dueDate: r.due_date ?? null,
      status: r.status ?? null,
      computedAmountCents: r.computed_amount_money?.amount ?? 0,
      totalCompletedAmountCents: r.total_completed_amount_money?.amount ?? 0,
    })),
  };
}

export interface InvoicePaymentRequestInput {
  /** Exactly one BALANCE (the last request), with an optional leading DEPOSIT
   *  and/or 2–12 INSTALLMENTs. */
  type: "DEPOSIT" | "BALANCE" | "INSTALLMENT";
  /** Due date, YYYY-MM-DD. */
  dueDate: string;
  /** Fixed amount for this request. Omit on BALANCE to auto-cover the remainder. */
  amountCents?: number;
  currency?: string;
}

/**
 * Create a DRAFT invoice for an existing OPEN Square Order (the order carries
 * the line items + total; the invoice adds the payment schedule + recipient).
 * POST /v2/invoices. Publish with {@link publishInvoice} to start collecting.
 * `deliveryMethod` "SHARE_MANUALLY" (default) yields a `publicUrl` after publish
 * — send your own email linking to it; "EMAIL" has Square email the customer.
 */
export async function createInvoice(
  config: SquareConfig,
  input: {
    locationId: string;
    orderId: string;
    customerId: string;
    paymentRequests: InvoicePaymentRequestInput[];
    deliveryMethod?: "SHARE_MANUALLY" | "EMAIL";
    title?: string;
    description?: string;
    idempotencyKey?: string;
  },
): Promise<SquareInvoice> {
  const res = await sqPost<{ invoice?: RawInvoice }>(config, "/v2/invoices", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    invoice: {
      location_id: input.locationId,
      order_id: input.orderId,
      primary_recipient: { customer_id: input.customerId },
      delivery_method: input.deliveryMethod ?? "SHARE_MANUALLY",
      title: input.title,
      description: input.description,
      accepted_payment_methods: { card: true },
      payment_requests: input.paymentRequests.map((r) => ({
        request_type: r.type,
        due_date: r.dueDate,
        tipping_enabled: false,
        ...(r.amountCents != null
          ? {
              fixed_amount_requested_money: {
                amount: r.amountCents,
                currency: r.currency ?? "USD",
              },
            }
          : {}),
      })),
    },
  });
  if (!res.invoice) throw new Error("Square invoice creation returned no invoice");
  return mapInvoice(res.invoice);
}

/** Publish a draft invoice (starts processing; yields the hosted `publicUrl` when
 *  created with SHARE_MANUALLY). POST /v2/invoices/{id}/publish. Pass the current
 *  `version` from {@link createInvoice} (optimistic concurrency). */
export async function publishInvoice(
  config: SquareConfig,
  invoiceId: string,
  version: number,
  idempotencyKey?: string,
): Promise<SquareInvoice> {
  const res = await sqPost<{ invoice?: RawInvoice }>(
    config,
    `/v2/invoices/${encodeURIComponent(invoiceId)}/publish`,
    { version, idempotency_key: idempotencyKey ?? crypto.randomUUID() },
  );
  if (!res.invoice) throw new Error(`Square invoice ${invoiceId} publish returned none`);
  return mapInvoice(res.invoice);
}

/** Retrieve one invoice — e.g. to read each payment request's completed amount
 *  when reconciling a webhook. GET /v2/invoices/{id}. */
export async function retrieveInvoice(
  config: SquareConfig,
  invoiceId: string,
): Promise<SquareInvoice> {
  const res = await sqGet<{ invoice?: RawInvoice }>(
    config,
    `/v2/invoices/${encodeURIComponent(invoiceId)}`,
  );
  if (!res.invoice) throw new Error(`Square invoice ${invoiceId} not found`);
  return mapInvoice(res.invoice);
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
