// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/fourthwall-platform — the Fourthwall **Platform** API
// (Open API v1.0). Raw fetch only, no SDK, V8-native.
//
// ── Why this is a separate module from `commerce/fourthwall` ─────────────────
//
// Different base URL and different auth, but the reason it is a hard split is
// the TRUST BOUNDARY. `commerce/fourthwall` speaks the Storefront API with a
// `storefront_token` that is public-safe by design — it reads the catalog and
// builds a cart, and shipping it to a browser is the intended use. The
// credentials here are HTTP Basic, they create products and place at-cost
// fulfillment orders, and they must never leave a Worker.
//
// One module holding both is how the wrong one ends up in a client bundle: a
// component imports the module for `lowestPrice`, the bundler pulls in the
// module's whole graph, and now the order client is in the browser's source map
// next to whatever env plumbing came with it. Two modules make that mistake a
// build error instead of a leak.
//
// ── The absent surface, stated up front ─────────────────────────────────────
//
// **There is no product UPDATE, and there never will be — the API has none.**
// See {@link createProduct}. This is the single most surprising thing about the
// Platform API and the reason that comment is where it is.

import { hmacSha256Base64, safeEqual } from "./index.js";

const PLATFORM_API = "https://api.fourthwall.com/open-api/v1.0";

// ── Config ───────────────────────────────────────────────────────────────────

export interface FourthwallPlatformConfig {
  /** API username from the Fourthwall dashboard. Server-only. */
  username: string;
  /** API password. Server-only — never ship this to a browser. */
  password: string;
  /**
   * Which shop these credentials belong to, for rate-limit accounting.
   *
   * Fourthwall counts its limits **per shop**, not per API user, so adding
   * users does not buy you more budget. The limiter keys its buckets on this
   * value; it defaults to `username`, which is right for the common
   * one-user-per-shop case and WRONG if you have several users on one shop —
   * there each would get its own bucket and the pair would overrun the real
   * limit together. Give every client for a shop the same string.
   */
  rateLimitKey?: string;
  /**
   * Client-side rate limiting. On by default — see {@link FourthwallRateLimits}
   * for what it does and, more importantly, what it cannot do. Pass `false` to
   * opt out when you coordinate limits yourself.
   */
  rateLimit?: FourthwallRateLimits | false;
  /**
   * Transient-failure retry. OFF by default, matching `commerce/square`: turn it
   * on for unattended paths (a cron sync, a queue consumer) where a 429 or a 5xx
   * should cost a second rather than fail the job. Never retries a 4xx other
   * than 429 — those are our bug, not Fourthwall's weather.
   *
   * **Not safe to enable blindly on order creation.** Unlike Square, Fourthwall
   * has no idempotency-key header, so a retried `POST /external-orders` that
   * actually succeeded server-side creates a SECOND order. See
   * {@link createExternalOrder}.
   */
  retry?: FourthwallRetryConfig;
}

export interface FourthwallRetryConfig {
  /** Attempts AFTER the first try. 0 disables. Defaults to 2. */
  attempts?: number;
  /** First backoff step in ms; doubles each attempt. Defaults to 250. */
  baseDelayMs?: number;
  /** Ceiling for one backoff step. Defaults to 4000. */
  maxDelayMs?: number;
}

/**
 * The two published limits, both counted per shop.
 *
 * Defaults match Fourthwall's documented numbers; override only to go *lower*
 * (say, to leave headroom for a second process). Raising them does not raise
 * the server's limit, it just moves where you find out.
 */
export interface FourthwallRateLimits {
  /** Requests per 10 seconds, all endpoints. Default 100. */
  globalPer10s?: number;
  /** `POST /products` per minute. Default 5. */
  productCreatesPerMinute?: number;
}

