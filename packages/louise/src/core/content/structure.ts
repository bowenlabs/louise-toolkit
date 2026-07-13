// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { ContentConfig, CollectionAdminConfig, CollectionConfig } from "./types.js";

/**
 * Louise's Structure Builder — the framework half of issue #12.
 *
 * Adopts Sanity's `sanity/structure` idea (pattern, not code): **decouple
 * the admin nav from the raw collection list.** Instead of mapping every
 * `config.collections` entry to an `/admin/<slug>` link — which surfaces
 * system/log tables as editable links and produces dead links — the sidebar
 * renders from an explicit, grouped structure derived here from each
 * collection's `admin` hints (see {@link CollectionAdminConfig}) plus
 * optional per-slug overrides supplied at the call site.
 *
 * Pure data in / pure data out: no SolidJS, no DOM, no server imports — so
 * it's safe to import from a client editor component (e.g. the site's
 * `PanelNav`) and trivially testable.
 */

/** Default group heading for collections that don't declare `admin.group`. */
export const DEFAULT_EDITOR_GROUP = "Content";

/** One navigable collection entry in the editor sidebar. */
export interface EditorStructureItem {
  /** The collection's slug. */
  slug: string;
  /** Human label — `admin.label`, else the capitalized slug. */
  label: string;
  /** Where the sidebar link points (`/admin/<slug>`, configurable prefix). */
  href: string;
  /** Read-only collections are viewable but not editable in the editor. */
  readOnly: boolean;
  /**
   * Singletons link straight to their editor rather than a list+create
   * flow. (The href is identical; the renderer uses this to skip the list.)
   */
  singleton: boolean;
  /** Opaque icon identifier from `admin.icon`, if any. */
  icon?: string;
}

/** A titled group of sidebar items, in render order. */
export interface EditorStructureGroup {
  title: string;
  items: EditorStructureItem[];
}

export interface BuildEditorStructureOptions {
  /**
   * Per-slug presentation overrides, merged over each collection's own
   * `admin` block (override keys win). The escape hatch for plugin-injected
   * collections (`products`, `payments`, `webhook_events`, …) that can't
   * carry an `admin` block in hand-written config — the editor declares
   * their presentation here, exactly like Sanity defines structure at the
   * editor level rather than on the schema.
   */
  overrides?: Record<string, CollectionAdminConfig>;
  /**
   * Explicit group ordering by title. Groups listed here render first, in
   * this order; any remaining groups follow in first-appearance order. A
   * group title absent from `config`'s collections simply doesn't appear.
   */
  groupOrder?: readonly string[];
  /**
   * Link prefix for each item's `href`. Defaults to `/admin`, producing
   * `/admin/<slug>`. No trailing slash.
   */
  basePath?: string;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function resolveAdmin(
  collection: CollectionConfig,
  overrides: Record<string, CollectionAdminConfig> | undefined,
): CollectionAdminConfig {
  return { ...collection.admin, ...overrides?.[collection.slug] };
}

/**
 * Build the editor sidebar structure from a resolved content config.
 *
 * - Hidden collections (`admin.hidden`) are dropped entirely.
 * - Each remaining collection is placed in its `admin.group` (or
 *   {@link DEFAULT_EDITOR_GROUP}).
 * - Within a group, items sort by `admin.order` (ascending; unset sorts
 *   after set), then by their original position in `config.collections` —
 *   so config order is the stable tiebreaker.
 * - Groups render in `options.groupOrder` first, then first-appearance
 *   order for the rest.
 *
 * The input is expected to be the *resolved* config (post-plugins), since
 * that's what carries plugin-injected collections like `products`.
 */
export function buildEditorStructure(
  config: ContentConfig,
  options: BuildEditorStructureOptions = {},
): EditorStructureGroup[] {
  const basePath = options.basePath ?? "/admin";
  const groupOrder = options.groupOrder ?? [];

  // Preserve original index so config order can break ties deterministically.
  const ranked = config.collections.map((collection, index) => ({
    collection,
    index,
    admin: resolveAdmin(collection, options.overrides),
  }));

  const groups = new Map<string, EditorStructureItem[]>();
  // Track first-appearance order of group titles for the fallback ordering.
  const appearance: string[] = [];

  for (const { collection, admin } of ranked) {
    if (admin.hidden) continue;
    const title = admin.group ?? DEFAULT_EDITOR_GROUP;
    if (!groups.has(title)) {
      groups.set(title, []);
      appearance.push(title);
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- title was just ensured present above
    groups.get(title)!.push({
      slug: collection.slug,
      label: admin.label ?? capitalize(collection.slug),
      href: `${basePath}/${collection.slug}`,
      readOnly: admin.readOnly ?? false,
      singleton: admin.singleton ?? false,
      ...(admin.icon ? { icon: admin.icon } : {}),
    });
  }

  // Sort items within each group by (order ?? Infinity), then config index.
  // We rebuild a slug -> {order,index} lookup so the comparator stays O(1).
  const meta = new Map(
    ranked.map(({ collection, index, admin }) => [
      collection.slug,
      { order: admin.order ?? Number.POSITIVE_INFINITY, index },
    ]),
  );
  for (const items of groups.values()) {
    items.sort((a, b) => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- every item came from `ranked`
      const ma = meta.get(a.slug)!;
      // oxlint-disable-next-line typescript/no-non-null-assertion -- every item came from `ranked`
      const mb = meta.get(b.slug)!;
      return ma.order - mb.order || ma.index - mb.index;
    });
  }

  // Order groups: explicit groupOrder first (in that order, only if present),
  // then remaining groups by first appearance.
  const orderedTitles = [
    ...groupOrder.filter((title) => groups.has(title)),
    ...appearance.filter((title) => !groupOrder.includes(title)),
  ];

  return orderedTitles.map((title) => ({
    title,
    // oxlint-disable-next-line typescript/no-non-null-assertion -- orderedTitles is derived from groups' keys
    items: groups.get(title)!,
  }));
}
