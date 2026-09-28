// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: detailed catalog extraction: categories, the reporting
// category, and modifier lists.
//
// The plain `listCatalogItems` returns just the mapped items. A storefront that
// also drives category filters and order-ahead customization needs three more
// things Square carries on each item + in its own object types: category
// membership, the `reporting_category`, and enabled modifier-list bounds. Those
// live here so any Square site inherits them, rather than each re-implementing
// the extraction over `/v2/catalog/search`.

import { mapCatalogItem, type SquareCatalogItem, type SquarePresence } from "./catalog.js";
import type { SquareConfig } from "./client.js";
import { sqFetch, sqGet, sqPost } from "./request.js";
import {
  type CatalogSearchResponse,
  imageUrlMap,
  isArchivedItem,
  type RawCatalogObject,
} from "./wire.js";

/** A REGULAR Square category (product taxonomy). The parallel MENU_CATEGORY tree
 *  (Square Online display) is filtered out by {@link listCategories}. */
export interface SquareCategory {
  id: string;
  name: string;
  /** URL-safe slug (for example, a shop's `?cat=` value). */
  slug: string;
  /** Parent category id, or null for a top-level category. */
  parentId: string | null;
  isTop: boolean;
  /** Square display ordinal (lower sorts first); 0 when absent. */
  ordinal: number;
}

/** A single modifier (a size, a milk, an add-on)—name + price adjustment. */
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
 * `/v2/catalog/search` over ITEMs. Square uses -1 for an "unset" min/max—this
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
      if (obj.type !== "ITEM" || obj.is_deleted || isArchivedItem(obj)) continue;
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
  /** Existing Square variation id—pass to update; omit to create a new one. */
  id?: string;
  /** Stable client key for a NEW variation, echoed back in `idMappings` so the
   *  caller can persist the id Square assigns (ignored when `id` is set). */
  clientId?: string;
  name: string;
  sku?: string;
  priceCents: number;
  currency?: string;
  /** Current Square version—required when UPDATING an existing variation
   *  (Square uses optimistic concurrency; a stale/absent version is rejected). */
  version?: number;
  /** Per-location price overrides—the multi-merchant pricing lever. Omit to
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

/**
 * Square's cap on ITEM_VARIATIONs under one ITEM. Asserted rather than
 * discovered: it is the ceiling a per-merchant-variation design hits first, and
 * the alternative is a 400 partway through a catalog push.
 */
const MAX_VARIATIONS_PER_ITEM = 250;

/**
 * Square's rule: a variation may only be present where its parent item is.
 *
 * Violating it does not error—it produces a silent partial state where the
 * item renders at a location with no purchasable variation under it. That is
 * miserable to debug in the wild and trivial to catch here, so this throws
 * before the write rather than after.
 *
 * Only checked when the item declares an explicit location set. `presentAtAllLocations`
 * (the default) makes any variation set a subset by definition.
 */
function assertVariationPresence(
  itemPresence: Partial<SquarePresence> | undefined,
  variations: { name: string; presence?: Partial<SquarePresence> }[],
): void {
  const itemLocations = itemPresence?.presentAtLocationIds;
  if (!itemLocations || itemPresence?.presentAtAllLocations) return;
  const allowed = new Set(itemLocations);
  for (const variation of variations) {
    const stray = (variation.presence?.presentAtLocationIds ?? []).filter((id) => !allowed.has(id));
    if (stray.length > 0) {
      throw new Error(
        `Square catalog write: variation "${variation.name}" is present at ${stray.join(", ")}, ` +
          `where its parent item is not. A variation's locations must be a subset of its item's.`,
      );
    }
  }
}

/** Both write-path guards, in the order a caller hits them. */
/** Square's batch-upsert limits, counting items and variations alike. */
const SQUARE_OBJECTS_PER_BATCH = 1_000;
const SQUARE_OBJECTS_PER_REQUEST = 10_000;

function assertWritableItem(input: {
  name: string;
  presence?: Partial<SquarePresence>;
  variations: { name: string; presence?: Partial<SquarePresence> }[];
}): void {
  if (input.variations.length > MAX_VARIATIONS_PER_ITEM) {
    throw new Error(
      `Square catalog write: item "${input.name}" has ${input.variations.length} variations, ` +
        `over Square's cap of ${MAX_VARIATIONS_PER_ITEM}.`,
    );
  }
  assertVariationPresence(input.presence, input.variations);
}

/**
 * Serialize images and taxonomy for a write, omitting what the caller didn't
 * set. Same reasoning as {@link presenceBody}: an absent key means "leave it
 * alone", while an empty array means "clear it"—and sending `[]` by default
 * would strip every item's imagery on the first price update.
 */