// ── Rate limiting ────────────────────────────────────────────────────────────
//
// A token bucket per shop, refilling continuously rather than resetting on a
// window boundary — a fixed window lets 2× the limit through across a boundary,
// which is exactly the burst a limiter is for.
//
// ⚠️ WHAT THIS CANNOT DO. The buckets live in module state, so they are per
// ISOLATE. Two Workers isolates, or a cron and a queue consumer running
// concurrently, each get a full bucket and can together exceed the shop's real
// budget. This prevents the failure that actually happens — one loop hammering
// `POST /products` and tripping a limit it could have paced itself under — and
// does not pretend to be distributed coordination. If you need that, put the
// calls behind a Durable Object and let it own the pacing.

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  /** Serializes acquisition. Without it, N concurrent callers all observe the
   *  same empty bucket, all sleep the same interval, and all take a token at
   *  the end — which is the burst this class exists to prevent. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
  ) {
    this.tokens = capacity;
  }

  /** Tokens per millisecond. */
  private get rate(): number {
    return this.capacity / this.windowMs;
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
    this.last = now;
  }

  private async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      await sleep(Math.ceil((1 - this.tokens) / this.rate));
      this.refill();
    }
    this.tokens = Math.max(0, this.tokens - 1);
  }

  take(): Promise<void> {
    const next = this.queue.then(() => this.acquire());
    // The chain must not stay rejected, or one failure wedges every later
    // caller behind it forever.
    this.queue = next.catch(() => {});
    return next;
  }
}

interface ShopBuckets {
  global: TokenBucket;
  productCreate: TokenBucket;
}

const shops = new Map<string, ShopBuckets>();

function bucketsFor(config: FourthwallPlatformConfig): ShopBuckets | null {
  if (config.rateLimit === false) return null;
  const key = config.rateLimitKey ?? config.username;
  const existing = shops.get(key);
  if (existing) return existing;
  const limits = config.rateLimit ?? {};
  const made: ShopBuckets = {
    global: new TokenBucket(limits.globalPer10s ?? 100, 10_000),
    productCreate: new TokenBucket(limits.productCreatesPerMinute ?? 5, 60_000),
  };
  shops.set(key, made);
  return made;
}

/**
 * Drop every cached rate-limit bucket.
 *
 * For tests, and for a long-lived process that rotates credentials — the map is
 * keyed by shop and would otherwise hold a bucket per key seen. Not needed in a
 * Worker, where the isolate's lifetime already bounds it.
 */
export function resetFourthwallRateLimits(): void {
  shops.clear();
}

// ── Request layer ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeader(config: FourthwallPlatformConfig): string {
  return `Basic ${btoa(`${config.username}:${config.password}`)}`;
}

/** Retryable = Fourthwall's weather, not our bug. A 400/401/403/404 means the
 *  request is wrong and will stay wrong. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** `Retry-After` in seconds, or null. The server's own number beats a guess. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

interface FwErrorBody {
  message?: string;
  error?: string;
  errors?: { message?: string; field?: string }[];
}

function platformError(method: string, path: string, status: number, body: unknown): Error {
  const b = (body ?? {}) as FwErrorBody;
  const detail = b.message ?? b.error ?? b.errors?.[0]?.message ?? "error";
  return new Error(`Fourthwall ${method} ${path} ${status}: ${String(detail).slice(0, 200)}`);
}

interface RequestInit_ {
  method: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Charge the `POST /products` bucket as well as the global one. */
  productCreate?: boolean;
}

