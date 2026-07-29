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

import { s } from "../schema/index.js";
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
  /** Transient-failure retry. OFF by default, so existing callers are byte-for-byte
   *  unchanged; turn it on for unattended paths (cron sync, queue consumers) where
   *  a 429 or a 5xx should cost a second rather than fail the job. Never retries a
   *  4xx other than 429 — those are our bug, not Square's weather. */
  retry?: SquareRetryConfig;
}

export interface SquareRetryConfig {
  /** Attempts AFTER the first try. 0 disables. Defaults to 2. */
  attempts?: number;
  /** First backoff step in ms; doubles each attempt. Defaults to 250. */
  baseDelayMs?: number;
  /** Ceiling for one backoff step. Defaults to 4000. */
  maxDelayMs?: number;
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

/** Retryable = Square's weather, not our bug: rate limiting and server faults.
 *  A 400/401/403/404 means the request itself is wrong and will stay wrong. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** `Retry-After` in seconds (Square sends it on 429), or null. Honouring the
 *  server's own number beats guessing with a backoff curve. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The single request path every sq* helper goes through.
 *
 * Retries only when `config.retry` is set, so behaviour is unchanged for callers
 * that never opt in. Idempotency is the caller's job and Square's model makes
 * that workable: every mutating endpoint here takes an `idempotency_key`, so a
 * retried POST that actually succeeded server-side collapses rather than
 * double-charging — which is exactly why retrying POSTs is safe at all.
 */
async function sqFetch<T>(
  config: SquareConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const retry = config.retry;
  const attempts = Math.max(0, retry?.attempts ?? (retry ? 2 : 0));
  const baseDelay = retry?.baseDelayMs ?? 250;
  const maxDelay = retry?.maxDelayMs ?? 4000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${host(config)}${path}`, {
        method: init.method,
        headers: headers(config),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset) — retryable in the same
      // way a 5xx is, but there is no response to read a status off.
      lastError = err;
      if (attempt === attempts) throw err;
      await sleep(Math.min(baseDelay * 2 ** attempt, maxDelay));
      continue;
    }

    const data = (await res.json()) as T & SquareErrorBody;
    if (res.ok) return data;

    lastError = squareError(path, res.status, data);
    if (attempt === attempts || !retryableStatus(res.status)) throw lastError;

    // Prefer Square's own Retry-After; otherwise exponential backoff with a
    // little jitter so concurrent workers don't resynchronize on the same tick.
    const backoff = Math.min(baseDelay * 2 ** attempt, maxDelay);
    await sleep(retryAfterMs(res) ?? backoff + Math.random() * baseDelay);
  }
  throw lastError;
}

function sqGet<T>(config: SquareConfig, path: string): Promise<T> {
  return sqFetch<T>(config, path, { method: "GET" });
}

function sqPost<T>(config: SquareConfig, path: string, body: unknown): Promise<T> {
  return sqFetch<T>(config, path, { method: "POST", body });
}

function sqPut<T>(config: SquareConfig, path: string, body: unknown): Promise<T> {
  return sqFetch<T>(config, path, { method: "PUT", body });
}

function sqDelete<T>(config: SquareConfig, path: string): Promise<T> {
  return sqFetch<T>(config, path, { method: "DELETE" });
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Square money is an integer amount in the currency's minor unit (cents) —
 *  the shared {@link Money} shape. */
export type SquareMoney = Money;

// `centsToMajor` is a shared commerce helper (louise-toolkit/commerce); re-exported
// so `louise-toolkit/commerce/square` keeps exposing it.
export { centsToMajor };

// ── Locations ────────────────────────────────────────────────────────────────
//
// A Square Location is a place that sells. Multi-merchant sites map one merchant
// to one Location: that is what buys per-merchant pricing (`location_overrides`)
// and per-merchant stock off a single shared catalog, at no extra cost —
// Locations are free, and the cap is 300.

export interface SquareLocation {
  id: string;
  name: string;
  /** ACTIVE | INACTIVE. Inactive locations still resolve but should not be sold at. */
  status: string;
  /** ISO 4217, e.g. "USD". A location's currency is fixed at creation. */
  currency: string;
  timezone: string | null;
  /** Formatted single-line address, or null when the location has none. */
  address: string | null;
  businessName: string | null;
}

interface RawLocation {
  id?: string;
  name?: string;
  status?: string;
  currency?: string;
  timezone?: string;
  business_name?: string;
  address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    administrative_district_level_1?: string;
    postal_code?: string;
  };
}

function mapLocation(raw: RawLocation): SquareLocation {
  const a = raw.address;
  const line = [
    a?.address_line_1,
    a?.address_line_2,
    a?.locality,
    a?.administrative_district_level_1,
    a?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    status: raw.status ?? "",
    currency: raw.currency ?? "USD",
    timezone: raw.timezone ?? null,
    address: line || null,
    businessName: raw.business_name ?? null,
  };
}

/** Every location on the account. GET /v2/locations — unpaginated by design
 *  (Square caps an account at 300 locations and returns them all). */
export async function listLocations(config: SquareConfig): Promise<SquareLocation[]> {
  const res = await sqGet<{ locations?: RawLocation[] }>(config, "/v2/locations");
  return (res.locations ?? []).map(mapLocation);
}

/** One location by id, or null when it does not exist. GET /v2/locations/{id}. */
export async function retrieveLocation(
  config: SquareConfig,
  locationId: string,
): Promise<SquareLocation | null> {
  try {
    const res = await sqGet<{ location?: RawLocation }>(
      config,
      `/v2/locations/${encodeURIComponent(locationId)}`,
    );
    return res.location ? mapLocation(res.location) : null;
  } catch (err) {
    // A missing location is a 404 and a legitimate answer ("this merchant has no
    // Square location yet"), not an error the caller should have to catch.
    if (err instanceof Error && / 404: /.test(err.message)) return null;
    throw err;
  }
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/** Per-location presence, carried on the CatalogObject itself (not inside
 *  `item_data`). Square's model is "present everywhere except…" or "present
 *  nowhere except…", selected by `present_at_all_locations`. */
interface RawPresence {
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
}

/** A per-location price/inventory override on an ITEM_VARIATION. This is what
 *  makes one shared catalog serve many merchants at different prices. */
interface RawLocationOverride {
  location_id?: string;
  price_money?: { amount?: number; currency?: string };
  pricing_type?: string;
  track_inventory?: boolean;
  sold_out?: boolean;
}

interface RawVariationData {
  name?: string;
  sku?: string;
  price_money?: { amount?: number; currency?: string };
  location_overrides?: RawLocationOverride[];
}

interface RawCatalogObject extends RawPresence {
  id: string;
  type: string;
  version?: number;
  is_deleted?: boolean;
  /** Present on ITEM_VARIATION objects returned top-level (batch-retrieve). */
  item_variation_data?: RawVariationData;
  item_data?: {
    name?: string;
    description?: string;
    image_ids?: string[];
    variations?: ({
      id: string;
      type: string;
      version?: number;
      item_variation_data?: RawVariationData;
    } & RawPresence)[];
    // Detailed-extraction fields (see listCatalogDetailed). Optional + ignored by
    // the plain listCatalogItems, so adding them is backwards-compatible.
    reporting_category?: { id?: string };
    categories?: { id?: string }[];
    modifier_list_info?: {
      modifier_list_id?: string;
      min_selected_modifiers?: number;
      max_selected_modifiers?: number;
      enabled?: boolean;
    }[];
  };
  // Present on CATEGORY / MODIFIER_LIST search results (listCategories /
  // listModifierLists).
  category_data?: {
    name?: string;
    category_type?: string;
    is_top_level?: boolean;
    ordinal?: number;
    parent_category?: { id?: string; ordinal?: number };
  };
  modifier_list_data?: {
    name?: string;
    selection_type?: string;
    modifiers?: {
      id: string;
      is_deleted?: boolean;
      modifier_data?: {
        name?: string;
        price_money?: { amount?: number };
        ordinal?: number;
        on_by_default?: boolean;
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

/** Where a catalog object is sold. Square models this as "everywhere except" or
 *  "nowhere except" — {@link presentAt} collapses that to a single predicate so
 *  callers never re-derive the logic. */
export interface SquarePresence {
  presentAtAllLocations: boolean;
  presentAtLocationIds: string[];
  absentAtLocationIds: string[];
}

/** A per-location price override on a variation. Absent `priceCents` means the
 *  override adjusts something other than price (availability, inventory
 *  tracking) and the base price still applies. */
export interface SquareLocationOverride {
  locationId: string;
  priceCents: number | null;
  currency: string | null;
  trackInventory: boolean | null;
  soldOut: boolean | null;
}

/**
 * Is this object sold at `locationId`?
 *
 * The two lists are not symmetric: `present_at_location_ids` is a whitelist used
 * when `present_at_all_locations` is false, `absent_at_location_ids` a blacklist
 * used when it is true. Getting this backwards silently shows a merchant
 * products they don't carry, so it lives in exactly one place.
 */
export function presentAt(presence: SquarePresence, locationId: string): boolean {
  return presence.presentAtAllLocations
    ? !presence.absentAtLocationIds.includes(locationId)
    : presence.presentAtLocationIds.includes(locationId);
}

export interface SquareVariation extends SquarePresence {
  id: string;
  name: string;
  sku: string | null;
  /** The BASE price. For what a given merchant charges, use
   *  {@link priceAtLocation} — the override wins where one exists. */
  priceCents: number;
  currency: string;
  /** Per-location price overrides, empty when the base price applies everywhere. */
  locationOverrides: SquareLocationOverride[];
  /** Object version — pass back to {@link upsertCatalogItem} when updating. */
  version: number;
}

/**
 * The effective price of a variation at one location: the location's override
 * if it sets a price, otherwise the base price. This is the single definition of
 * "what does this cost here", and server-side re-pricing at checkout must use it
 * rather than trusting a client-submitted amount.
 */
export function priceAtLocation(variation: SquareVariation, locationId: string): SquareMoney {
  const override = variation.locationOverrides.find((o) => o.locationId === locationId);
  if (override?.priceCents != null) {
    return { amount: override.priceCents, currency: override.currency ?? variation.currency };
  }
  return { amount: variation.priceCents, currency: variation.currency };
}

export interface SquareCatalogItem extends SquarePresence {
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

/** Normalize the three presence fields, defaulting to Square's own default
 *  (`present_at_all_locations` is true when the field is absent). */
function mapPresence(raw: RawPresence): SquarePresence {
  return {
    presentAtAllLocations: raw.present_at_all_locations ?? true,
    presentAtLocationIds: raw.present_at_location_ids ?? [],
    absentAtLocationIds: raw.absent_at_location_ids ?? [],
  };
}

function mapLocationOverrides(data: RawVariationData | undefined): SquareLocationOverride[] {
  return (data?.location_overrides ?? [])
    .filter((o) => o.location_id)
    .map((o) => ({
      locationId: o.location_id as string,
      priceCents: o.price_money?.amount ?? null,
      currency: o.price_money?.currency ?? null,
      trackInventory: o.track_inventory ?? null,
      soldOut: o.sold_out ?? null,
    }));
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
      locationOverrides: mapLocationOverrides(v.item_variation_data),
      version: v.version ?? 0,
      ...mapPresence(v),
    }));
  return {
    id: obj.id,
    name: data.name ?? "",
    description: data.description ?? "",
    imageUrl: firstImageId ? (images.get(firstImageId) ?? null) : null,
    variations,
    version: obj.version ?? 0,
    ...mapPresence(obj),
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
      const price = obj.item_variation_data?.price_money;
      prices.set(obj.id, { amount: price?.amount ?? 0, currency: price?.currency ?? "USD" });
    }
  }
  return prices;
}

/**
 * Like {@link retrieveVariationPrices}, but resolves each price **at a specific
 * location** — the location's `location_overrides` price where one exists, else
 * the base price.
 *
 * This is the multi-merchant checkout guard. One shared catalog is sold at
 * different prices per merchant to absorb each shop's commission, so verifying a
 * cart against base prices would let a customer pay the cheapest merchant's
 * price at the dearest merchant's storefront. Re-price against the location the
 * order is actually being placed at, never against the client's numbers.
 *
 * A variation absent at `locationId` is omitted from the result entirely, so a
 * caller that requires every id to resolve will fail closed rather than silently
 * selling something the merchant does not carry.
 */
export async function retrieveVariationPricesAt(
  config: SquareConfig,
  variationIds: string[],
  locationId: string,
): Promise<Map<string, SquareMoney>> {
  const res = await sqPost<{ objects?: RawCatalogObject[] }>(config, "/v2/catalog/batch-retrieve", {
    object_ids: variationIds,
  });
  const prices = new Map<string, SquareMoney>();
  for (const obj of res.objects ?? []) {
    if (obj.type !== "ITEM_VARIATION") continue;
    if (!presentAt(mapPresence(obj), locationId)) continue;

    const data = obj.item_variation_data;
    const override = mapLocationOverrides(data).find((o) => o.locationId === locationId);
    if (override?.priceCents != null) {
      prices.set(obj.id, {
        amount: override.priceCents,
        currency: override.currency ?? data?.price_money?.currency ?? "USD",
      });
      continue;
    }
    prices.set(obj.id, {
      amount: data?.price_money?.amount ?? 0,
      currency: data?.price_money?.currency ?? "USD",
    });
  }
  return prices;
}

// ── Catalog: detailed extraction (categories, reporting category, modifiers) ──
//
// The plain `listCatalogItems` returns just the mapped items. A storefront that
// also drives category filters and order-ahead customization needs three more
// things Square carries on each item + in its own object types: category
// membership, the `reporting_category`, and enabled modifier-list bounds. Those
// live here so any Square site inherits them, rather than each re-implementing
// the extraction over `/v2/catalog/search`.

/** A REGULAR Square category (product taxonomy). The parallel MENU_CATEGORY tree
 *  (Square Online display) is filtered out by {@link listCategories}. */
export interface SquareCategory {
  id: string;
  name: string;
  /** URL-safe slug (e.g. a shop's `?cat=` value). */
  slug: string;
  /** Parent category id, or null for a top-level category. */
  parentId: string | null;
  isTop: boolean;
  /** Square display ordinal (lower sorts first); 0 when absent. */
  ordinal: number;
}

/** A single modifier (a size, a milk, an add-on) — name + price adjustment. */
export interface SquareModifier {
  id: string;
  name: string;
  priceCents: number;
  onByDefault?: boolean;
}

/** A modifier list by id (name + selection type + children). The per-item
 *  min/max bounds live in {@link ItemModifierRef}, joined when resolving a product. */
export interface SquareModifierList {
  id: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  modifiers: SquareModifier[];
}

/** An item's reference to a modifier list, with its selection bounds. */
export interface ItemModifierRef {
  id: string;
  min: number;
  max: number;
}

/** {@link listCatalogItems}'s items plus the per-item category / reporting-category
 *  / modifier extraction a storefront needs. */
export interface DetailedCatalog {
  items: SquareCatalogItem[];
  /** itemId → every category id it references. */
  itemCategories: Record<string, string[]>;
  /** itemId → its `reporting_category` id. */
  reportingCategory: Record<string, string>;
  /** itemId → its enabled modifier-list refs (id + selection bounds). */
  itemModifiers: Record<string, ItemModifierRef[]>;
}

/** URL-safe slug from a display name. */
function catalogSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Like {@link listCatalogItems}, but ALSO returns each item's category refs, its
 * `reporting_category`, and its enabled modifier-list bounds. One walk of
 * `/v2/catalog/search` over ITEMs. Square uses -1 for an "unset" min/max — this
 * normalizes those to 0 (optional / unbounded).
 */
export async function listCatalogDetailed(config: SquareConfig): Promise<DetailedCatalog> {
  const items: SquareCatalogItem[] = [];
  const itemCategories: Record<string, string[]> = {};
  const reportingCategory: Record<string, string> = {};
  const itemModifiers: Record<string, ItemModifierRef[]> = {};
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
      if (obj.type !== "ITEM" || obj.is_deleted) continue;
      items.push(mapCatalogItem(obj, images));
      const d = obj.item_data ?? {};
      const cats = (d.categories ?? []).map((c) => c.id).filter((x): x is string => !!x);
      if (cats.length) itemCategories[obj.id] = cats;
      if (d.reporting_category?.id) reportingCategory[obj.id] = d.reporting_category.id;
      const mods = (d.modifier_list_info ?? [])
        .filter((m) => m.enabled !== false && !!m.modifier_list_id)
        .map((m) => ({
          id: m.modifier_list_id as string,
          min:
            typeof m.min_selected_modifiers === "number" && m.min_selected_modifiers > 0
              ? m.min_selected_modifiers
              : 0,
          max:
            typeof m.max_selected_modifiers === "number" && m.max_selected_modifiers > 0
              ? m.max_selected_modifiers
              : 0,
        }));
      if (mods.length) itemModifiers[obj.id] = mods;
    }
    cursor = res.cursor;
    if (!cursor) break;
  }
  return { items, itemCategories, reportingCategory, itemModifiers };
}

/**
 * List every non-deleted REGULAR catalog CATEGORY (the product taxonomy). The
 * parallel MENU_CATEGORY tree (Square Online display) is dropped.
 * POST /v2/catalog/search.
 */
export async function listCategories(config: SquareConfig): Promise<SquareCategory[]> {
  const cats: SquareCategory[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await sqPost<CatalogSearchResponse>(config, "/v2/catalog/search", {
      object_types: ["CATEGORY"],
      include_deleted_objects: false,
      ...(cursor ? { cursor } : {}),
    });
    for (const obj of res.objects ?? []) {
      const d = obj.category_data;
      if (obj.type !== "CATEGORY" || obj.is_deleted || !d) continue;
      if (d.category_type && d.category_type !== "REGULAR_CATEGORY") continue;
      const name = d.name ?? "";
      cats.push({
        id: obj.id,
        name,
        slug: catalogSlug(name),
        parentId: d.parent_category?.id ?? null,
        isTop: !!d.is_top_level,
        ordinal: d.ordinal ?? d.parent_category?.ordinal ?? 0,
      });
    }
    cursor = res.cursor;
    if (!cursor) break;
  }
  return cats;
}

/**
 * List every non-deleted MODIFIER_LIST (size/milk/shots…) with its MODIFIER
 * children, as an id→list map. The per-item min/max bounds are joined from
 * {@link DetailedCatalog.itemModifiers} when resolving a product.
 * POST /v2/catalog/search.
 */
export async function listModifierLists(
  config: SquareConfig,
): Promise<Record<string, SquareModifierList>> {
  const lists: Record<string, SquareModifierList> = {};
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await sqPost<CatalogSearchResponse>(config, "/v2/catalog/search", {
      object_types: ["MODIFIER_LIST"],
      include_deleted_objects: false,
      ...(cursor ? { cursor } : {}),
    });
    for (const obj of res.objects ?? []) {
      const d = obj.modifier_list_data;
      if (obj.type !== "MODIFIER_LIST" || obj.is_deleted || !d) continue;
      const modifiers: SquareModifier[] = (d.modifiers ?? [])
        .filter((m) => !m.is_deleted && !!m.modifier_data)
        .sort((a, b) => (a.modifier_data?.ordinal ?? 0) - (b.modifier_data?.ordinal ?? 0))
        .map((m) => ({
          id: m.id,
          name: m.modifier_data?.name ?? "",
          priceCents: m.modifier_data?.price_money?.amount ?? 0,
          ...(m.modifier_data?.on_by_default ? { onByDefault: true } : {}),
        }));
      lists[obj.id] = {
        id: obj.id,
        name: d.name ?? "",
        selectionType: d.selection_type === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
        modifiers,
      };
    }
    cursor = res.cursor;
    if (!cursor) break;
  }
  return lists;
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
  /** Per-location price overrides — the multi-merchant pricing lever. Omit to
   *  sell at the base price everywhere. */
  locationOverrides?: {
    locationId: string;
    /** Omit to override availability/inventory without changing price. */
    priceCents?: number;
    currency?: string;
    trackInventory?: boolean;
    soldOut?: boolean;
  }[];
  /** Where this variation is sold. Omit for "everywhere". */
  presence?: Partial<SquarePresence>;
}

/** Serialize presence for a write, omitting the keys the caller didn't set so we
 *  never overwrite Square-side presence with an accidental default. */
function presenceBody(presence: Partial<SquarePresence> | undefined) {
  if (!presence) return {};
  return {
    ...(presence.presentAtAllLocations != null
      ? { present_at_all_locations: presence.presentAtAllLocations }
      : {}),
    ...(presence.presentAtLocationIds
      ? { present_at_location_ids: presence.presentAtLocationIds }
      : {}),
    ...(presence.absentAtLocationIds
      ? { absent_at_location_ids: presence.absentAtLocationIds }
      : {}),
  };
}

function overridesBody(overrides: CatalogVariationInput["locationOverrides"]) {
  if (!overrides?.length) return {};
  return {
    location_overrides: overrides.map((o) => ({
      location_id: o.locationId,
      ...(o.priceCents != null
        ? {
            price_money: { amount: o.priceCents, currency: o.currency ?? "USD" },
            // An override that sets a price must also declare its pricing type,
            // or Square keeps inheriting VARIABLE_PRICING from the parent.
            pricing_type: "FIXED_PRICING",
          }
        : {}),
      ...(o.trackInventory != null ? { track_inventory: o.trackInventory } : {}),
      ...(o.soldOut != null ? { sold_out: o.soldOut } : {}),
    })),
  };
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
    /** Where the ITEM is sold. Omit for "everywhere". */
    presence?: Partial<SquarePresence>;
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
      ...presenceBody(input.presence),
      item_data: {
        name: input.name,
        description: input.description,
        variations: input.variations.map((v, i) => ({
          type: "ITEM_VARIATION",
          id: v.id ?? v.clientId ?? `#var-${i}`,
          ...(v.version != null ? { version: v.version } : {}),
          ...presenceBody(v.presence),
          item_variation_data: {
            item_id: itemId,
            name: v.name,
            sku: v.sku,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: v.priceCents, currency: v.currency ?? "USD" },
            ...overridesBody(v.locationOverrides),
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

/** One ITEM in a {@link batchUpsertCatalogObjects} call. */
export interface CatalogItemInput {
  id?: string;
  /** Stable client key echoed back in `idMappings` for a NEW item. */
  clientId?: string;
  name: string;
  description?: string;
  variations: CatalogVariationInput[];
  version?: number;
  presence?: Partial<SquarePresence>;
}

/**
 * Upsert many ITEMs in one call. POST /v2/catalog/batch-upsert.
 *
 * The per-object {@link upsertCatalogItem} costs one request per item, which
 * turns a full catalog push into a rate-limit problem. This batches them —
 * Square allows up to 1,000 objects per request across at most 10 batches, and
 * this splits the input accordingly.
 *
 * The whole request is atomic: if any object is rejected, none are written. That
 * is usually what you want for a catalog push (no half-applied price change),
 * but it does mean one stale `version` fails the entire batch.
 */
export async function batchUpsertCatalogObjects(
  config: SquareConfig,
  items: CatalogItemInput[],
  options?: { idempotencyKey?: string },
): Promise<{ idMappings: Record<string, string>; objects: SquareCatalogItem[] }> {
  const objects = items.map((item, i) => {
    const itemId = item.id ?? item.clientId ?? `#item-${i}`;
    return {
      type: "ITEM",
      id: itemId,
      ...(item.version != null ? { version: item.version } : {}),
      ...presenceBody(item.presence),
      item_data: {
        name: item.name,
        description: item.description,
        variations: item.variations.map((v, j) => ({
          type: "ITEM_VARIATION",
          id: v.id ?? v.clientId ?? `#var-${i}-${j}`,
          ...(v.version != null ? { version: v.version } : {}),
          ...presenceBody(v.presence),
          item_variation_data: {
            item_id: itemId,
            name: v.name,
            sku: v.sku,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: v.priceCents, currency: v.currency ?? "USD" },
            ...overridesBody(v.locationOverrides),
          },
        })),
      },
    };
  });

  // Square: max 1,000 objects per request, max 10 batches per request.
  const perBatch = Math.max(1, Math.ceil(objects.length / 10));
  const batches: (typeof objects)[] = [];
  for (let i = 0; i < objects.length; i += perBatch) {
    batches.push(objects.slice(i, i + perBatch));
  }

  const res = await sqPost<{
    objects?: RawCatalogObject[];
    id_mappings?: { client_object_id?: string; object_id?: string }[];
  }>(config, "/v2/catalog/batch-upsert", {
    idempotency_key: options?.idempotencyKey ?? crypto.randomUUID(),
    batches: batches.map((objs) => ({ objects: objs })),
  });

  const idMappings: Record<string, string> = {};
  for (const m of res.id_mappings ?? []) {
    if (m.client_object_id && m.object_id) idMappings[m.client_object_id] = m.object_id;
  }
  const images = new Map<string, string>();
  return {
    idMappings,
    objects: (res.objects ?? [])
      .filter((o) => o.type === "ITEM")
      .map((o) => mapCatalogItem(o, images)),
  };
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

/**
 * One inventory change. `PHYSICAL_COUNT` sets an absolute quantity ("there are 4
 * here now"); `ADJUSTMENT` moves stock between states by a delta.
 *
 * Prefer PHYSICAL_COUNT when reconciling against a real-world count: it is
 * idempotent in effect, so a replayed message lands on the same number, whereas
 * a replayed ADJUSTMENT double-counts.
 */
export type SquareInventoryChange =
  | {
      type: "PHYSICAL_COUNT";
      catalogObjectId: string;
      locationId: string;
      quantity: number;
      /** Defaults to IN_STOCK. */
      state?: string;
      /** RFC 3339. Defaults to now. Square rejects timestamps in the future. */
      occurredAt?: string;
    }
  | {
      type: "ADJUSTMENT";
      catalogObjectId: string;
      locationId: string;
      quantity: number;
      fromState: string;
      toState: string;
      occurredAt?: string;
    };

/**
 * Apply inventory changes. POST /v2/inventory/changes/batch-create.
 *
 * Note the direction of truth: D1 owns price, presence and placement, but
 * **Square owns inventory counts**. This exists for the reconcile path — a
 * physical recount, or seeding a new merchant's opening stock — not for mirroring
 * a D1 number over Square's on every sync.
 */
export async function batchChangeInventory(
  config: SquareConfig,
  changes: SquareInventoryChange[],
  options?: { idempotencyKey?: string },
): Promise<SquareInventoryCount[]> {
  const now = new Date().toISOString();
  const res = await sqPost<{
    counts?: {
      catalog_object_id?: string;
      state?: string;
      quantity?: string;
      location_id?: string;
    }[];
  }>(config, "/v2/inventory/changes/batch-create", {
    idempotency_key: options?.idempotencyKey ?? crypto.randomUUID(),
    changes: changes.map((c) =>
      c.type === "PHYSICAL_COUNT"
        ? {
            type: "PHYSICAL_COUNT",
            physical_count: {
              catalog_object_id: c.catalogObjectId,
              location_id: c.locationId,
              state: c.state ?? "IN_STOCK",
              // Square wants the quantity as a string.
              quantity: String(c.quantity),
              occurred_at: c.occurredAt ?? now,
            },
          }
        : {
            type: "ADJUSTMENT",
            adjustment: {
              catalog_object_id: c.catalogObjectId,
              location_id: c.locationId,
              from_state: c.fromState,
              to_state: c.toState,
              quantity: String(c.quantity),
              occurred_at: c.occurredAt ?? now,
            },
          },
    ),
  });
  return (res.counts ?? []).map((c) => ({
    catalogObjectId: c.catalog_object_id ?? "",
    state: c.state ?? "",
    quantity: Number(c.quantity ?? 0),
    locationId: c.location_id ?? "",
  }));
}

/** Set one variation's absolute on-hand count at one location — the common case
 *  of {@link batchChangeInventory}, named for what it does. */
export function setPhysicalCount(
  config: SquareConfig,
  input: {
    catalogObjectId: string;
    locationId: string;
    quantity: number;
    state?: string;
    occurredAt?: string;
    idempotencyKey?: string;
  },
): Promise<SquareInventoryCount[]> {
  return batchChangeInventory(config, [{ type: "PHYSICAL_COUNT", ...input }], {
    idempotencyKey: input.idempotencyKey,
  });
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
  /** When money settled — the accounting axis, and null until an order closes. */
  closedAt: string | null;
  updatedAt: string | null;
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
  closed_at?: string;
  updated_at?: string;
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
    closedAt: o.closed_at ?? null,
    updatedAt: o.updated_at ?? null,
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
/** One line item in Square's wire shape. Shared by {@link createOrder} and
 *  {@link createPaymentLink} so the two can't drift — an ad-hoc item (no
 *  catalog object) must carry `base_price_money`, a catalog-backed one must
 *  NOT, since Square prices that from the catalog. */
function orderLineItemBody(li: SquareOrderLineItem) {
  return "catalogObjectId" in li
    ? { catalog_object_id: li.catalogObjectId, quantity: String(li.quantity) }
    : {
        name: li.name,
        quantity: String(li.quantity),
        base_price_money: { amount: li.priceCents, currency: li.currency ?? "USD" },
      };
}

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
      line_items: input.lineItems.map(orderLineItemBody),
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
 * Square's hard ceiling on `location_ids` in one `/v2/orders/search` call.
 * Documented, not discovered: an 11th id is a 400, not a truncation.
 */
const SEARCH_ORDERS_LOCATION_LIMIT = 10;

function chunkLocationIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += SEARCH_ORDERS_LOCATION_LIMIT) {
    chunks.push(ids.slice(i, i + SEARCH_ORDERS_LOCATION_LIMIT));
  }
  return chunks;
}

/** Re-establish a global order over results Square only sorted per response. */
function sortOrdersBy(
  orders: SquareOrder[],
  dateField: "closedAt" | "createdAt" | "updatedAt",
  sortOrder: "ASC" | "DESC",
): SquareOrder[] {
  const direction = sortOrder === "ASC" ? 1 : -1;
  return [...orders].sort((a, b) => {
    const x = a[dateField];
    const y = b[dateField];
    // Nulls last in both directions — an order with no timestamp on the axis
    // you asked about (an OPEN order has no `closed_at`) is not the newest
    // thing that happened, which is where it would land unguarded.
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -direction : direction;
  });
}

/**
 * Search orders for a customer (account order history). Returns full orders,
 * newest first. POST /v2/orders/search.
 */
export async function searchOrdersByCustomer(
  config: SquareConfig,
  input: { locationIds: string[]; customerId: string; limit?: number },
): Promise<SquareOrder[]> {
  const limit = input.limit ?? 50;
  const orders: SquareOrder[] = [];
  // Same endpoint, same 10-location ceiling. It bites later here than in
  // `searchOrders` — an account history is usually asked for one location at a
  // time — but a multi-location portal asking "everywhere she's shopped" is
  // exactly the request that trips it.
  for (const locationIds of chunkLocationIds(input.locationIds)) {
    const res = await sqPost<{ orders?: RawOrder[] }>(config, "/v2/orders/search", {
      location_ids: locationIds,
      return_entries: false,
      limit,
      query: {
        filter: { customer_filter: { customer_ids: [input.customerId] } },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
      },
    });
    orders.push(...(res.orders ?? []).map(mapOrder));
  }
  // `limit` is per request, so N chunks can return N×limit. Re-sort and trim so
  // the caller gets the newest `limit` orders overall, which is what they asked
  // for — not the newest `limit` from each arbitrary group of ten.
  if (input.locationIds.length <= SEARCH_ORDERS_LOCATION_LIMIT) return orders;
  return sortOrdersBy(orders, "createdAt", "DESC").slice(0, limit);
}

/**
 * Search orders across locations and a date range, following the cursor.
 * POST /v2/orders/search. The reporting rail: best-sellers, per-merchant sales
 * totals, reorder suggestions.
 *
 * Defaults to `COMPLETED` only. That matters for money questions — leaving the
 * state filter open counts `OPEN` (unpaid) and `CANCELED` orders as revenue,
 * which quietly inflates every downstream report.
 *
 * `closedAt` is the right axis for accounting (when money settled); `createdAt`
 * for funnel questions (when the order was raised). They differ for anything not
 * paid immediately, so the caller picks rather than inheriting a guess.
 */
export async function searchOrders(
  config: SquareConfig,
  input: {
    locationIds: string[];
    /** RFC 3339, inclusive. */
    startAt?: string;
    /** RFC 3339, exclusive. */
    endAt?: string;
    /** Defaults to ["COMPLETED"]. Pass [] to disable state filtering entirely. */
    states?: string[];
    /** Which timestamp the range and sort apply to. Defaults to "closedAt". */
    dateField?: "closedAt" | "createdAt" | "updatedAt";
    sortOrder?: "ASC" | "DESC";
    /** Page size (Square caps at 1000). Defaults to 500. */
    limit?: number;
    /** Safety bound on cursor pages, applied PER location chunk. Defaults to 20. */
    maxPages?: number;
  },
): Promise<SquareOrder[]> {
  // An empty list would be a caller bug that Square answers with a 400 and a
  // message about `location_ids`, several layers from where it was introduced.
  // Refusing here names it. (Not returning [] — a reporting call that silently
  // yields no rows reads as "no sales", which is worse than an error.)
  if (input.locationIds.length === 0) {
    throw new Error("Square searchOrders needs at least one location id");
  }
  const states = input.states ?? ["COMPLETED"];
  const sortField = (
    { closedAt: "CLOSED_AT", createdAt: "CREATED_AT", updatedAt: "UPDATED_AT" } as const
  )[input.dateField ?? "closedAt"];
  const range =
    input.startAt || input.endAt
      ? {
          [sortField === "CLOSED_AT"
            ? "closed_at"
            : sortField === "CREATED_AT"
              ? "created_at"
              : "updated_at"]: {
            ...(input.startAt ? { start_at: input.startAt } : {}),
            ...(input.endAt ? { end_at: input.endAt } : {}),
          },
        }
      : undefined;

  const orders: SquareOrder[] = [];
  // Sequentially, not in parallel: a 300-location account is 30 searches, and
  // firing them at once is the surest way to meet the 429 this client only
  // retries when asked to.
  for (const locationIds of chunkLocationIds(input.locationIds)) {
    let cursor: string | undefined;
    for (let page = 0; page < (input.maxPages ?? 20); page++) {
      const res = await sqPost<{ orders?: RawOrder[]; cursor?: string }>(
        config,
        "/v2/orders/search",
        {
          location_ids: locationIds,
          return_entries: false,
          limit: input.limit ?? 500,
          ...(cursor ? { cursor } : {}),
          query: {
            filter: {
              ...(states.length ? { state_filter: { states } } : {}),
              ...(range ? { date_time_filter: range } : {}),
            },
            // Square requires the sort field to match the date filter's field.
            sort: { sort_field: sortField, sort_order: input.sortOrder ?? "DESC" },
          },
        },
      );
      orders.push(...(res.orders ?? []).map(mapOrder));
      cursor = res.cursor;
      if (!cursor) break;
    }
  }
  // Square sorts within a response, not across our chunks. Above 10 locations
  // the concatenation is ordered per chunk and unordered overall, which looks
  // fine in a spot check and puts the wrong rows in any "top N" or "most
  // recent" that trusts the order.
  return input.locationIds.length > SEARCH_ORDERS_LOCATION_LIMIT
    ? sortOrdersBy(orders, input.dateField ?? "closedAt", input.sortOrder ?? "DESC")
    : orders;
}

/**
 * Preview an order's totals — including auto-applied taxes and discounts —
 * without creating one. POST /v2/orders/calculate.
 *
 * The order is never persisted, so this is the honest way to show a cart total
 * that matches what checkout will charge: the same pricing engine, no order to
 * clean up if the customer walks away.
 */
export async function calculateOrder(
  config: SquareConfig,
  input: {
    locationId: string;
    lineItems: SquareOrderLineItem[];
    customerId?: string;
  },
): Promise<SquareOrder> {
  const res = await sqPost<{ order?: RawOrder }>(config, "/v2/orders/calculate", {
    order: {
      location_id: input.locationId,
      customer_id: input.customerId,
      line_items: input.lineItems.map(orderLineItemBody),
    },
  });
  if (!res.order) throw new Error("Square order calculation returned no order");
  return mapOrder(res.order);
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

function mapSubscription(sub: RawSubscription): SquareSubscription {
  return {
    id: sub.id ?? "",
    status: sub.status ?? "",
    planVariationId: sub.plan_variation_id ?? null,
    customerId: sub.customer_id ?? null,
    cardId: sub.card_id ?? null,
    startDate: sub.start_date ?? null,
    chargedThroughDate: sub.charged_through_date ?? null,
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

// ── Payment links (hosted checkout) ──────────────────────────────────────────
//
// A Square-hosted checkout page, created server-side and handed to the buyer as
// a URL. The alternative rail — the Web Payments SDK card field in
// `commerce/square-web` — keeps the buyer on your page but mounts a CARD FIELD
// ONLY. A hosted link gets Apple Pay / Google Pay / Cash App Pay from a config
// flag, which is what a shopper standing in a shop with a phone actually wants.
//
// Prefer the `order` form over `quickPay`: it is the only one that carries a
// `referenceId` onto the resulting Order, and the reference is how a sale is
// attributed later (it survives into the merchant's own Square dashboard and
// the Transactions export). Its line items may be ad-hoc — `SquareOrderLineItem`
// already models the no-catalog-object variant — so a site can sell from its own
// catalog without mirroring anything into Square first.

export interface SquarePaymentLink {
  id: string;
  /** Optimistic-concurrency version; required to update the link. */
  version: number;
  /** The short `square.link` URL — the one to put in front of a buyer. */
  url: string;
  /** The long `checkout.square.site` form. Absent on some responses. */
  longUrl: string | null;
  /** The Order the link created. The attribution anchor for the webhook. */
  orderId: string | null;
  createdAt: string | null;
}

interface RawPaymentLink {
  id?: string;
  version?: number;
  url?: string;
  long_url?: string;
  order_id?: string;
  created_at?: string;
}

function mapPaymentLink(l: RawPaymentLink): SquarePaymentLink {
  return {
    id: l.id ?? "",
    version: l.version ?? 0,
    url: l.url ?? "",
    longUrl: l.long_url ?? null,
    orderId: l.order_id ?? null,
    createdAt: l.created_at ?? null,
  };
}

/** Wallets offered on the hosted page. Omit a flag to take Square's default. */
export interface SquareAcceptedPaymentMethods {
  applePay?: boolean;
  googlePay?: boolean;
  cashAppPay?: boolean;
  afterpayClearpay?: boolean;
}

/** Optional presentation/behavior of the hosted checkout page. */
export interface SquareCheckoutOptions {
  /** Absolute https URL Square returns the buyer to after payment. Carry your
   *  own order/session id in its query string — this is the only hook you get
   *  for a branded confirmation page. */
  redirectUrl?: string;
  /** Square collects and validates the shipping address on its own page. */
  askForShippingAddress?: boolean;
  merchantSupportEmail?: string;
  acceptedPaymentMethods?: SquareAcceptedPaymentMethods;
  allowTipping?: boolean;
  shippingFee?: { name?: string; charge: SquareMoney };
  enableCoupon?: boolean;
  enableLoyalty?: boolean;
}

/** A one-off "name + price" link with no Order behind it. Cannot carry a
 *  `referenceId`, so prefer {@link PaymentLinkOrderInput} when the sale has to
 *  be attributed to anything. */
export interface QuickPayInput {
  name: string;
  priceMoney: SquareMoney;
  locationId: string;
}

/** An Order-backed link. Line items may be ad-hoc (no catalog object). */
export interface PaymentLinkOrderInput {
  locationId: string;
  lineItems: SquareOrderLineItem[];
  customerId?: string;
  /** Up to 40 chars. Surfaced in the Square dashboard + Transactions export,
   *  which is what makes it usable for attribution without this system. */
  referenceId?: string;
}

/**
 * Create a Square-hosted checkout page.
 * POST /v2/online-checkout/payment-links.
 *
 * Exactly one of `quickPay` or `order` — passing both is rejected here rather
 * than by Square, so the mistake surfaces at the call site.
 *
 * `idempotencyKey` defaults to a random UUID, which is right for an interactive
 * checkout (each attempt is a new link). Pass a deterministic key only when a
 * retry must resolve to the SAME link.
 */
export async function createPaymentLink(
  config: SquareConfig,
  input: {
    quickPay?: QuickPayInput;
    order?: PaymentLinkOrderInput;
    description?: string;
    paymentNote?: string;
    checkoutOptions?: SquareCheckoutOptions;
    prePopulatedData?: { buyerEmail?: string; buyerPhoneNumber?: string };
    idempotencyKey?: string;
  },
): Promise<SquarePaymentLink> {
  if (!input.quickPay === !input.order) {
    throw new Error("Square payment link needs exactly one of `quickPay` or `order`");
  }

  const co = input.checkoutOptions;
  const apm = co?.acceptedPaymentMethods;

  const res = await sqPost<{ payment_link?: RawPaymentLink }>(
    config,
    "/v2/online-checkout/payment-links",
    {
      idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      description: input.description,
      payment_note: input.paymentNote,
      quick_pay: input.quickPay && {
        name: input.quickPay.name,
        price_money: input.quickPay.priceMoney,
        location_id: input.quickPay.locationId,
      },
      order: input.order && {
        location_id: input.order.locationId,
        customer_id: input.order.customerId,
        reference_id: input.order.referenceId,
        line_items: input.order.lineItems.map(orderLineItemBody),
      },
      checkout_options: co && {
        redirect_url: co.redirectUrl,
        ask_for_shipping_address: co.askForShippingAddress,
        merchant_support_email: co.merchantSupportEmail,
        allow_tipping: co.allowTipping,
        enable_coupon: co.enableCoupon,
        enable_loyalty: co.enableLoyalty,
        shipping_fee: co.shippingFee && {
          name: co.shippingFee.name,
          charge: co.shippingFee.charge,
        },
        accepted_payment_methods: apm && {
          apple_pay: apm.applePay,
          google_pay: apm.googlePay,
          cash_app_pay: apm.cashAppPay,
          afterpay_clearpay: apm.afterpayClearpay,
        },
      },
      pre_populated_data: input.prePopulatedData && {
        buyer_email: input.prePopulatedData.buyerEmail,
        buyer_phone_number: input.prePopulatedData.buyerPhoneNumber,
      },
    },
  );
  if (!res.payment_link) throw new Error("Square payment link creation returned none");
  return mapPaymentLink(res.payment_link);
}

/** Retrieve one payment link. GET /v2/online-checkout/payment-links/{id}.
 *  Returns null when it no longer exists (already deleted, or a bad id). */
export async function retrievePaymentLink(
  config: SquareConfig,
  linkId: string,
): Promise<SquarePaymentLink | null> {
  try {
    const res = await sqGet<{ payment_link?: RawPaymentLink }>(
      config,
      `/v2/online-checkout/payment-links/${encodeURIComponent(linkId)}`,
    );
    return res.payment_link ? mapPaymentLink(res.payment_link) : null;
  } catch {
    return null;
  }
}

/** Delete a payment link, cancelling its unpaid order.
 *  DELETE /v2/online-checkout/payment-links/{id}. */
export async function deletePaymentLink(
  config: SquareConfig,
  linkId: string,
): Promise<{ id: string; cancelledOrderId: string | null }> {
  const res = await sqDelete<{ id?: string; cancelled_order_id?: string }>(
    config,
    `/v2/online-checkout/payment-links/${encodeURIComponent(linkId)}`,
  );
  return { id: res.id ?? linkId, cancelledOrderId: res.cancelled_order_id ?? null };
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

/**
 * A Square webhook event, validated to the envelope this integration reads.
 * Run it via {@link import("./index.js").parseWebhookEvent} AFTER
 * {@link verifySquareSignature}. Square nests the changed resource under
 * `data.object`, keyed by `data.type` (e.g. `payment`, `invoice`, `order`) with
 * `data.id` the resource id — the handler switches on the top-level `type` and
 * reads/re-fetches from there. The object stays an untyped record (its shape
 * depends on `data.type`); extra envelope keys (merchant_id, created_at, …) are
 * dropped.
 */
export const squareWebhookEventSchema = s.object({
  type: s.string(),
  event_id: s.optional(s.string()),
  data: s.object({
    type: s.optional(s.string()),
    id: s.optional(s.string()),
    object: s.optional(s.record()),
  }),
});
