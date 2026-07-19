// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The portal's navigation, as data.
//
// Two things fall out of declaring it rather than writing markup per page.
// Items can be filtered by the viewer's role in one place — so an item a user
// can't reach is never rendered, instead of rendered-then-403'd, which reads as
// a broken link. And "which item is active" is computed the same way the guard
// matches prefixes, so the highlight can't disagree with the routing.

import { matchesPrefix } from "./guard.js";

export interface PortalNavItem {
  label: string;
  href: string;
  /** Roles that may see this item. Omit for "everyone signed in". */
  roles?: string[];
  /** Optional icon name, passed through to the shell's slot. */
  icon?: string;
}

export interface PortalNav {
  items: PortalNavItem[];
  /** The items this role may see. */
  forRole(role: string | null | undefined): PortalNavItem[];
  /** The item matching a path, by the same prefix rule the guard uses. */
  activeFor(path: string): PortalNavItem | null;
}

/**
 * Declare the portal navigation.
 *
 * ```ts
 * export const nav = definePortalNav([
 *   { label: "Orders", href: "/portal/orders" },
 *   { label: "Team", href: "/admin/team", roles: ["manager"] },
 * ]);
 * ```
 */
export function definePortalNav(items: PortalNavItem[]): PortalNav {
  return {
    items,
    forRole(role) {
      return items.filter(
        (item) => !item.roles?.length || (role ? item.roles.includes(role) : false),
      );
    },
    activeFor(path) {
      // Longest href first, so `/portal/orders` wins over `/portal` on a page
      // both would match — otherwise the parent item is always the active one.
      return (
        [...items]
          .sort((a, b) => b.href.length - a.href.length)
          .find((item) => matchesPrefix(path, item.href)) ?? null
      );
    },
  };
}