async function fwFetch<T>(
  config: FourthwallPlatformConfig,
  path: string,
  init: RequestInit_,
): Promise<T> {
  const retry = config.retry;
  const attempts = Math.max(0, retry?.attempts ?? (retry ? 2 : 0));
  const baseDelay = retry?.baseDelayMs ?? 250;
  const maxDelay = retry?.maxDelayMs ?? 4000;

  const url = new URL(`${PLATFORM_API}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    const buckets = bucketsFor(config);
    if (buckets) {
      // Product creates spend from BOTH buckets: the narrow limit is a subset
      // of the global one, not an alternative to it.
      if (init.productCreate) await buckets.productCreate.take();
      await buckets.global.take();
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          authorization: authHeader(config),
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset) — retryable like a 5xx,
      // but with no response to read a status off.
      lastError = err;
      if (attempt === attempts) throw err;
      await sleep(Math.min(baseDelay * 2 ** attempt, maxDelay));
      continue;
    }

    // 204 and an empty 200 both mean "done, nothing to say" — `res.json()`
    // throws on an empty body, so it must not be the unconditional path.
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : (undefined as T);

    if (res.ok) return data;

    lastError = platformError(init.method, path, res.status, data);
    if (attempt === attempts || !retryableStatus(res.status)) throw lastError;

    const backoff = Math.min(baseDelay * 2 ** attempt, maxDelay);
    await sleep(retryAfterMs(res) ?? backoff + Math.random() * baseDelay);
  }
  throw lastError;
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Fourthwall money: major units (25 = $25.00), matching the Storefront API's
 *  `FwMoney`. Kept separate from `commerce`'s minor-unit `Money` on purpose —
 *  the two are not interchangeable and a shared name invites a 100× error. */
export interface FwPlatformMoney {
  value: number;
  currency: string;
}

// ── External orders ──────────────────────────────────────────────────────────
//
// The at-cost fulfillment rail: you sell wherever you like, Fourthwall
// manufactures and ships, and you pay cost rather than retail. That makes
// `validate` the important call — it returns the money BEFORE anything is
// committed, and skipping it means finding out what an order costs by being
// charged for it.

/** One line of an external order. */
export interface FwExternalOrderItem {
  variantId: string;
  quantity: number;
}

export interface FwExternalOrderAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  /** State / province. */
  state?: string;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  zip: string;
  phone?: string;
}

export interface FwExternalOrderInput {
  /** Your own order id. Fourthwall echoes it back, which is how you reconcile. */
  externalId?: string;
  items: FwExternalOrderItem[];
  shipping: FwExternalOrderAddress;
  email?: string;
  /** Anything else the Open API accepts; merged into the request body. */
  [key: string]: unknown;
}

/** What an order will cost you, all in major units. Returned by
 *  {@link validateExternalOrder} before you commit to anything. */
export interface FwExternalOrderCosts {
  manufacturingCost: FwPlatformMoney | null;
  fulfillmentFee: FwPlatformMoney | null;
  shippingCost: FwPlatformMoney | null;
  totalCreatorCost: FwPlatformMoney | null;
}

export interface FwExternalOrderValidation extends FwExternalOrderCosts {
  /** True when Fourthwall would accept this order as submitted. */
  valid: boolean;
  /** Why not, when `valid` is false. Empty otherwise. */
  problems: string[];
  /** The raw response, for fields this interface doesn't name. */
  raw: unknown;
}

/** Fourthwall's fulfillment state machine, as far as cancellation cares. */
export type FwExternalOrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "PACKAGED"
  | "SHIPPED"
  | "CANCELLED"
  | "DELIVERED";

/**
 * A status that autocompletes to the known set but still accepts a string
 * Fourthwall adds later.
 *
 * The `(string & {})` is the trick that makes that work: a plain
 * `FwExternalOrderStatus | string` collapses to `string` during reduction and
 * you lose the completions entirely, which is the opposite of the intent.
 */
export type FwOrderStatusLike = FwExternalOrderStatus | (string & {});

export interface FwExternalOrder {
  id: string;
  externalId: string | null;
  status: FwOrderStatusLike;
  createdAt: string | null;
  /** The raw order, for fields this interface doesn't name. */
  raw: unknown;
}

function money(raw: unknown): FwPlatformMoney | null {
  const m = raw as { value?: unknown; currency?: unknown } | null | undefined;
  if (!m || typeof m.value !== "number") return null;
  return { value: m.value, currency: typeof m.currency === "string" ? m.currency : "USD" };
}

function mapCosts(raw: Record<string, unknown>): FwExternalOrderCosts {
  return {
    manufacturingCost: money(raw.manufacturingCost),
    fulfillmentFee: money(raw.fulfillmentFee),
    shippingCost: money(raw.shippingCost),
    totalCreatorCost: money(raw.totalCreatorCost),
  };
}

function mapOrder(raw: unknown): FwExternalOrder {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof o.id === "string" ? o.id : "",
    externalId: typeof o.externalId === "string" ? o.externalId : null,
    status: typeof o.status === "string" ? o.status : "",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : null,
    raw,
  };
}

/** Some endpoints wrap results as `{ results: [...] }`, others return a bare
 *  array — the same defensiveness the Storefront client carries. */
function unwrap<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const wrapped = data as { results?: unknown; data?: unknown } | null | undefined;
  if (Array.isArray(wrapped?.results)) return wrapped.results as T[];
  if (Array.isArray(wrapped?.data)) return wrapped.data as T[];
  return [];
}

/**
 * Price an external order **without creating it**.
 *
 * Call this first, always. It is the only place the at-cost numbers —
 * `manufacturingCost`, `fulfillmentFee`, `shippingCost`, `totalCreatorCost` —
 * are available before money is committed, and an order you did not validate is
 * an order whose cost you learn by being billed for it. Shipping in particular
 * is not knowable up front: it depends on the destination and on how Fourthwall
 * splits the items across facilities.
 *
 * POST /external-orders/validate
 */
export async function validateExternalOrder(
  config: FourthwallPlatformConfig,
  order: FwExternalOrderInput,
): Promise<FwExternalOrderValidation> {
  const raw = await fwFetch<Record<string, unknown>>(config, "/external-orders/validate", {
    method: "POST",
    body: order,
  });
  const body = raw ?? {};
  const problems = Array.isArray(body.errors)
    ? body.errors.map((e) =>
        typeof e === "string" ? e : String((e as { message?: unknown })?.message ?? e),
      )
    : [];
  return {
    // Fourthwall answers 200 for a validation that FAILED, with the reasons in
    // the body — so `res.ok` is not the answer and treating it as one would
    // submit an order that was just told it wouldn't work.
    valid: body.valid === true || (body.valid === undefined && problems.length === 0),
    problems,
    ...mapCosts(body),
    raw,
  };
}

/**
 * Create an external order. Chargeable.
 *
 * **Fourthwall has no idempotency-key header.** A retried create that actually
 * succeeded server-side produces a SECOND order and a second charge, so this
 * call disables `config.retry` for itself rather than trusting a caller who
 * enabled retries globally for a sync job. If you need at-most-once across a
 * queue redelivery, that is yours to arrange: set `externalId`, and reconcile
 * with {@link listExternalOrders} before creating.
 *
 * POST /external-orders
 */
export async function createExternalOrder(
  config: FourthwallPlatformConfig,
  order: FwExternalOrderInput,
): Promise<FwExternalOrder> {
  const raw = await fwFetch<unknown>({ ...config, retry: undefined }, "/external-orders", {
    method: "POST",
    body: order,
  });
  return mapOrder(raw);
}

export interface FwListOrdersOptions {
  /** 0-based page index. */
  page?: number;
  /** Page size. */
  size?: number;
  status?: FwOrderStatusLike;
}

/** List external orders. GET /external-orders */
export async function listExternalOrders(
  config: FourthwallPlatformConfig,
  options: FwListOrdersOptions = {},
): Promise<FwExternalOrder[]> {
  const raw = await fwFetch<unknown>(config, "/external-orders", {
    method: "GET",
    query: { page: options.page, size: options.size, status: options.status },
  });
  return unwrap<unknown>(raw).map(mapOrder);
}

/** One external order, or null when it does not exist.
 *  GET /external-orders/{id} */
export async function getExternalOrder(
  config: FourthwallPlatformConfig,
  id: string,
): Promise<FwExternalOrder | null> {
  try {
    const raw = await fwFetch<unknown>(config, `/external-orders/${encodeURIComponent(id)}`, {
      method: "GET",
    });
    return raw ? mapOrder(raw) : null;
  } catch (err) {
    // A missing order is a legitimate answer, not an exception the caller
    // should have to catch — same treatment as `retrieveLocation` in the Square
    // client.
    if (err instanceof Error && / 404: /.test(err.message)) return null;
    throw err;
  }
}

/**
 * Cancel an external order.
 *
 * **Only possible early.** Once Fourthwall has moved the order to `PACKAGED` or
 * `SHIPPED` the goods physically exist and are moving, and the API refuses —
 * which surfaces here as the request throwing, not as a `false`. Check
 * {@link getExternalOrder} first if you want to branch rather than catch.
 *
 * POST /external-orders/{id}/cancel
 */
export async function cancelExternalOrder(
  config: FourthwallPlatformConfig,
  id: string,
): Promise<FwExternalOrder> {
  const raw = await fwFetch<unknown>(config, `/external-orders/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: {},
  });
  return mapOrder(raw);
}

