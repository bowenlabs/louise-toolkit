// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The sync: pull the provider's catalog, write it into the mirror without
// touching a single thing the owner edited.
//
// Two invariants do all the work here.
//
// **Idempotency.** The sync runs from a cron AND from webhooks, so the same
// product arrives repeatedly and sometimes concurrently. Keying every write on
// the provider's own id (unique in the table) means a re-run is a no-op update
// rather than a duplicate row.
//
// **The owned set is never in an UPDATE.** Not "usually not" — never. A sync
// that writes an owned column is a sync that silently reverts the owner's work,
// and they find out days later when someone notices the description is back to
// the vendor's default. So the update statement is built from the pulled set
// alone, and owned columns only appear in the INSERT, as defaults for a row
// that didn't exist yet.

/** The provider-agnostic shape an adapter normalizes a product into. */
export interface CatalogItem {
  /** The provider's id. Unique, stable, and the sync's idempotency key. */
  externalId: string;
  name: string;
  /** Major units (dollars), matching the mirror's `price` column. */
  price: number;
  images?: string[];
  variants?: unknown;
  /** The provider's own slug, when it has one — for re-fetching a single item. */
  externalSlug?: string;
}

/** The D1 surface the sync needs. Structural, so a real `D1Database` fits. */
export interface SyncDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

export interface CatalogSyncOptions {
  db: SyncDatabase;
  /** Mirror table name — must match the generated schema. */
  table: string;
  /**
   * `overlay` mode writes only the key and `synced_at`: the catalog fields live
   * at the provider, and there are no pulled columns to write.
   */
  mode?: "mirror" | "overlay";
  /** Build the public slug for a NEW row. Defaults to a slugified name. */
  slugify?: (item: CatalogItem) => string;
}

export interface CatalogSyncResult {
  /** Rows created — new products, landing as `draft`. */
  created: number;
  /** Rows whose pulled fields were refreshed. */
  updated: number;
}

/** Lowercase, dash-separated, punctuation stripped. */
export function defaultSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

/**
 * Allocate a slug that isn't taken, by suffixing `-2`, `-3`, … Two different
 * provider items genuinely can share a name ("Original" in two collections), and
 * the slug column is unique, so an unguarded insert would fail the whole sync
 * over a naming coincidence.
 */
async function allocateSlug(
  db: SyncDatabase,
  table: string,
  base: string,
  externalId: string,
): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const clash = await db
      .prepare(`SELECT external_id FROM ${table} WHERE slug = ?`)
      .bind(candidate)
      .first<{ external_id: string }>();
    // Free, or already ours (a re-run reaching the same row).
    if (!clash || clash.external_id === externalId) return candidate;
  }
  // Pathological: 50 items with one name. Fall back to something unique by
  // construction rather than failing the sync.
  return `${base}-${externalId.slice(-8).toLowerCase()}`;
}

/**
 * Upsert one item. Returns whether it created a row.
 *
 * The UPDATE branch lists pulled columns ONLY — see the note at the top of this
 * file. In `overlay` mode there are no pulled columns, so an existing row is
 * touched only to stamp `synced_at`.
 */
export async function astroidCatalogUpsert(
  item: CatalogItem,
  options: CatalogSyncOptions,
): Promise<{ created: boolean }> {
  const { db, table } = options;
  const mode = options.mode ?? "mirror";
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .prepare(`SELECT id FROM ${table} WHERE external_id = ?`)
    .bind(item.externalId)
    .first<{ id: number }>();

  if (existing) {
    if (mode === "overlay") {
      await db
        .prepare(`UPDATE ${table} SET synced_at = ? WHERE external_id = ?`)
        .bind(now, item.externalId)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE ${table}
             SET name = ?, price = ?, images = ?, variants = ?, external_slug = ?, synced_at = ?
           WHERE external_id = ?`,
        )
        .bind(
          item.name,
          item.price,
          JSON.stringify(item.images ?? []),
          JSON.stringify(item.variants ?? null),
          item.externalSlug ?? null,
          now,
          item.externalId,
        )
        .run();
    }
    return { created: false };
  }

  const slug = await allocateSlug(
    db,
    table,
    options.slugify ? options.slugify(item) : defaultSlug(item.name),
    item.externalId,
  );

  if (mode === "overlay") {
    await db
      .prepare(`INSERT INTO ${table} (external_id, slug, synced_at) VALUES (?, ?, ?)`)
      .bind(item.externalId, slug, now)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO ${table}
           (external_id, name, price, images, variants, external_slug, synced_at, slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        item.externalId,
        item.name,
        item.price,
        JSON.stringify(item.images ?? []),
        JSON.stringify(item.variants ?? null),
        item.externalSlug ?? null,
        now,
        slug,
      )
      .run();
  }
  return { created: true };
}

/**
 * Sync a whole catalog snapshot.
 *
 * Items are written one at a time and a single failure doesn't abandon the rest:
 * a partial catalog is strictly better than a stale one, and the next cron tick
 * retries whatever didn't land. Rows whose product has vanished upstream are
 * left alone — deciding whether a missing item is delisted or just a failed page
 * of an API response is the project's call, not the sync's, and unpublishing
 * someone's whole catalog on a bad response is unrecoverable.
 */
export async function astroidCatalogSync(
  items: CatalogItem[],
  options: CatalogSyncOptions,
): Promise<CatalogSyncResult> {
  const result: CatalogSyncResult = { created: 0, updated: 0 };
  for (const item of items) {
    try {
      const { created } = await astroidCatalogUpsert(item, options);
      if (created) result.created++;
      else result.updated++;
    } catch {
      // Skip this item; the next run retries it.
    }
  }
  return result;
}
