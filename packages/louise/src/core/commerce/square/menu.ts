// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: an order-ahead menu from the category tree.
//
// Pure: it takes what `listCatalogDetailed`, `listCategories`,
// `listModifierLists`, and `retrieveInventoryCounts` already fetched, and makes
// no Square call itself. So the same snapshot a site caches renders the same
// menu every time, and the rules are testable without a live catalog.

import { priceAtLocation } from "./catalog.js";
import type { DetailedCatalog, SquareCategory, SquareModifierList } from "./catalog-details.js";
import type { SquareInventoryCount } from "./inventory.js";

/** What {@link buildMenuTabs} reads: the four catalog reads, as fetched. */
export interface MenuCatalog {
  /** From `listCatalogDetailed`. */
  catalog: DetailedCatalog;
  /** From `listCategories`: the REGULAR category tree. */
  categories: SquareCategory[];
  /** From `listModifierLists`. */
  modifierLists: Record<string, SquareModifierList>;
  /**
   * From `retrieveInventoryCounts`, for the location the menu sells from. Only
   * `IN_STOCK` counts are read. A variation with no count is untracked, and an
   * untracked variation is never sold out. Pass `[]` when stock is unavailable,
   * and nothing shows as sold out.
   */
  counts: SquareInventoryCount[];
}

/** Options for {@link buildMenuTabs}. Both lists are the site's, usually set by an editor. */
export interface MenuTabsOptions {
  /**
   * The top-level categories the menu shows, in tab order. An id that isn't a
   * top-level REGULAR category is skipped. An empty list is an empty menu:
   * guessing a category from its name is the site's call, not this function's.
   */
  categoryIds: string[];
  /** Items to leave off the menu, by Square item id. */
  hiddenItemIds?: string[];
  /**
   * The location the menu sells from. When set, a variation's price is its
   * price there (`priceAtLocation`), and only that location's counts are read.
   * Leave it out to use base prices and every count passed.
   */
  locationId?: string;
}

/** A modifier list as one item offers it: the list plus that item's selection bounds. */
export interface MenuModifierList extends SquareModifierList {
  /** The fewest modifiers a customer must pick; 0 when optional. From the item's ref. */
  min: number;
  /** The most a customer may pick; 0 when unbounded. From the item's ref. */
  max: number;
}

/** A variation a customer can order. */
export interface MenuVariation {
  id: string;
  name: string;
  priceCents: number;
  /** The price's ISO 4217 code, or `null` when Square sent none, as on `SquareVariation`. */
  currency: string | null;
  /** Units in stock, or `null` when Square doesn't track this variation. */
  stock: number | null;
}

/** One item on a {@link MenuTab}. */
export interface MenuItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  /** The priced variations, in Square's order. Never empty. */
  variations: MenuVariation[];
  /** True only when every variation is tracked and at zero or below. */
  soldOut: boolean;
  /** The item's enabled modifier lists, in the item's order. A list with no modifiers is left out. */
  modifierLists: MenuModifierList[];
}

/** One tab of the menu: a subcategory, or a top-level category's own items. */
export interface MenuTab {
  /** The category's id. */
  id: string;
  name: string;
  slug: string;
  items: MenuItem[];
}

/** Every category id under `rootId`, `rootId` included. */
function subtree(categories: SquareCategory[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Menu tabs for an order-ahead app, from Square's category tree.
 *
 * Each chosen top-level category gives one tab per direct subcategory, in
 * Square's ordinal order, holding the items filed under that subcategory or
 * any level below it. Items filed directly under the top-level category, in
 * none of its subcategories, go in a trailing tab named after it. A top-level
 * category with no subcategories is that one tab. A tab with no items is left
 * out.
 *
 * An item filed under two subcategories appears in both tabs, so each tab
 * shows its full membership. A view that shows every tab at once dedupes by
 * item id.
 *
 * The rules each item follows:
 *
 * - **Hidden:** an item in `hiddenItemIds` is left off.
 * - **Priced:** a variation priced at 0, such as Square's variable pricing,
 *   rings up at the register and can't be ordered online, so it's dropped. An
 *   item with no priced variation left is off the menu.
 * - **Sold out:** only when every variation is tracked and at zero or below.
 *   An untracked item, such as a drink made to order, is never sold out.
 * - **Modifiers:** each list's `min` and `max` come from the item's ref, not
 *   the list, since two items can bound one list differently.
 */
export function buildMenuTabs(input: MenuCatalog, options: MenuTabsOptions): MenuTab[] {
  const { catalog, categories, modifierLists, counts } = input;
  const { categoryIds, hiddenItemIds = [], locationId } = options;

  const stock = new Map<string, number>();
  for (const count of counts) {
    if (count.state !== "IN_STOCK") continue;
    if (locationId !== undefined && count.locationId !== locationId) continue;
    stock.set(count.catalogObjectId, (stock.get(count.catalogObjectId) ?? 0) + count.quantity);
  }

  const hidden = new Set(hiddenItemIds);
  const menuItems: { item: MenuItem; categoryIds: string[] }[] = [];
  for (const item of catalog.items) {
    if (hidden.has(item.id)) continue;
    const variations = item.variations
      .map((v) => {
        const price = locationId === undefined ? null : priceAtLocation(v, locationId);
        return {
          id: v.id,
          name: v.name,
          priceCents: price?.amount ?? v.priceCents,
          currency: price?.currency ?? v.currency,
          stock: stock.get(v.id) ?? null,
        };
      })
      .filter((v) => v.priceCents > 0);
    if (variations.length === 0) continue;
    const modifiers = (catalog.itemModifiers[item.id] ?? []).flatMap((ref) => {
      const list = modifierLists[ref.id];
      return list && list.modifiers.length > 0 ? [{ ...list, min: ref.min, max: ref.max }] : [];
    });
    menuItems.push({
      item: {
        id: item.id,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        variations,
        soldOut: variations.every((v) => v.stock !== null && v.stock <= 0),
        modifierLists: modifiers,
      },
      categoryIds: catalog.itemCategories[item.id] ?? [],
    });
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const byOrdinal = (a: SquareCategory, b: SquareCategory) => a.ordinal - b.ordinal;
  const tabs: MenuTab[] = [];
  const addTab = (category: SquareCategory, ids: Set<string>) => {
    const items = menuItems
      .filter((m) => m.categoryIds.some((id) => ids.has(id)))
      .map((m) => m.item);
    if (items.length > 0) {
      tabs.push({ id: category.id, name: category.name, slug: category.slug, items });
    }
  };

  for (const topId of categoryIds) {
    const top = byId.get(topId);
    if (!top?.isTop) continue;
    const children = categories.filter((c) => c.parentId === top.id).sort(byOrdinal);
    const childTrees = children.map((c) => subtree(categories, c.id));
    children.forEach((child, i) => addTab(child, childTrees[i] as Set<string>));
    const direct = new Set(
      [...subtree(categories, top.id)].filter((id) => !childTrees.some((t) => t.has(id))),
    );
    addTab(top, direct);
  }
  return tabs;
}