/** True for the two states Fourthwall will not cancel out of. Cheap local
 *  check so a UI can hide the button rather than offer an action that throws. */
export function isCancellable(order: Pick<FwExternalOrder, "status">): boolean {
  return !["PACKAGED", "SHIPPED", "CANCELLED", "DELIVERED"].includes(order.status);
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface FwInventoryEntry {
  variantId: string;
  /** Units available, or null when the variant is not stock-tracked. */
  quantity: number | null;
  raw: unknown;
}

/**
 * Stock for one product's variants. **Read-only — Fourthwall has no inventory
 * write endpoint**, so a mirror can reflect stock but never push it.
 *
 * There is also **no inventory webhook**, which is the operationally important
 * half: stock drift is only detectable by polling. Pick an interval against how
 * bad an oversell is for you rather than against how fresh you would like the
 * number to be.
 *
 * GET /products/{id}/inventory
 */
export async function getProductInventory(
  config: FourthwallPlatformConfig,
  productId: string,
): Promise<FwInventoryEntry[]> {
  const raw = await fwFetch<unknown>(
    config,
    `/products/${encodeURIComponent(productId)}/inventory`,
    { method: "GET" },
  );
  return unwrap<unknown>(raw).map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    return {
      variantId: typeof e.variantId === "string" ? e.variantId : "",
      quantity: typeof e.quantity === "number" ? e.quantity : null,
      raw: entry,
    };
  });
}