function presentationBody(input: CatalogPresentationInput) {
  if (input.reportingCategoryId && !input.categoryIds?.includes(input.reportingCategoryId)) {
    throw new Error(
      `Square catalog write: reportingCategoryId ${input.reportingCategoryId} is not in categoryIds. ` +
        "Square reports against a category the item belongs to; add it, or the item goes missing from sales breakdowns.",
    );
  }
  return {
    ...(input.imageIds ? { image_ids: input.imageIds } : {}),
    ...(input.categoryIds ? { categories: input.categoryIds.map((id) => ({ id })) } : {}),
    ...(input.reportingCategoryId ? { reporting_category: { id: input.reportingCategoryId } } : {}),
  };
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
 * POST /v2/catalog/object. This is the one catalog WRITE—sites where D1 owns
 * the product and pushes it up (vs. Square-as-source-of-truth reads above) call
 * this to mirror an item and its size/price variations into Square.
 *
 * Omit `id`s to create (Square assigns real ids, returned in `idMappings` keyed
 * by each variation's `clientId`/`#temp` id). To UPDATE, pass the item `id` +
 * each variation `id` AND its current `version` (from a prior retrieve)—Square
 * rejects a write with a stale version. Returns the normalized item with the
 * real ids resolved.
 */
export async function upsertCatalogItem(
  config: SquareConfig,
  input: CatalogPresentationInput & {
    id?: string;
    name: string;
    description?: string;
    variations: CatalogVariationInput[];
    /** Current item version—required when updating an existing ITEM. */
    version?: number;
    /** Where the ITEM is sold. Omit for "everywhere". */
    presence?: Partial<SquarePresence>;
    idempotencyKey?: string;
  },
): Promise<{ item: SquareCatalogItem; idMappings: Record<string, string> }> {
  assertWritableItem(input);
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
        ...presentationBody(input),
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

/** Taxonomy and imagery on a catalog write—the "same picture and category
 *  everywhere" half of a multi-merchant push. */
export interface CatalogPresentationInput {
  /**
   * Existing IMAGE object ids, in display order—the first is the primary.
   * Upload with {@link createCatalogImage} to get one; there is no way to attach
   * raw bytes through this call.
   */
  imageIds?: string[];
  /** CATEGORY object ids this item belongs to. */
  categoryIds?: string[];
  /**
   * The single category Square attributes this item to in its own sales
   * reports. Must also appear in `categoryIds`—Square derives one from the
   * other inconsistently otherwise, and a reporting category the item isn't in
   * is how a product goes missing from a sales breakdown while looking correct
   * in the dashboard.
   */
  reportingCategoryId?: string;
}

/** One ITEM in a {@link batchUpsertCatalogObjects} call. */
export interface CatalogItemInput extends CatalogPresentationInput {
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
 * turns a full catalog push into a rate-limit problem. This batches them. Square
 * allows up to 1,000 objects per batch and 10,000 per request, counting each
 * variation as an object, so this packs items into batches under that limit and
 * refuses a write over the request limit before sending anything. An empty list
 * sends nothing.
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
    assertWritableItem(item);
    const itemId = item.id ?? item.clientId ?? `#item-${i}`;
    return {
      type: "ITEM",
      id: itemId,
      ...(item.version != null ? { version: item.version } : {}),
      ...presenceBody(item.presence),
      item_data: {
        name: item.name,
        description: item.description,
        ...presentationBody(item),
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

  if (objects.length === 0) return { idMappings: {}, objects: [] };

  // Square counts an item and each of its variations as objects: at most 1,000
  // per batch and 10,000 per request (#700). An item never splits across
  // batches, since its variations travel inside it.
  const weight = (o: (typeof objects)[number]) => 1 + o.item_data.variations.length;
  const total = objects.reduce((n, o) => n + weight(o), 0);
  if (total > SQUARE_OBJECTS_PER_REQUEST) {
    throw new Error(
      `Square catalog write: ${total} objects (items and variations) is over Square's ` +
        `limit of ${SQUARE_OBJECTS_PER_REQUEST} per request. Split the write.`,
    );
  }
  const batches: (typeof objects)[] = [];
  let current: typeof objects = [];
  let currentWeight = 0;
  for (const object of objects) {
    if (currentWeight + weight(object) > SQUARE_OBJECTS_PER_BATCH && current.length > 0) {
      batches.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(object);
    currentWeight += weight(object);
  }
  batches.push(current);

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

/** An uploaded catalog IMAGE. `url` is Square's CDN copy, not the source. */
export interface SquareCatalogImage {
  id: string;
  url: string | null;
  caption: string | null;
}

/**
 * Upload an image and get back a catalog IMAGE object. POST /v2/catalog/images.
 *
 * The only way to get an id for {@link CatalogPresentationInput.imageIds}—the
 * catalog write takes ids, never bytes, so this runs first and its `id` feeds
 * the upsert.
 *
 * Multipart, and deliberately not built on the JSON verbs: `content-type` must
 * carry the boundary `fetch` generates, so setting it by hand breaks the upload
 * in a way that reads as a Square-side rejection.
 *
 * Pass `objectId` to attach the image to an existing ITEM in one call. Omit it
 * to create a free-standing image and attach it via a later write—which is
 * what you want when pushing many items that share one picture, since uploading
 * the same bytes per item bills and stores per item.
 *
 * `caption` is the accessibility text Square renders; worth setting.
 */
export async function createCatalogImage(
  config: SquareConfig,
  input: {
    /** The bytes. A `File` carries its own name and type; a `Blob` needs `filename`. */
    file: Blob;
    filename?: string;
    caption?: string;
    /** Attach to this catalog object as part of the upload. */
    objectId?: string;
    idempotencyKey?: string;
  },
): Promise<SquareCatalogImage> {
  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      ...(input.objectId ? { object_id: input.objectId } : {}),
      image: {
        type: "IMAGE",
        id: "#image",
        image_data: { caption: input.caption },
      },
    }),
  );
  form.append("image_file", input.file, input.filename ?? "image");

  const res = await sqFetch<{ image?: RawCatalogObject }>(config, "/v2/catalog/images", {
    method: "POST",
    formData: form,
  });
  if (!res.image) throw new Error("Square catalog image upload returned no image");
  return {
    id: res.image.id,
    url: res.image.image_data?.url ?? null,
    caption: input.caption ?? null,
  };
}

/**
 * A catalog object exactly as Square returned it.
 *
 * Deliberately open—an index signature, not a modelled interface. The whole
 * point of {@link readModifyWriteCatalog} is that fields this client does not
 * know about survive the round trip, and a closed type would invite callers to
 * rebuild the object from the parts it names, which is the bug being prevented.
 */
export type SquareCatalogObject = {
  id: string;
  type: string;
  version?: number;
  [key: string]: unknown;
};

/**
 * Read a catalog object, mutate it, and write it back without losing anything.
 *
 * Square documents this failure verbatim: *"If a client reads an object at an
 * older API version and writes it back at a newer version, fields that were
 * introduced between those two versions will be absent from the request, and the
 * server will interpret that absence"*—as an intentional clear. The same hazard
 * applies to any read-modify-write that reconstructs the object from the fields
 * it happens to model: whatever it didn't model is silently erased.
 *
 * So this never rebuilds. It reads the raw object, hands that object to
 * `mutate`, and writes back what it got—with the version Square returned (for
 * optimistic concurrency) and the same pinned `Square-Version` on both calls,
 * which is what makes the round trip symmetrical.
 *
 * ```ts
 * await readModifyWriteCatalog(config, "VAR123", (object) => {
 *   const data = object.item_variation_data as Record<string, unknown>;
 *   data.price_money = { amount: 1800, currency: "USD" };
 * });
 * ```
 *
 * `mutate` may edit in place or return a replacement. Returning `null` or
 * `undefined` from an in-place edit is normal—only a returned object replaces.
 *
 * Prefer {@link upsertCatalogItem} when creating or wholesale-replacing an item;
 * this is for touching one field of something that already exists, which is
 * exactly when accidental erasure is most likely and least visible.
 */
export async function readModifyWriteCatalog(
  config: SquareConfig,
  objectId: string,
  mutate: (
    object: SquareCatalogObject,
  ) => SquareCatalogObject | void | Promise<SquareCatalogObject | void>,
  options?: { idempotencyKey?: string },
): Promise<SquareCatalogObject> {
  const read = await sqGet<{ object?: SquareCatalogObject }>(
    config,
    `/v2/catalog/object/${encodeURIComponent(objectId)}`,
  );
  if (!read.object) throw new Error(`Square catalog object ${objectId} not found`);

  // Captured BEFORE the mutator runs: it edits in place, so reading this
  // afterwards would read whatever the mutator left there. The version must be
  // the one THIS read returned—that is the whole optimistic-concurrency
  // contract. A concurrent write bumps it and Square rejects ours rather than
  // silently overwriting someone else's change.
  const version = read.object.version;
  const mutated = (await mutate(read.object)) ?? read.object;
  const object = { ...mutated, version };

  const write = await sqPost<{ catalog_object?: SquareCatalogObject }>(
    config,
    "/v2/catalog/object",
    { idempotency_key: options?.idempotencyKey ?? crypto.randomUUID(), object },
  );
  if (!write.catalog_object) throw new Error(`Square catalog write for ${objectId} returned none`);
  return write.catalog_object;
}