// ── Products ─────────────────────────────────────────────────────────────────

/**
 * A physical product. Priced by **`profitMargin`, not by retail price** — you
 * choose what you make per unit and Fourthwall derives the price from that plus
 * its own cost. Setting an absolute price is not expressible, so a "price" field
 * copied over from another provider's model is silently ignored.
 */
export interface FwPhysicalProductInput {
  kind: "physical";
  name: string;
  description?: string;
  collectionId?: string;
  /** Your profit per unit, in major units. */
  profitMargin: number;
  /** Anything else the Open API accepts; merged into the request body. */
  [key: string]: unknown;
}

/** A digital product — the only kind that takes an absolute {@link price}. */
export interface FwDigitalProductInput {
  kind: "digital";
  name: string;
  description?: string;
  collectionId?: string;
  price: FwPlatformMoney;
  /** Anything else the Open API accepts; merged into the request body. */
  [key: string]: unknown;
}

export type FwProductInput = FwPhysicalProductInput | FwDigitalProductInput;

export interface FwPlatformProduct {
  id: string;
  name: string;
  slug: string | null;
  state: string | null;
  raw: unknown;
}

function mapProduct(raw: unknown): FwPlatformProduct {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof p.id === "string" ? p.id : "",
    name: typeof p.name === "string" ? p.name : "",
    slug: typeof p.slug === "string" ? p.slug : null,
    state: typeof p.state === "string" ? p.state : null,
    raw,
  };
}

/**
 * Create a product.
 *
 * ## There is no update. Not "not yet" — none.
 *
 * The Platform API exposes no endpoint to change a product's name, description,
 * price, or variants after creation. {@link setProductAvailability} and
 * {@link setProductState} toggle whether an existing product is purchasable, and
 * {@link addProductImages} appends; nothing edits. If a detail is wrong, the
 * only remedy is {@link deleteProduct} and create again — which mints a NEW id,
 * so anything of yours keyed on the old one (a catalog mirror row, a saved cart,
 * an order line) has to be reconciled.
 *
 * Two consequences worth designing around:
 *
 *   * Get it right the first time. Validate your own inputs before calling —
 *     there is no correction pass.
 *   * Do not treat product ids as stable across an edit. They are stable across
 *     time and unstable across a "change", because a change is a re-create.
 *
 * ## Rate limit and latency
 *
 * This is the throttled endpoint: **5 per minute per shop**, and it also runs a
 * synchronous mockup render, so it is slow as well as rare. The client paces
 * itself (see {@link FourthwallRateLimits}) rather than failing — a bulk import
 * of 50 products takes ten minutes by design, and the alternative is 45 of them
 * erroring.
 *
 * POST /products
 */
export async function createProduct(
  config: FourthwallPlatformConfig,
  input: FwProductInput,
): Promise<FwPlatformProduct> {
  const { kind, ...body } = input;
  const raw = await fwFetch<unknown>(config, "/products", {
    method: "POST",
    body: { ...body, type: kind === "digital" ? "DIGITAL" : "PHYSICAL" },
    productCreate: true,
  });
  return mapProduct(raw);
}

/**
 * Delete a product. Permanent, and the only way to "edit" one — see
 * {@link createProduct}. DELETE /products/{id}
 */
export async function deleteProduct(
  config: FourthwallPlatformConfig,
  productId: string,
): Promise<void> {
  await fwFetch<void>(config, `/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
}

/**
 * Whether a product can be bought at all. Distinct from
 * {@link setProductState}: availability is the shop-level switch, state is the
 * product's own lifecycle.
 *
 * POST /products/{id}/availability
 */
export async function setProductAvailability(
  config: FourthwallPlatformConfig,
  productId: string,
  available: boolean,
): Promise<FwPlatformProduct> {
  const raw = await fwFetch<unknown>(
    config,
    `/products/${encodeURIComponent(productId)}/availability`,
    { method: "POST", body: { available } },
  );
  return mapProduct(raw);
}

/** Set a product's lifecycle state (e.g. `"AVAILABLE"`, `"UNAVAILABLE"`).
 *  POST /products/{id}/state */
export async function setProductState(
  config: FourthwallPlatformConfig,
  productId: string,
  state: string,
): Promise<FwPlatformProduct> {
  const raw = await fwFetch<unknown>(config, `/products/${encodeURIComponent(productId)}/state`, {
    method: "POST",
    body: { state },
  });
  return mapProduct(raw);
}

/**
 * Append images to a product. **Appends** — there is no replace, and no update
 * (see {@link createProduct}), so an image added by mistake stays.
 *
 * POST /products/{id}/images
 */
export async function addProductImages(
  config: FourthwallPlatformConfig,
  productId: string,
  imageUrls: string[],
): Promise<FwPlatformProduct> {
  const raw = await fwFetch<unknown>(config, `/products/${encodeURIComponent(productId)}/images`, {
    method: "POST",
    body: { images: imageUrls.map((url) => ({ url })) },
  });
  return mapProduct(raw);
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * Verify a Platform API webhook signature.
 *
 * Identical scheme to the Storefront webhooks — base64 HMAC-SHA256 of the raw
 * body in `X-Fourthwall-Hmac-SHA256` — but re-exported here so a server that
 * only imports the Platform module doesn't have to reach into the storefront
 * one, which is the import this module's whole split exists to discourage.
 *
 * `payload` must be the raw body text, read before any JSON parsing.
 */
export async function verifyFourthwallPlatformSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const expected = await hmacSha256Base64(secret, payload);
  return safeEqual(expected, header.trim());
}
